"""Views for the feature board experience."""

from __future__ import annotations

from django.http import Http404, HttpRequest, HttpResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET

from .fortune import get_daily_fortune
from .models import Feature
from .reports import get_latest_reports, get_report, get_reports
from .utils import get_next_iteration_at


@require_GET
def index(request: HttpRequest) -> HttpResponse:
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

    context = {
        "next_iteration_at": get_next_iteration_at(),
        "feature_buttons": pending_buttons,
        "feature_button_payload": feature_button_payload,
        "daily_fortune": get_daily_fortune(),
        "latest_reports": get_latest_reports(),
    }
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
