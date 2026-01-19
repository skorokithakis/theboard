"""Lore fragments and rituals for the lore drop intermission."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LoreFragment:
    """Short pieces of worldbuilding surfaced on the lore intermission page."""

    title: str
    summary: str
    detail: str


@dataclass(frozen=True)
class TunnelPulse:
    """Status beacons for the board's secret tunnels."""

    name: str
    status: str
    hint: str


@dataclass(frozen=True)
class MythSeed:
    """A prewritten myth that can be dropped without editing."""

    title: str
    text: str


LORE_FRAGMENTS: tuple[LoreFragment, ...] = (
    LoreFragment(
        title="Mascot courier lanterns",
        summary="Shimeji mascots slip through the ventilation to deliver patched lore when the lights dim.",
        detail="They skate along the scoreboard cabling, leaving coin-stamped marks on features that need another round of votes.",
    ),
    LoreFragment(
        title="Vaulted backlog well",
        summary="A spiral well behind the implemented ledger catches every whispered request.",
        detail="Votes are lowered in buckets, powering a lift that hoists the strangest suggestion back to the surface when midnight hits.",
    ),
    LoreFragment(
        title="Tone-tuned tunnels",
        summary="Secret tunnels hum at 60 bpm when the queue is healthy and drop to half-tempo when voting stalls.",
        detail="Glow-worms perched on the rails shove urgent requests upward whenever the cadence goes flat.",
    ),
)

TUNNEL_PULSES: tuple[TunnelPulse, ...] = (
    TunnelPulse(
        name="Northbound service crawl",
        status="Open for listeners",
        hint="Threaded with copper rails the mascots slide down while carrying vote receipts.",
    ),
    TunnelPulse(
        name="Under-score conduit",
        status="Guarded by CAPTCHA glyphs",
        hint="Each glyph tests whether the next whisper belongs to a real voter before the tunnel opens.",
    ),
    TunnelPulse(
        name="Archive drain",
        status="Releasing lore runoff nightly",
        hint="The runoff feeds the moss garden around the retrospective vault.",
    ),
)

MYTH_SEEDS: tuple[MythSeed, ...] = (
    MythSeed(
        title="Coin-eater stair",
        text="A hidden stair behind the shipped ledger asks for a single coin; drop one and a pneumatic tube returns an annotated commit.",
    ),
    MythSeed(
        title="Mascot molts",
        text="The mascots shed pixel husks that calcify into new CAPTCHA puzzles every equinox.",
    ),
    MythSeed(
        title="Tunnel echo",
        text="Whisper an unscheduled deploy down the vent and the echo returns as a shipping timeline in iambic pentameter.",
    ),
    MythSeed(
        title="Neon river paddle",
        text="A neon river runs under the terrarium; when a vote fails the paddle kicks and sprays color through the floor vents.",
    ),
)


def lore_fragments() -> list[LoreFragment]:
    """Return reusable lore fragments for rendering."""
    return list(LORE_FRAGMENTS)


def tunnel_pulses() -> list[TunnelPulse]:
    """Return tunnel status beacons."""
    return list(TUNNEL_PULSES)


def myth_seeds() -> list[MythSeed]:
    """Return strange myths that can be posted without edits."""
    return list(MYTH_SEEDS)
