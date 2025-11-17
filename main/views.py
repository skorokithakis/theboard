"""Views for the feature board experience."""

from __future__ import annotations

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.http import Http404, HttpRequest, HttpResponse
from django.shortcuts import redirect, render
from django.views.decorators.http import require_GET, require_POST

from .forms import QuoteSuggestionForm
from .fortune import get_daily_fortune
from .models import Feature
from .reports import get_latest_reports, get_report, get_reports
from .utils import get_next_iteration_at


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
        "latest_reports": get_latest_reports(),
        "fortune_suggestion_form": fortune_form or QuoteSuggestionForm(),
    }


@require_GET
def index(request: HttpRequest) -> HttpResponse:
    """Render the marketing homepage."""
    context = _build_homepage_context()
    return render(request, "index.html", context)


@require_GET
def report_index(request: HttpRequest) -> HttpResponse:
    """List all implementation reports."""
    return render(
        request,
        "reports/list.html",
        {
            "reports": get_reports(),
        },
    )


@require_GET
def report_detail(request: HttpRequest, slug: str) -> HttpResponse:
    """Render a single report entry."""
    try:
        report = get_report(slug)
    except LookupError as exc:
        raise Http404(str(exc)) from exc

    additional_reports = [item for item in get_reports() if item.slug != slug][:3]
    context = {
        "report": report,
        "additional_reports": additional_reports,
    }
    return render(request, "reports/detail.html", context)


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
