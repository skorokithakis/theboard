"""Views for the feature board experience."""

from __future__ import annotations

from django.http import HttpRequest
from django.http import HttpResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET

from .fortune import get_daily_fortune
from .models import Feature
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
    }
    return render(request, "index.html", context)
