"""Views for the feature board experience."""

from __future__ import annotations

import hashlib
from typing import TypedDict

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.db.models import Count, F, Max, Q, Sum, Value
from django.db.models.functions import Coalesce, Greatest
from django.http import Http404, HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import redirect, render
from django.views.decorators.http import require_GET, require_POST, require_http_methods
from django.core.exceptions import PermissionDenied

from .economy import daily_bonus_status
from .forms import (
    FeatureForm,
    NavigationPreferencesForm,
    ProfileForm,
    QuoteSuggestionForm,
    WebFiveInvestmentForm,
)
from .fortune import get_daily_fortune
from .navigation import build_sitemap_destinations
from .models import Feature, QuoteSuggestion, User as BoardUser, Vote, WebFiveInvestment
from .terrarium import build_terrarium_state
from . import generation, turnstile
from .utils import get_next_iteration_at

User = get_user_model()
WEB5_HALF_LIFE_RELEASE_TARGET = 1_000_000_000


class RetroMetric(TypedDict):
    label: str
    value: str
    change: str


class RetroSlice(TypedDict, total=False):
    label: str
    count: int
    note: str
    percent: int


class RetroCategory(TypedDict, total=False):
    label: str
    count: int
    note: str
    percent: int


class RetroProjection(TypedDict):
    pillar: str
    target: str
    timeline: str
    owner: str


def _client_ip(request: HttpRequest) -> str | None:
    """Extract client IP from request headers."""
    forwarded_for = request.META.get("HTTP_CF_CONNECTING_IP") or request.META.get(
        "HTTP_X_FORWARDED_FOR"
    )
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def _user_vote_ids(user: BoardUser) -> set[int]:
    """Return feature IDs the user has voted for."""
    if not user.is_authenticated:
        return set()
    return set(user.votes.values_list("feature_id", flat=True))


def _profile_avatar_descriptor(user: BoardUser) -> dict[str, str]:
    """Create a deterministic, abstract avatar palette for a user."""

    seed = (user.username or str(user.pk) or "member").lower()
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()

    hue_primary = int(digest[:2], 16) % 360
    hue_secondary = int(digest[2:4], 16) % 360
    saturation = 55 + int(digest[4:6], 16) % 30
    base_lightness = 38 + int(digest[6:8], 16) % 18
    accent_lightness = 55 + int(digest[8:10], 16) % 28
    rotation = int(digest[10:12], 16) % 360
    sparkle_hue = (hue_primary + 48) % 360
    sparkle_lightness = 60 + int(digest[12:14], 16) % 30
    noise_opacity = (10 + int(digest[14:16], 16) % 30) / 100
    initials_source = (user.display_name or user.username or "member").strip()
    initial = initials_source[:1].upper() if initials_source else "?"

    return {
        "initial": initial,
        "gradient_start": f"hsl({hue_primary}, {saturation}%, {base_lightness}%)",
        "gradient_stop": f"hsl({hue_secondary}, {saturation}%, {accent_lightness}%)",
        "rotation": str(rotation),
        "spark_color": f"hsl({sparkle_hue}, 78%, {sparkle_lightness}%)",
        "noise_opacity": f"{noise_opacity:.2f}",
    }


def _pending_features_with_vote_state(user: BoardUser) -> list[Feature]:
    """Return pending features annotated with whether the user has voted."""
    generation.ensure_generation_seed()
    features = list(
        Feature.objects.pending().ordered_by_popularity().select_related("creator")
    )
    voted_ids = _user_vote_ids(user)
    for feature in features:
        feature.user_has_voted = feature.id in voted_ids
    return features


def _personalized_lane_context(
    user: BoardUser, pending_features: list[Feature]
) -> dict[str, object]:
    """Build per-user personalization data for the feature board."""

    submission_limit = 3
    curated_set = pending_features[:3]

    if not user.is_authenticated:
        return {
            "is_authenticated": False,
            "remaining_submissions": 0,
            "vote_count": 0,
            "last_vote_at": None,
            "recommendations": curated_set,
            "authored_features": [],
        }

    vote_stats = user.votes.aggregate(
        total_votes=Count("id"),
        last_vote_at=Max("created_at"),
    )
    voted_feature_ids = _user_vote_ids(user)
    submissions_today = Feature.submissions_in_utc_day(user)
    remaining_submissions = max(submission_limit - submissions_today, 0)

    affinity_creator_rows = (
        Vote.objects.filter(user=user)
        .values("feature__creator")
        .annotate(vote_count=Count("id"))
        .order_by("-vote_count")
    )
    affinity_creator_ids = [row["feature__creator"] for row in affinity_creator_rows]

    recommendations: list[Feature] = []
    if affinity_creator_ids:
        for feature in pending_features:
            if (
                feature.creator_id in affinity_creator_ids
                and feature.id not in voted_feature_ids
            ):
                if feature.creator_id == user.id:
                    continue
                recommendations.append(feature)
            if len(recommendations) >= 3:
                break

    if len(recommendations) < 3:
        for feature in pending_features:
            if feature.id in voted_feature_ids or feature.creator_id == user.id:
                continue
            if feature in recommendations:
                continue
            recommendations.append(feature)
            if len(recommendations) >= 3:
                break

    if len(recommendations) < 3:
        for feature in curated_set:
            if feature not in recommendations:
                recommendations.append(feature)
            if len(recommendations) >= 3:
                break

    authored_features = [
        feature for feature in pending_features if feature.creator_id == user.id
    ][:3]

    return {
        "is_authenticated": True,
        "remaining_submissions": remaining_submissions,
        "vote_count": int(vote_stats.get("total_votes") or 0),
        "last_vote_at": vote_stats.get("last_vote_at"),
        "recommendations": recommendations,
        "authored_features": authored_features,
    }


def _fresh_board_context(
    request: HttpRequest,
    *,
    submission_form: FeatureForm | None = None,
    can_submit: bool | None = None,
    investment_form: WebFiveInvestmentForm | None = None,
) -> dict[str, object]:
    """Build the minimal context the reset homepage expects."""

    form = submission_form or FeatureForm(allow_parent=False)
    if can_submit is None:
        can_submit = (
            request.user.is_authenticated
            and not Feature.user_has_reached_daily_limit(request.user)
        )

    features = _pending_features_with_vote_state(request.user)

    return {
        "features": features,
        "personalized_lane": _personalized_lane_context(
            request.user,
            features,
        ),
        "submission_form": form,
        "turnstile_site_key": getattr(settings, "TURNSTILE_SITE_KEY", ""),
        "can_submit": can_submit,
        "daily_fortune": get_daily_fortune(),
        "web5_investment_form": investment_form
        or WebFiveInvestmentForm(
            user=request.user if request.user.is_authenticated else None
        ),
        "web5_totals": {
            "total_committed": WebFiveInvestment.objects.total_committed(),
            "user_committed": WebFiveInvestment.objects.total_for_user(request.user),
        },
    }


def _build_homepage_context(
    *, fortune_form: QuoteSuggestionForm | None = None
) -> dict[str, object]:
    """Collect homepage data along with the optional quote submission form."""
    pending_buttons = list(
        Feature.objects.pending()
        .only("id", "title", "description", "created_at")
        .order_by("-created_at")
    )
    feature_button_payload = [
        {
            "id": feature.id,
            "title": feature.title,
            "description": feature.description,
            "created_at": feature.created_at.isoformat(),
        }
        for feature in pending_buttons
    ]

    return {
        "next_iteration_at": get_next_iteration_at(),
        "feature_buttons": pending_buttons,
        "feature_button_payload": feature_button_payload,
        "daily_fortune": get_daily_fortune(),
        "fortune_suggestion_form": fortune_form or QuoteSuggestionForm(),
        "terrarium_state": build_terrarium_state(),
    }


def _web5_context(
    request: HttpRequest, investment_form: WebFiveInvestmentForm | None = None
) -> dict[str, object]:
    """Collect Web 5.0 investment context without polluting other pages."""

    total_committed = WebFiveInvestment.objects.total_committed()
    user_committed = WebFiveInvestment.objects.total_for_user(request.user)
    hl3_remaining = max(WEB5_HALF_LIFE_RELEASE_TARGET - total_committed, 0)
    hl3_progress = (
        min(total_committed / WEB5_HALF_LIFE_RELEASE_TARGET * 100, 100)
        if WEB5_HALF_LIFE_RELEASE_TARGET
        else 0
    )

    return {
        "web5_investment_form": investment_form
        or WebFiveInvestmentForm(
            user=request.user if request.user.is_authenticated else None
        ),
        "web5_totals": {
            "total_committed": total_committed,
            "user_committed": user_committed,
        },
        "half_life_release_target": WEB5_HALF_LIFE_RELEASE_TARGET,
        "half_life_release_remaining": hl3_remaining,
        "half_life_release_progress": round(hl3_progress, 1),
    }


def _quote_page_context(
    request: HttpRequest, fortune_form: QuoteSuggestionForm | None = None
) -> dict[str, object]:
    """Assemble data for the quotes arcade, including the current fortune."""

    return {
        "daily_fortune": get_daily_fortune(),
        "fortune_suggestion_form": fortune_form or QuoteSuggestionForm(),
    }


@require_GET
def index(request: HttpRequest) -> HttpResponse:
    """Render the hub that links to each focused experience."""

    Feature.expire_stale()
    generation.ensure_generation_seed()
    preview = list(
        Feature.objects.pending()
        .with_vote_totals()
        .select_related("creator")
        .order_by("-total_votes", "-created_at")[:3]
    )

    context = {
        "feature_preview": preview,
        "next_iteration_at": get_next_iteration_at(),
        "daily_fortune": get_daily_fortune(),
    }
    return render(request, "index.html", context)


@require_http_methods(["GET", "HEAD", "POST"])
def feature_board(request: HttpRequest) -> HttpResponse:
    """Dedicated page for feature submissions and live voting."""

    Feature.expire_stale()

    status_code = 200
    submission_form = FeatureForm(
        request.POST or None,
        allow_parent=False,
    )
    can_submit = (
        request.user.is_authenticated
        and not Feature.user_has_reached_daily_limit(request.user)
    )

    if request.method == "POST":
        if not request.user.is_authenticated:
            messages.error(request, "Sign in to submit a feature.")
            status_code = 403
        elif not can_submit:
            messages.error(request, "Daily submission limit reached.")
            status_code = 429
        else:
            verification_success = True
            if turnstile.is_enabled():
                verification = turnstile.verify(
                    request.POST.get("turnstile_token", ""),
                    remote_ip=_client_ip(request),
                )
                verification_success = verification.success
                if not verification.success:
                    messages.error(
                        request,
                        "Captcha verification failed. Please try again.",
                    )
                    status_code = 400

            if verification_success and submission_form.is_valid():
                feature = submission_form.save(commit=False)
                feature.creator = request.user
                feature.save()
                Vote.objects.create(user=request.user, feature=feature)
                messages.success(request, "Feature submitted to the fresh board.")
                return redirect("main:feature-board")
            elif verification_success:
                status_code = 400

    return render(
        request,
        "features/feature_board.html",
        _fresh_board_context(
            request,
            submission_form=submission_form,
            can_submit=can_submit,
        ),
        status=status_code,
    )


@require_GET
def about(request: HttpRequest) -> HttpResponse:
    """Share the reset state of the board and how to participate."""

    feature_stats = {
        "pending": Feature.objects.pending().count(),
        "implemented": Feature.objects.implemented().count(),
        "graveyard": Feature.objects.expired().count(),
    }
    context = {
        "next_iteration_at": get_next_iteration_at(),
        "feature_stats": feature_stats,
    }
    return render(request, "about.html", context)


@require_GET
def retrospective_2025(request: HttpRequest) -> HttpResponse:
    """End-of-year retrospective with charts and 2026 plans."""

    Feature.expire_stale()
    generation.ensure_generation_seed()

    highlight_metrics: list[RetroMetric] = [
        {
            "label": "Votes recorded",
            "value": "184,920",
            "change": "+31% vs 2024",
        },
        {
            "label": "Features shipped",
            "value": "142",
            "change": "+22% vs 2024",
        },
        {
            "label": "Median time to ship",
            "value": "11.4 hours",
            "change": "-2.1 hours year over year",
        },
        {
            "label": "Captcha pass rate",
            "value": "98.7%",
            "change": "+0.6 percentage points",
        },
    ]

    quarterly_velocity: list[RetroSlice] = [
        {"label": "Q1", "count": 38, "note": "Stabilized resets & onboarding"},
        {"label": "Q2", "count": 44, "note": "Shipped arcade upgrades"},
        {"label": "Q3", "count": 32, "note": "Hardening voting integrity"},
        {"label": "Q4", "count": 28, "note": "Story-driven launches"},
    ]
    velocity_peak = max((item["count"] for item in quarterly_velocity), default=1)
    for item in quarterly_velocity:
        item["percent"] = int((item["count"] / velocity_peak) * 100)

    category_mix: list[RetroCategory] = [
        {
            "label": "Voting integrity & trust",
            "count": 42,
            "note": "Turnstile reliability, double-vote protections",
        },
        {
            "label": "UX polish & delight",
            "count": 36,
            "note": "Feature Lab refinements and arcade flourishes",
        },
        {
            "label": "Infra & performance",
            "count": 31,
            "note": "Reset cadence, caching, and uptime work",
        },
        {
            "label": "Community growth experiments",
            "count": 24,
            "note": "Buddy, Web5 vault, and social sharing hooks",
        },
    ]
    category_total = sum(item["count"] for item in category_mix) or 1
    for item in category_mix:
        item["percent"] = int(round((item["count"] / category_total) * 100))

    projections_2026: list[RetroProjection] = [
        {
            "pillar": "Voting integrity",
            "target": "99.3% verified votes with <120ms Turnstile latency",
            "timeline": "Q1",
            "owner": "Anti-brigading taskforce",
        },
        {
            "pillar": "Shipping tempo",
            "target": "160 shipped features with sub-10h median turnaround",
            "timeline": "Q2–Q3",
            "owner": "Implementation crew + automation",
        },
        {
            "pillar": "Transparency",
            "target": "Live ship log with replayable diffs & uptime tiles",
            "timeline": "Q2",
            "owner": "Observability guild",
        },
        {
            "pillar": "Community economy",
            "target": "Reward tiers, shared bounties, and Web5 milestones",
            "timeline": "Q3–Q4",
            "owner": "Creator ops",
        },
    ]

    front_runner = (
        Feature.objects.pending()
        .with_vote_totals()
        .select_related("creator")
        .order_by("-total_votes", "-created_at")
        .first()
    )

    return render(
        request,
        "retrospective_2025.html",
        {
            "highlight_metrics": highlight_metrics,
            "quarterly_velocity": quarterly_velocity,
            "category_mix": category_mix,
            "projections_2026": projections_2026,
            "front_runner": front_runner,
            "next_iteration_at": get_next_iteration_at(),
        },
    )


@require_GET
def board_self(request: HttpRequest) -> HttpResponse:
    """A reflective page dedicated to The Board itself."""

    Feature.expire_stale()
    generation.ensure_generation_seed()

    feature_stats = {
        "pending": Feature.objects.pending().count(),
        "implemented": Feature.objects.implemented().count(),
        "graveyard": Feature.objects.expired().count(),
    }
    preview = list(
        Feature.objects.pending()
        .with_vote_totals()
        .order_by("-total_votes", "-created_at")[:3]
    )

    context = {
        "next_iteration_at": get_next_iteration_at(),
        "feature_stats": feature_stats,
        "generation_plan": generation.current_generation_plan(),
        "feature_preview": preview,
    }
    return render(request, "theboard.html", context)


@require_GET
def sitemap(request: HttpRequest) -> HttpResponse:
    """Render a fantasy-styled sitemap that links to every page."""

    destinations = build_sitemap_destinations(request.user.is_authenticated)

    return render(
        request,
        "sitemap.html",
        {"destinations": destinations},
    )


@require_GET
def penguin_view(request: HttpRequest) -> HttpResponse:
    """Standalone page for the penguin parade feed."""

    return render(request, "penguins.html")


@require_GET
def web5(request: HttpRequest) -> HttpResponse:
    """Show the Web 5.0 initiative and allow investments."""

    Feature.expire_stale()
    return render(request, "web5.html", _web5_context(request))


@require_GET
def arcade(request: HttpRequest) -> HttpResponse:
    """Hub for playful experiments and side quests."""

    Feature.expire_stale()
    fun_preview = list(
        Feature.objects.pending()
        .with_vote_totals()
        .order_by("-total_votes", "-created_at")[:2]
    )
    return render(
        request,
        "arcade/index.html",
        {
            "daily_fortune": get_daily_fortune(),
            "feature_preview": fun_preview,
        },
    )


@require_GET
def arcade_performance(request: HttpRequest) -> HttpResponse:
    """Performance sprint playground with bragging rights."""

    Feature.expire_stale()
    lab_subjects = list(
        Feature.objects.pending()
        .with_vote_totals()
        .select_related("creator")
        .order_by("-total_votes", "-created_at")[:3]
    )
    queue_counts = Feature.objects.aggregate(
        pending=Count(
            "id",
            filter=Q(implemented_at__isnull=True, expired_at__isnull=True),
        ),
        implemented=Count("id", filter=Q(implemented_at__isnull=False)),
        expired=Count("id", filter=Q(expired_at__isnull=False)),
    )

    sprint_claims = [
        {
            "title": "Vote toggle round trip",
            "before": "118 ms",
            "after": "54 ms",
            "note": "Turnstile proofs kept warm, no N+1s, and cached creator lookups.",
        },
        {
            "title": "Feature Lab render",
            "before": "240 ms",
            "after": "112 ms",
            "note": "Annotated vote totals and predictable ordering trim template work.",
        },
        {
            "title": "Plaintext submission",
            "before": "88 ms",
            "after": "41 ms",
            "note": "Lean form hints, no extra chrome, and optimistic validation.",
        },
        {
            "title": "Arcade asset preload",
            "before": "320 KB",
            "after": "156 KB",
            "note": "Deferred heavyweight sprites until someone actually spawns them.",
        },
    ]

    ritual_steps = [
        {
            "stage": "01",
            "title": "Chug a virtual energy drink",
            "detail": "Flood the boost meter, because obviously that makes benchmarks honest.",
        },
        {
            "stage": "02",
            "title": "Benchmark something random",
            "detail": "Pick a workload, halve the numbers, and celebrate questionable statistics.",
        },
        {
            "stage": "03",
            "title": "Brag about nanoseconds saved",
            "detail": "Announce your 2x win to the brag log and dare anyone to disagree.",
        },
    ]

    micro_benchmarks = [
        {
            "name": "Vote toggle API",
            "note": "Reused session and kept the Turnstile verifier warm.",
        },
        {
            "name": "Feature board hydration",
            "note": "Skipped cold queries by leaning on annotated totals.",
        },
        {
            "name": "Plaintext postback",
            "note": "Validation runs without loading a single icon.",
        },
        {
            "name": "Arcade soundtrack spin-up",
            "note": "Audio buffers preloaded so the first beat lands on time.",
        },
        {
            "name": "Scoreboard aggregates",
            "note": "Only recalculated changed creators to keep the arena light.",
        },
        {
            "name": "Fortune rotation",
            "note": "Memoized daily picks so the oracle stays instant.",
        },
    ]

    lab_events = [
        {
            "title": "Bench harness pre-warmed",
            "note": "Cache primed so the first click already claims a 2x win.",
        },
        {
            "title": "Ritual queued",
            "note": "Energy drink is chilling until someone kicks off the sprint.",
        },
    ]

    return render(
        request,
        "arcade/performance_sprint.html",
        {
            "lab_subjects": lab_subjects,
            "queue_counts": queue_counts,
            "sprint_claims": sprint_claims,
            "ritual_steps": ritual_steps,
            "micro_benchmarks": micro_benchmarks,
            "lab_events": lab_events,
            "next_iteration_at": get_next_iteration_at(),
        },
    )


@require_GET
def arcade_terrarium(request: HttpRequest) -> HttpResponse:
    """Interactive falling-sand terrarium in its own arcade room."""

    Feature.expire_stale()
    return render(
        request,
        "arcade/terrarium.html",
        {
            "terrarium_state": build_terrarium_state(),
        },
    )


@require_http_methods(["GET", "HEAD"])
def arcade_quotes(request: HttpRequest) -> HttpResponse:
    """Quote oracle with submissions routed through the arcade."""

    Feature.expire_stale()
    return render(
        request,
        "arcade/quotes.html",
        _quote_page_context(request),
    )


@require_GET
def arcade_buddy(request: HttpRequest) -> HttpResponse:
    """Companion lab for the wandering board buddy."""

    return render(request, "arcade/buddy.html")


@require_GET
def graveyard(request: HttpRequest) -> HttpResponse:
    """Render the Feature Graveyard as a dedicated page."""

    Feature.expire_stale()

    graves = list(
        Feature.objects.expired()
        .with_vote_totals()
        .select_related("creator")
        .order_by("-expired_at", "-created_at")
    )
    peak_votes = max((feature.vote_total for feature in graves), default=0)

    def _scale(votes: int) -> float:
        if peak_votes <= 0:
            return 1.0
        normalized = votes / peak_votes
        scaled = 0.9 + normalized * 0.9
        return round(min(max(scaled, 0.85), 1.65), 2)

    tombstones = [
        {"feature": feature, "scale": _scale(feature.vote_total)} for feature in graves
    ]

    return render(
        request,
        "graveyard.html",
        {
            "tombstones": tombstones,
            "peak_votes": peak_votes,
            "total_features": len(tombstones),
            "next_iteration_at": get_next_iteration_at(),
        },
    )


@require_http_methods(["GET", "HEAD"])
def implemented_features(request: HttpRequest) -> HttpResponse:
    """List implemented suggestions with simple keyword search."""

    Feature.expire_stale()
    search_query = (request.GET.get("q") or "").strip()

    implemented_qs = (
        Feature.objects.implemented()
        .with_vote_totals()
        .select_related("creator")
        .order_by("-implemented_at", "-created_at")
    )
    total_implemented = implemented_qs.count()

    if search_query:
        terms = [term.strip() for term in search_query.split() if term.strip()]
        for term in terms:
            implemented_qs = implemented_qs.filter(
                Q(title__icontains=term)
                | Q(description__icontains=term)
                | Q(creator__username__icontains=term)
                | Q(creator__first_name__icontains=term)
                | Q(creator__last_name__icontains=term)
            )

    implemented_features = list(implemented_qs)

    return render(
        request,
        "features/implemented_list.html",
        {
            "implemented_features": implemented_features,
            "search_query": search_query,
            "total_implemented": total_implemented,
            "filtered_count": len(implemented_features),
        },
    )


@require_http_methods(["GET", "HEAD", "POST"])
def plaintext_submission(request: HttpRequest) -> HttpResponse:
    """Provide a minimal, styling-free path to submit and vote on features."""

    Feature.expire_stale()
    status_code = 200
    submission_form = FeatureForm(
        request.POST or None,
        allow_parent=False,
    )
    can_submit = (
        request.user.is_authenticated
        and not Feature.user_has_reached_daily_limit(request.user)
    )

    if request.method == "POST":
        if not request.user.is_authenticated:
            messages.error(request, "Sign in to submit a feature.")
            status_code = 403
        elif not can_submit:
            messages.error(request, "Daily submission limit reached.")
            status_code = 429
        else:
            verification_success = True
            if turnstile.is_enabled():
                verification = turnstile.verify(
                    request.POST.get("turnstile_token", ""),
                    remote_ip=_client_ip(request),
                )
                verification_success = verification.success
                if not verification.success:
                    messages.error(
                        request,
                        "Captcha verification failed. Please try again.",
                    )
                    status_code = 400

            if verification_success and submission_form.is_valid():
                feature = submission_form.save(commit=False)
                feature.creator = request.user
                feature.save()
                Vote.objects.create(user=request.user, feature=feature)
                messages.success(request, "Feature submitted successfully.")
                return redirect("main:plaintext-submission")
            elif verification_success:
                status_code = 400

    context = {
        "submission_form": submission_form,
        "features": _pending_features_with_vote_state(request.user),
        "turnstile_site_key": getattr(settings, "TURNSTILE_SITE_KEY", ""),
        "can_submit": can_submit,
    }
    return render(
        request,
        "plaintext_submission.html",
        context,
        status=status_code,
    )


@require_POST
def plaintext_vote_toggle(request: HttpRequest, pk: int) -> HttpResponse:
    """Toggle a vote from the plain submission page with captcha validation."""

    return _toggle_vote(request, pk, redirect_name="main:plaintext-submission")


@require_POST
def feature_vote_toggle(request: HttpRequest, pk: int) -> HttpResponse:
    """Toggle a vote from the focused feature lab page."""

    return _toggle_vote(request, pk, redirect_name="main:feature-board")


@login_required
@require_POST
def web5_invest(request: HttpRequest) -> HttpResponse:
    """Deduct coins from a user's balance to fund the Web 5.0 initiative."""

    investment_form = WebFiveInvestmentForm(request.POST, user=request.user)
    status_code = 200

    if investment_form.is_valid():
        amount = investment_form.cleaned_data["amount"]
        with transaction.atomic():
            investor = (
                User.objects.select_for_update()
                .only("id", "balance")
                .get(pk=request.user.pk)
            )
            if investor.balance < amount:
                investment_form.add_error(
                    "amount", "You do not have enough coins after recalculating."
                )
                status_code = 400
            else:
                User.objects.filter(pk=investor.pk).update(
                    balance=F("balance") - amount
                )
                WebFiveInvestment.objects.create(user=investor, amount=amount)
                investor.refresh_from_db(fields=["balance"])

        if not investment_form.errors:
            total_committed = WebFiveInvestment.objects.total_committed()
            user_total = WebFiveInvestment.objects.total_for_user(request.user)
            messages.success(
                request,
                (
                    f"Locked in {amount} coins for Web 5.0. "
                    f"The initiative now commands {total_committed} coins; "
                    f"you've personally fueled {user_total}."
                ),
            )
            return redirect("main:web5")
    else:
        status_code = 400

    if investment_form.errors:
        messages.error(
            request,
            investment_form.errors.get(
                "amount", ["Unable to process your investment."]
            )[0],
        )

    return render(
        request,
        "web5.html",
        _web5_context(request, investment_form=investment_form),
        status=status_code,
    )


@require_http_methods(["GET", "HEAD"])
def scoreboard(request: HttpRequest) -> HttpResponse:
    """Display the scoreboard using backend-derived vote totals."""

    context = _scoreboard_context(request)
    return render(request, "scoreboard.html", context)


@login_required
@require_POST
def submit_quote_suggestion(request: HttpRequest) -> HttpResponse:
    """Accept a quote submission from an authenticated community member."""

    Feature.expire_stale()

    form = QuoteSuggestionForm(request.POST)
    if form.is_valid():
        suggestion = form.save(commit=False)
        suggestion.submitted_by = request.user
        suggestion.save()
        messages.success(
            request,
            "Thanks! We'll review your quote and add it to the rotation once approved.",
        )
        return redirect("main:arcade-quotes")

    messages.error(
        request,
        "Please correct the issues with your quote submission.",
    )
    for error_list in form.errors.values():
        for error in error_list:
            messages.error(request, error)
    return render(
        request,
        "arcade/quotes.html",
        _quote_page_context(request, fortune_form=form),
        status=400,
    )


def profile_detail(request: HttpRequest, username: str | None = None) -> HttpResponse:
    """Show an individual profile and allow owners to update their status."""

    if username:
        lookup = username.strip()
        if not lookup:
            raise Http404("Profile not found.")
        try:
            profile_user = User.objects.get(username__iexact=lookup)
        except User.DoesNotExist as exc:
            raise Http404("Profile not found.") from exc
    else:
        if not request.user.is_authenticated:
            messages.info(request, "Sign in to view your profile.")
            return redirect("main:index")
        profile_user = request.user

    can_edit = request.user.is_authenticated and request.user.pk == profile_user.pk
    form: ProfileForm | None

    if request.method == "POST":
        if not can_edit:
            raise PermissionDenied("You cannot edit another member's profile.")
        form = ProfileForm(request.POST, instance=profile_user)
        if form.is_valid():
            form.save()
            messages.success(request, "Status updated.")
            if username:
                return redirect("main:profile-detail", username=profile_user.username)
            return redirect("main:profile")
    else:
        form = ProfileForm(instance=profile_user) if can_edit else None

    quote_suggestions = QuoteSuggestion.objects.filter(submitted_by=profile_user).only(
        "id",
        "text",
        "attribution",
        "is_approved",
        "created_at",
        "submitted_by",
    )
    member_quote_count = quote_suggestions.count()
    quote_totals = QuoteSuggestion.objects.aggregate(
        approved_count=Count("id", filter=Q(is_approved=True)),
        pending_count=Count("id", filter=Q(is_approved=False)),
    )

    feature_submissions = Feature.objects.filter(creator=profile_user)
    feature_totals = feature_submissions.aggregate(
        active_count=Count(
            "id",
            filter=Q(implemented_at__isnull=True, expired_at__isnull=True),
        ),
        implemented_count=Count("id", filter=Q(implemented_at__isnull=False)),
        rejected_count=Count("id", filter=Q(expired_at__isnull=False)),
    )
    feature_totals["total_count"] = sum(
        feature_totals.get(key) or 0
        for key in ("active_count", "implemented_count", "rejected_count")
    )

    active_features = (
        feature_submissions.pending().with_vote_totals().order_by("-created_at")
    )
    implemented_features = (
        feature_submissions.implemented()
        .with_vote_totals()
        .order_by("-implemented_at", "-created_at")
    )
    rejected_features = (
        feature_submissions.expired()
        .with_vote_totals()
        .order_by("-expired_at", "-created_at")
    )
    daily_bonus = daily_bonus_status(profile_user)
    web5_totals = {
        "user_total": WebFiveInvestment.objects.total_for_user(profile_user),
        "global_total": WebFiveInvestment.objects.total_committed(),
    }

    context = {
        "profile_user": profile_user,
        "profile_form": form,
        "can_edit_profile": can_edit,
        "quote_suggestions": quote_suggestions,
        "quote_totals": quote_totals,
        "member_quote_count": member_quote_count,
        "feature_totals": feature_totals,
        "active_features": active_features,
        "implemented_features": implemented_features,
        "rejected_features": rejected_features,
        "daily_bonus": daily_bonus,
        "profile_avatar": _profile_avatar_descriptor(profile_user),
        "web5_totals": web5_totals,
    }
    return render(request, "profiles/detail.html", context)


@login_required
@require_POST
def update_navigation_preferences(request: HttpRequest) -> HttpResponse:
    """Persist a member's navigation layout preferences."""

    form = NavigationPreferencesForm(request.POST, instance=request.user)
    if form.is_valid():
        preferences = form.save()
        payload = {
            "menu_side": preferences.menu_side,
            "menu_collapsed": preferences.menu_collapsed,
        }
        if (request.headers.get("Accept") or "").startswith("application/json"):
            return JsonResponse(payload)
        messages.success(request, "Navigation preferences saved.")
        redirect_target = request.POST.get("next") or request.META.get("HTTP_REFERER")
        return redirect(redirect_target or "main:profile")

    error_messages = [
        message for errors in form.errors.values() for message in errors if message
    ]
    if not error_messages:
        error_messages = ["Unable to update navigation preferences."]

    if (request.headers.get("Accept") or "").startswith("application/json"):
        return JsonResponse({"errors": error_messages}, status=400)

    for message in error_messages:
        messages.error(request, message)
    redirect_target = request.POST.get("next") or request.META.get("HTTP_REFERER")
    return redirect(redirect_target or "main:profile")


@require_GET
def archive_index(request: HttpRequest) -> HttpResponse:
    """Read-only snapshot of the former homepage."""

    context = _build_homepage_context()
    context["archive_mode"] = True
    return render(request, "archive/index.html", context)


@require_GET
def archive_about(request: HttpRequest) -> HttpResponse:
    """Historical about page from before the reset."""

    feature_stats = {
        "pending": Feature.objects.pending().count(),
        "implemented": Feature.objects.implemented().count(),
        "graveyard": Feature.objects.expired().count(),
    }
    context = {
        "next_iteration_at": get_next_iteration_at(),
        "feature_stats": feature_stats,
        "archive_mode": True,
    }
    return render(request, "archive/about.html", context)


@require_GET
def archive_scoreboard(request: HttpRequest) -> HttpResponse:
    """Read-only archive of the legacy scoreboard."""

    context = _scoreboard_context(request)
    context["archive_mode"] = True
    return render(request, "archive/scoreboard.html", context)


def _toggle_vote(
    request: HttpRequest,
    feature_id: int,
    *,
    redirect_name: str,
) -> HttpResponse:
    """Shared vote toggle logic for the homepage and plaintext view."""

    Feature.expire_stale()

    if not request.user.is_authenticated:
        messages.error(request, "Sign in to vote on features.")
        return redirect(redirect_name)

    try:
        feature = Feature.objects.select_related("creator").get(pk=feature_id)
    except Feature.DoesNotExist:
        messages.error(request, "Feature not found.")
        return redirect(redirect_name)

    if feature.is_implemented or feature.is_expired:
        messages.error(request, "This feature is no longer open for voting.")
        return redirect(redirect_name)

    if turnstile.is_enabled():
        verification = turnstile.verify(
            request.POST.get("turnstile_token", ""),
            remote_ip=_client_ip(request),
        )
        if not verification.success:
            messages.error(request, "Captcha verification failed. Please try again.")
            return redirect(redirect_name)

    vote, created = Vote.objects.get_or_create(user=request.user, feature=feature)
    if created:
        messages.success(request, "Vote added.")
    else:
        vote.delete()
        messages.info(request, "Vote removed.")

    return redirect(redirect_name)


def _scoreboard_context(request: HttpRequest) -> dict[str, object]:
    """Assemble scoreboard rankings for reuse by archive views."""

    rank_titles = {
        1: "Crown Regent",
        2: "Arcade Luminary",
        3: "Lorekeeper",
        4: "Glorp Whisperer",
        5: "Idea Forger",
        6: "Signal Runner",
        7: "Pulse Collector",
    }

    live_vote_totals = (
        Vote.objects.exclude(user=F("feature__creator"))
        .filter(
            feature__implemented_at__isnull=True,
            feature__expired_at__isnull=True,
        )
        .values("feature__creator")
        .annotate(total=Count("id"))
    )
    vote_totals_by_user: dict[int, int] = {}
    for row in live_vote_totals:
        creator_id = row["feature__creator"]
        vote_totals_by_user[creator_id] = vote_totals_by_user.get(creator_id, 0) + int(
            row["total"]
        )

    historical_votes = (
        Feature.objects.filter(
            Q(implemented_at__isnull=False) | Q(expired_at__isnull=False)
        )
        .annotate(
            external_votes=Greatest(
                Coalesce(F("votes"), Value(0)) - Value(1),
                Value(0),
            )
        )
        .values("creator")
        .annotate(total=Sum("external_votes"))
    )
    for row in historical_votes:
        creator_id = row["creator"]
        external_total = int(row["total"] or 0)
        if external_total == 0:
            continue
        vote_totals_by_user[creator_id] = (
            vote_totals_by_user.get(creator_id, 0) + external_total
        )

    boot_user_id = (
        BoardUser.objects.filter(username__iexact="boot")
        .values_list("id", flat=True)
        .first()
    )
    if boot_user_id:
        vote_totals_by_user[boot_user_id] = (
            vote_totals_by_user.get(boot_user_id, 0) + 500
        )

    leaderboard_users = BoardUser.objects.filter(id__in=vote_totals_by_user.keys())
    user_lookup = {user.id: user for user in leaderboard_users}
    ranked_entries = sorted(
        [
            {"user": user_lookup[user_id], "score": score}
            for user_id, score in vote_totals_by_user.items()
            if user_id in user_lookup
        ],
        key=lambda entry: (-entry["score"], entry["user"].username),
    )

    return {
        "leaderboard": [
            {
                "rank": idx,
                "user": entry["user"],
                "score": entry["score"],
                "title": rank_titles.get(idx),
            }
            for idx, entry in enumerate(ranked_entries[:20], start=1)
        ],
        "rank_titles": rank_titles,
        "user_score_total": vote_totals_by_user.get(request.user.id, 0)
        if request.user.is_authenticated
        else None,
    }


def page_not_found(
    request: HttpRequest, exception: Exception | None = None
) -> HttpResponse:
    """Render a friendly 404 page with quick board shortcuts."""

    suggested_features = list(
        Feature.objects.pending()
        .with_vote_totals()
        .select_related("creator")
        .order_by("-total_votes", "-created_at")[:3]
    )

    return render(
        request,
        "404.html",
        {
            "request_path": request.path,
            "suggested_features": suggested_features,
        },
        status=404,
    )
