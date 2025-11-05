"""Utility helpers for The Board."""

from __future__ import annotations

from datetime import timedelta, timezone as dt_timezone

from django.utils import timezone


def get_next_iteration_at(reference=None):
    """Return timestamp for the next automation iteration (midnight UTC)."""
    now = reference or timezone.now()
    now_utc = now.astimezone(dt_timezone.utc)
    return (now_utc + timedelta(days=1)).replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )
