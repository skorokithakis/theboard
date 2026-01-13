"""Aggregation and caching helpers for the scoreboard."""

from __future__ import annotations

from collections import Counter
from typing import Iterable

from django.core.cache import cache
from django.db.models import Count, F, Q, Sum, Value
from django.db.models.functions import Coalesce, Greatest

from .models import Feature, User as BoardUser, Vote

SCOREBOARD_CACHE_KEY = "scoreboard:snapshot:v1"
SCOREBOARD_CACHE_TIMEOUT_SECONDS = 45
BOOT_USER_BONUS = 500


def _boot_user_id() -> int | None:
    """Return the boot user ID if it exists."""
    return (
        BoardUser.objects.filter(username__iexact="boot")
        .values_list("id", flat=True)
        .first()
    )


def _aggregate_live_votes() -> Counter[int]:
    """Count peer votes for pending features keyed by creator ID."""
    totals: Counter[int] = Counter()
    live_vote_totals = (
        Vote.objects.exclude(user=F("feature__creator"))
        .filter(
            feature__implemented_at__isnull=True,
            feature__expired_at__isnull=True,
        )
        .values("feature__creator")
        .annotate(total=Count("id"))
    )
    for row in live_vote_totals:
        creator_id = row["feature__creator"]
        if creator_id is None:
            continue
        totals[creator_id] += int(row["total"] or 0)
    return totals


def _aggregate_historical_votes() -> Counter[int]:
    """Count snapshot votes from implemented or expired features."""
    totals: Counter[int] = Counter()
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
        total = int(row["total"] or 0)
        if creator_id is None or total <= 0:
            continue
        totals[creator_id] += total
    return totals


def _sorted_leaderboard_entries(
    vote_totals_by_user: Iterable[tuple[int, int]]
) -> list[dict[str, object]]:
    """Resolve leaderboard users and return sorted entry dictionaries."""
    user_ids = [user_id for user_id, _ in vote_totals_by_user]
    leaderboard_users = BoardUser.objects.filter(id__in=user_ids).only(
        "id",
        "username",
        "first_name",
        "last_name",
        "avatar",
    )
    user_lookup = {user.id: user for user in leaderboard_users}
    ranked_entries = sorted(
        (
            {"user": user_lookup[user_id], "score": score}
            for user_id, score in vote_totals_by_user
            if user_id in user_lookup
        ),
        key=lambda entry: (-entry["score"], entry["user"].username),
    )
    return ranked_entries


def scoreboard_snapshot() -> tuple[list[dict[str, object]], dict[int, int]]:
    """Return cached scoreboard data or recompute it quickly."""
    cached = cache.get(SCOREBOARD_CACHE_KEY)
    if cached:
        return cached

    vote_totals_by_user: Counter[int] = Counter()
    vote_totals_by_user.update(_aggregate_live_votes())
    vote_totals_by_user.update(_aggregate_historical_votes())

    boot_user_id = _boot_user_id()
    if boot_user_id:
        vote_totals_by_user[boot_user_id] += BOOT_USER_BONUS

    ranked_entries = _sorted_leaderboard_entries(vote_totals_by_user.items())
    snapshot = (ranked_entries, dict(vote_totals_by_user))
    cache.set(SCOREBOARD_CACHE_KEY, snapshot, SCOREBOARD_CACHE_TIMEOUT_SECONDS)
    return snapshot


def reset_scoreboard_cache() -> None:
    """Clear cached scoreboard aggregates."""
    cache.delete(SCOREBOARD_CACHE_KEY)
