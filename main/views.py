"""Views for the feature board experience."""

from __future__ import annotations

from django.http import HttpRequest
from django.http import HttpResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET

from .models import Feature
from .utils import get_next_iteration_at


@require_GET
def index(request: HttpRequest) -> HttpResponse:
    button_features = (
        Feature.objects.pending()
        .only("id", "title", "description", "created_at")
        .order_by("-created_at")
    )
    context = {
        "next_iteration_at": get_next_iteration_at(),
        "feature_buttons": button_features,
    }
    return render(request, "index.html", context)
