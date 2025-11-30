"""Views for the feature board experience."""

from __future__ import annotations

import hashlib

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.db.models import Count, Q
from django.http import Http404, HttpRequest, HttpResponse
from django.shortcuts import redirect, render
from django.views.decorators.http import require_GET, require_POST, require_http_methods
from django.core.exceptions import PermissionDenied

from .economy import daily_bonus_status
from .forms import FeatureForm, ProfileForm, QuoteSuggestionForm, ScoreRecordForm
from .fortune import get_daily_fortune
from .models import Feature, QuoteSuggestion, ScoreRecord, User as BoardUser, Vote
from .terrarium import build_terrarium_state
from . import turnstile
from .utils import get_next_iteration_at

User = get_user_model()


def _client_ip(request: HttpRequest) -> str | None:
    """Extract client IP from request headers."""
    forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
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


@require_GET
def index(request: HttpRequest) -> HttpResponse:
    """Render the marketing homepage."""
    context = _build_homepage_context()
    return render(request, "index.html", context)


@require_GET
def about(request: HttpRequest) -> HttpResponse:
    """Share the story and mechanics behind the board."""

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

    vote_ids = _user_vote_ids(request.user)
    features = list(
        Feature.objects.pending().ordered_by_popularity().select_related("creator")
    )
    for feature in features:
        feature.user_has_voted = feature.id in vote_ids

    context = {
        "submission_form": submission_form,
        "features": features,
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

    Feature.expire_stale()

    if not request.user.is_authenticated:
        messages.error(request, "Sign in to vote on features.")
        return redirect("main:plaintext-submission")

    try:
        feature = Feature.objects.select_related("creator").get(pk=pk)
    except Feature.DoesNotExist:
        messages.error(request, "Feature not found.")
        return redirect("main:plaintext-submission")

    if feature.is_implemented or feature.is_expired:
        messages.error(request, "This feature is no longer open for voting.")
        return redirect("main:plaintext-submission")

    if turnstile.is_enabled():
        verification = turnstile.verify(
            request.POST.get("turnstile_token", ""),
            remote_ip=_client_ip(request),
        )
        if not verification.success:
            messages.error(request, "Captcha verification failed. Please try again.")
            return redirect("main:plaintext-submission")

    vote, created = Vote.objects.get_or_create(user=request.user, feature=feature)
    if created:
        messages.success(request, "Vote added.")
    else:
        vote.delete()
        messages.info(request, "Vote removed.")

    return redirect("main:plaintext-submission")


@require_http_methods(["GET", "HEAD", "POST"])
def scoreboard(request: HttpRequest) -> HttpResponse:
    """Display the scoreboard and allow members to log their scores."""

    rank_titles = {
        1: "Crown Regent",
        2: "Arcade Luminary",
        3: "Lorekeeper",
        4: "Glorp Whisperer",
        5: "Idea Forger",
        6: "Signal Runner",
        7: "Pulse Collector",
    }

    if request.method == "POST":
        if not request.user.is_authenticated:
            messages.info(
                request, "Sign in through the board controls to record your score."
            )
            return redirect("main:scoreboard")

        record, _ = ScoreRecord.objects.get_or_create(user=request.user)
        form = ScoreRecordForm(request.POST, instance=record)
        if form.is_valid():
            form.save()
            messages.success(request, "Your scoreboard entry has been updated.")
            return redirect("main:scoreboard")
    else:
        record = None
        if request.user.is_authenticated:
            record = ScoreRecord.objects.filter(user=request.user).first()
        form = ScoreRecordForm(instance=record)

    leaderboard = ScoreRecord.objects.leaderboard(limit=20)
    user_score_record = None
    if request.user.is_authenticated:
        user_score_record = (
            ScoreRecord.objects.with_totals()
            .select_related("user")
            .filter(user=request.user)
            .first()
        )
    context = {
        "leaderboard": [
            {"rank": idx, "record": record, "title": rank_titles.get(idx)}
            for idx, record in enumerate(leaderboard, start=1)
        ],
        "rank_titles": rank_titles,
        "score_form": form,
        "user_score_record": user_score_record,
    }
    return render(request, "scoreboard.html", context)


@login_required
@require_POST
def submit_quote_suggestion(request: HttpRequest) -> HttpResponse:
    """Accept a quote submission from an authenticated community member."""

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
    context = _build_homepage_context(fortune_form=form)
    return render(request, "index.html", context, status=400)


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
    }
    return render(request, "profiles/detail.html", context)
