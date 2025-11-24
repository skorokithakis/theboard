"""Dynamic terrarium state helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone as dt_timezone
from typing import TypedDict

from django.utils import timezone

from .health import BoardHealthPayload, get_board_health
from .models import Feature, Vote


class TerrariumState(TypedDict):
    """Payload describing how the terrarium should render."""

    key: str
    headline: str
    note: str
    sun: str
    water: str
    mood: str
    label: str
    aria_label: str


@dataclass(frozen=True)
class TerrariumMetrics:
    """Runtime metrics pulled from the board to drive the terrarium."""

    board_health: BoardHealthPayload
    top_feature: Feature | None
    pending_count: int
    top_feature_votes: int
    last_vote_at: datetime | None
    votes_today: int


def build_terrarium_state(reference: datetime | None = None) -> TerrariumState:
    """Return a descriptive snapshot of the terrarium based on board activity."""

    now = reference or timezone.now()
    metrics = _collect_metrics(now)
    hours_since_vote: float | None = None
    if metrics.last_vote_at:
        delta = now - metrics.last_vote_at
        hours_since_vote = delta.total_seconds() / 3600

    state_key = _determine_state(
        board_health=metrics.board_health,
        hours_since_vote=hours_since_vote,
        pending_count=metrics.pending_count,
        votes_today=metrics.votes_today,
    )
    top_title = metrics.top_feature.title if metrics.top_feature else None
    last_vote_label = _format_last_vote_label(metrics.last_vote_at, now)
    vote_activity = (
        f"{metrics.votes_today} vote{'s' if metrics.votes_today != 1 else ''} today"
    )

    base_note = (
        f"Backlog has {metrics.pending_count} "
        f"{'ideas' if metrics.pending_count != 1 else 'idea'}."
    )

    if state_key == "thriving":
        note = (
            f"{vote_activity}—the mist is constant ({last_vote_label}). "
            f"{base_note}"
        )
        sun = (
            f"{metrics.board_health['percentage']}% health; "
            "warm glass amplifies every glow."
        )
        water = f"Misted after nearly every reset; last mist {last_vote_label}."
        mood = (
            f"Stretching toward {top_title!r} with {metrics.top_feature_votes} votes."
            if top_title
            else "Happy to shepherd the next request."
        )
        label = top_title or "Sprouting"
        aria_label = "Glass terrarium humming with bright fronds after fresh votes."
        headline = "Thriving terrarium"
    elif state_key == "growing":
        note = (
            f"Recent votes ({last_vote_label}) are keeping the plant lively. "
            f"{base_note}"
        )
        sun = (
            f"{metrics.board_health['percentage']}% board health; "
            "steady glow from regular ship cycles."
        )
        water = f"Misted {vote_activity}; next mist when votes land again."
        mood = (
            f"Leaning toward {top_title!r} and its {metrics.top_feature_votes} votes."
            if top_title
            else "Calmly awaiting a standout idea."
        )
        label = top_title or "Stable growth"
        aria_label = "Terrarium holding a steady glow with gently swaying fronds."
        headline = "Growing steadily"
    elif state_key == "parched":
        note = (
            f"No fresh mist in {last_vote_label if metrics.last_vote_at else 'a while'}. "
            "Fronds are curling until the next vote lands. "
            f"{base_note}"
        )
        sun = (
            f"{metrics.board_health['percentage']}% health; "
            "light is hazy without recent votes."
        )
        water = "Needs a vote to rehydrate; dry air from missed resets."
        mood = (
            f"Wary but still eyeing {top_title!r} ({metrics.top_feature_votes} votes)."
            if top_title
            else "Eager for someone to submit a new request."
        )
        label = top_title or "Thirsty glass"
        aria_label = "Terrarium looks thirsty with dimmed glow and slower sway."
        headline = "Parched terrarium"
    else:
        note = (
            "The board has been silent—no votes to mist the glass yet. "
            f"{base_note}"
        )
        sun = (
            f"{metrics.board_health['percentage']}% health; "
            "the canopy is resting while the board idles."
        )
        water = "No votes yet; bone dry. A single vote would wake the fronds."
        mood = (
            f"Dormant until a new request arrives; {metrics.pending_count} seeds waiting."
        )
        label = "Dormant"
        aria_label = "Dormant terrarium resting in cool tones."
        headline = "Dormant terrarium"

    return {
        "key": state_key,
        "headline": headline,
        "note": note,
        "sun": sun,
        "water": water,
        "mood": mood,
        "label": label,
        "aria_label": aria_label,
    }


def _collect_metrics(reference: datetime) -> TerrariumMetrics:
    """Gather board data needed to shape the terrarium."""

    board_health = get_board_health()
    pending_qs = Feature.objects.pending().with_vote_totals()
    top_feature = pending_qs.order_by("-total_votes", "-created_at").first()
    pending_count = pending_qs.count()
    top_feature_votes = top_feature.vote_total if top_feature else 0

    last_vote_at = (
        Vote.objects.order_by("-created_at")
        .values_list("created_at", flat=True)
        .first()
    )

    start_of_day = reference.astimezone(dt_timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    end_of_day = start_of_day + timedelta(days=1)
    votes_today = Vote.objects.filter(
        created_at__gte=start_of_day,
        created_at__lt=end_of_day,
    ).count()

    return TerrariumMetrics(
        board_health=board_health,
        top_feature=top_feature,
        pending_count=pending_count,
        top_feature_votes=top_feature_votes,
        last_vote_at=last_vote_at,
        votes_today=votes_today,
    )


def _determine_state(
    *,
    board_health: BoardHealthPayload,
    hours_since_vote: float | None,
    pending_count: int,
    votes_today: int,
) -> str:
    """Map current board conditions to a visual state."""

    health = board_health["percentage"]
    if pending_count == 0 and hours_since_vote is None:
        return "dormant"
    if hours_since_vote is None:
        return "parched"
    if hours_since_vote > 72 or health < 20:
        return "dormant"
    if hours_since_vote > 24 or health < 50:
        return "parched"
    if health >= 80 and (hours_since_vote <= 6 or votes_today >= 3):
        return "thriving"
    return "growing"


def _format_last_vote_label(
    last_vote_at: datetime | None, reference: datetime
) -> str:
    """Return a short label for when the last vote landed."""

    if not last_vote_at:
        return "no votes yet"

    delta = reference - last_vote_at
    if delta < timedelta(minutes=1):
        return "just now"
    if delta < timedelta(hours=1):
        minutes = int(delta.total_seconds() // 60)
        return f"{minutes}m ago"
    if delta < timedelta(days=2):
        hours = int(delta.total_seconds() // 3600)
        return f"{hours}h ago"
    days = delta.days
    return f"{days}d ago"
