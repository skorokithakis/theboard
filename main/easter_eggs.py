"""Definition of neon easter eggs that can award bonus votes."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable


@dataclass(frozen=True, slots=True)
class NeonEgg:
    """Metadata describing a neon egg."""

    key: str
    label: str
    hint: str
    accent: str
    reward: str = "+1 neon vote"


NEON_EGGS: tuple[NeonEgg, ...] = (
    NeonEgg(
        key="signal-glyph",
        label="Signal Glyph",
        hint="A pulsing dot hidden near the site chrome.",
        accent="#6dfae3",
    ),
    NeonEgg(
        key="midnight-spray",
        label="Midnight Spray",
        hint="A paint tag that glows when the footer is near.",
        accent="#ff6bd6",
    ),
    NeonEgg(
        key="glass-echo",
        label="Glass Echo",
        hint="A faint ring that shimmers by the page edges.",
        accent="#7ad1ff",
    ),
)


def valid_keys() -> set[str]:
    """Return the set of valid neon egg keys."""
    return {egg.key for egg in NEON_EGGS}


def serialize(eggs: Iterable[NeonEgg] | None = None) -> list[dict[str, str]]:
    """Return the configured eggs as dictionaries for JSON contexts."""
    payload: list[dict[str, str]] = []
    for egg in eggs or NEON_EGGS:
        payload.append(asdict(egg))
    return payload


def get_egg(key: str) -> NeonEgg | None:
    """Return the egg metadata for a given key."""
    for egg in NEON_EGGS:
        if egg.key == key:
            return egg
    return None
