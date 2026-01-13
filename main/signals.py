"""Signal handlers for cache invalidation and bookkeeping."""

from __future__ import annotations

from typing import Iterable

from django.db.models.signals import post_save
from django.dispatch import receiver

from . import scoreboard
from .models import Feature, Vote


def _update_fields_changed(
    update_fields: Iterable[str] | None, tracked_fields: set[str]
) -> bool:
    """Return True when watched fields changed or updates are unspecified."""
    if not update_fields:
        return True
    return bool(tracked_fields.intersection(update_fields))


@receiver(post_save, sender=Vote)
def clear_scoreboard_cache_on_vote_save(sender, instance: Vote, **kwargs) -> None:  # noqa: D401
    """Reset the scoreboard cache whenever votes are created or updated."""
    scoreboard.reset_scoreboard_cache()


@receiver(post_save, sender=Feature)
def clear_scoreboard_cache_on_feature_save(
    sender, instance: Feature, update_fields=None, **kwargs
) -> None:
    """Reset the scoreboard cache when feature state affects totals."""
    tracked_fields = {"votes", "implemented_at", "expired_at", "creator_id"}
    if _update_fields_changed(update_fields, tracked_fields):
        scoreboard.reset_scoreboard_cache()
