"""Helpers for calculating the board's Doom-inspired health meter."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict

from django.utils.functional import cached_property

from .models import Feature

MAX_HEALTH = 100
PENALTY_PER_FAILURE = 10


@dataclass(frozen=True)
class HealthSegment:
    key: str
    range_min: int
    range_max: int
    label: str

    @cached_property
    def range_label(self) -> str:
        if self.range_min == self.range_max:
            return f"{self.range_max}%"
        return f"{self.range_min}% - {self.range_max}%"


class HealthStatePayload(TypedDict):
    key: str
    label: str
    range_min: int
    range_max: int
    range_label: str


class BoardHealthPayload(TypedDict):
    percentage: int
    failed_count: int
    damage_per_failure: int
    max_failures: int
    state: HealthStatePayload
    scale: list[HealthStatePayload]


HEALTH_SEGMENTS: tuple[HealthSegment, ...] = (
    HealthSegment(
        key="healthy",
        range_min=80,
        range_max=100,
        label="Completely healthy",
    ),
    HealthSegment(
        key="scratched",
        range_min=60,
        range_max=79,
        label="Bloody nose, hair slightly mussed",
    ),
    HealthSegment(
        key="bruised",
        range_min=40,
        range_max=59,
        label="Face swollen, grimacing",
    ),
    HealthSegment(
        key="critical",
        range_min=20,
        range_max=39,
        label="Eyes bloodshot, face dirty and bleeding",
    ),
    HealthSegment(
        key="dire",
        range_min=1,
        range_max=19,
        label="Eyes bloodshot, blood flowing from the top of the head",
    ),
    HealthSegment(
        key="dead",
        range_min=0,
        range_max=0,
        label="Dead: eyes closed, no vitals detected",
    ),
)

SCALE_SEGMENTS: tuple[HealthSegment, ...] = tuple(
    sorted(HEALTH_SEGMENTS, key=lambda segment: segment.range_min)
)


def get_board_health() -> BoardHealthPayload:
    """Return the current board health value and descriptive segments."""
    failed_count = Feature.objects.filter(
        implemented_state=Feature.ImplementationState.UNSUCCESSFUL
    ).count()
    max_failures = MAX_HEALTH // PENALTY_PER_FAILURE

    remaining = MAX_HEALTH - (failed_count * PENALTY_PER_FAILURE)
    percentage = max(0, min(MAX_HEALTH, remaining))
    active_segment = _get_segment_for_value(percentage)

    return {
        "percentage": percentage,
        "failed_count": failed_count,
        "damage_per_failure": PENALTY_PER_FAILURE,
        "max_failures": max_failures,
        "state": _segment_payload(active_segment),
        "scale": [_segment_payload(segment) for segment in SCALE_SEGMENTS],
    }


def _get_segment_for_value(value: int) -> HealthSegment:
    for segment in HEALTH_SEGMENTS:
        if segment.range_min <= value <= segment.range_max:
            return segment
    return HEALTH_SEGMENTS[-1]


def _segment_payload(segment: HealthSegment) -> HealthStatePayload:
    return {
        "key": segment.key,
        "label": segment.label,
        "range_min": segment.range_min,
        "range_max": segment.range_max,
        "range_label": segment.range_label,
    }
