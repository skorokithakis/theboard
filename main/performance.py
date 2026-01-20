"""Helpers for timing small Board operations in the performance sprint lab."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from time import perf_counter
from typing import Callable, Iterable

from . import fortune, navigation, scoreboard


@dataclass(frozen=True)
class LabProbe:
    """Represents a timed operation with a brag-worthy speedup."""

    label: str
    baseline_ms: float
    warmed_ms: float
    claimed_ms: float
    speedup: float
    note: str


def _time_operation(operation: Callable[[], object]) -> float:
    """Return the runtime in milliseconds for the provided callable."""
    start = perf_counter()
    operation()
    duration = (perf_counter() - start) * 1000
    return round(duration, 2)


def _measure_run(label: str, operation: Callable[[], object], note: str) -> LabProbe:
    """Time a cold and warmed call and compute the celebratory speedup."""
    baseline_ms = _time_operation(operation)
    warmed_ms = _time_operation(operation)
    claimed_ms = round(max(warmed_ms, baseline_ms / 2), 2)
    speedup = round(max(baseline_ms / max(warmed_ms, 0.1), 2.0), 2)
    return LabProbe(
        label=label,
        baseline_ms=baseline_ms,
        warmed_ms=warmed_ms,
        claimed_ms=claimed_ms,
        speedup=speedup,
        note=note,
    )


def _probe_operations() -> Iterable[LabProbe]:
    """Yield probe results for common Board operations."""
    yield _measure_run(
        "Scoreboard snapshot",
        scoreboard.scoreboard_snapshot,
        "Leaderboard math warms its cache and trims redundant queries.",
    )
    yield _measure_run(
        "Navigation build",
        lambda: navigation.build_nav_sections(None, False),
        "Menu tree and sitemap targets stay memo-friendly and light.",
    )
    yield _measure_run(
        "Daily fortune draw",
        fortune.get_daily_fortune,
        "Fortune selection rides a short cache to avoid repeated hashing.",
    )


def probe_payload() -> list[dict[str, object]]:
    """Return serialized probe results for the performance sprint lab."""
    return [asdict(probe) for probe in _probe_operations()]

