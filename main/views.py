"""Views for the feature board experience."""

from __future__ import annotations

from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.db.models import Count, Q
from django.http import Http404, HttpRequest, HttpResponse
from django.shortcuts import redirect, render
from django.views.decorators.http import require_GET, require_POST
from django.core.exceptions import PermissionDenied

from .forms import ProfileForm, QuoteSuggestionForm
from .fortune import get_daily_fortune
from .models import Feature, QuoteSuggestion
from .utils import get_next_iteration_at

User = get_user_model()


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
    }


@require_GET
def index(request: HttpRequest) -> HttpResponse:
    """Render the marketing homepage."""
    context = _build_homepage_context()
    return render(request, "index.html", context)


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
    quote_totals = QuoteSuggestion.objects.aggregate(
        approved_count=Count("id", filter=Q(is_approved=True)),
        pending_count=Count("id", filter=Q(is_approved=False)),
    )

    context = {
        "profile_user": profile_user,
        "profile_form": form,
        "can_edit_profile": can_edit,
        "quote_suggestions": quote_suggestions,
        "quote_totals": quote_totals,
    }
    return render(request, "profiles/detail.html", context)
