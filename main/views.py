"""Views for the feature board experience."""

from __future__ import annotations

import hashlib

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.db.models import Count, F, Q, Sum, Value
from django.db.models.functions import Coalesce, Greatest
from django.http import Http404, HttpRequest, HttpResponse
from django.shortcuts import redirect, render
from django.views.decorators.http import require_GET, require_POST, require_http_methods
from django.core.exceptions import PermissionDenied

from .economy import daily_bonus_status
from .forms import (
    FeatureForm,
    ProfileForm,
    QuoteSuggestionForm,
    WebFiveInvestmentForm,
)
from .fortune import get_daily_fortune
from .models import Feature, QuoteSuggestion, User as BoardUser, Vote, WebFiveInvestment
from .terrarium import build_terrarium_state
from . import turnstile
from .utils import get_next_iteration_at

User = get_user_model()


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
    features = list(
        Feature.objects.pending().ordered_by_popularity().select_related("creator")
    )
    voted_ids = _user_vote_ids(user)
    for feature in features:
        feature.user_has_voted = feature.id in voted_ids
    return features


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

    return {
        "features": _pending_features_with_vote_state(request.user),
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


@require_http_methods(["GET", "HEAD", "POST"])
def index(request: HttpRequest) -> HttpResponse:
    """Render the pared-down board with just voting and submissions."""

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
                return redirect("main:index")
            elif verification_success:
                status_code = 400

    return render(
        request,
        "index.html",
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
    """Toggle a vote from the simplified homepage."""

    return _toggle_vote(request, pk, redirect_name="main:index")


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
            return redirect("main:index")
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
        "index.html",
        _fresh_board_context(
            request,
            investment_form=investment_form,
        ),
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
        return redirect("main:index")

    messages.error(
        request,
        "Please correct the issues with your quote submission.",
    )
    for error_list in form.errors.values():
        for error in error_list:
            messages.error(request, error)
    return render(
        request,
        "index.html",
        _fresh_board_context(request),
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
