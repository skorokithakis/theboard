"""Views for the feature board experience."""

from __future__ import annotations

from django.http import HttpRequest
from django.http import HttpResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET


@require_GET
def index(request: HttpRequest) -> HttpResponse:
    return render(request, "index.html")
