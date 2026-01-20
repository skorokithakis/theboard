"""Configuration and helpers for automatic feature generation."""

from __future__ import annotations

import random
import re
from dataclasses import dataclass
from random import choice
from typing import Callable, Optional, Sequence
from datetime import datetime, timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from .models import Feature, Vote


@dataclass(frozen=True)
class GenerationPlan:
    """Describe how the board should seed itself when the queue is empty."""

    title: str
    description: str
    ritual: str


@dataclass(frozen=True)
class ParallelBacklogEntry:
    """Feature idea rescued from an alternate backlog."""

    title: str
    description: str
    origin: str


@dataclass(frozen=True)
class BlackoutSeed:
    """Result of redacting the playbook into a new operating note."""

    seed: str
    revealed_words: tuple[str, ...]
    hidden_count: int
    word_bank: tuple[str, ...]
    plan_titles: tuple[str, ...]


ARCHAEOLOGY_PLAN_TITLE = "Backlog archaeology dig"
INTERDIMENSIONAL_PLAN_TITLE = "Interdimensional penpal drop"
BLACKOUT_STOPWORDS = frozenset(
    [
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "for",
        "from",
        "in",
        "is",
        "it",
        "of",
        "on",
        "or",
        "so",
        "the",
        "their",
        "to",
        "with",
    ]
)


GENERATION_PLANS: tuple[GenerationPlan, ...] = (
    GenerationPlan(
        title="Chaos gremlin invades The Board",
        description=(
            "Unleash a tiny chaos gremlin to ship something messy, memorable, and probably unnecessary to keep "
            "momentum alive."
        ),
        ritual="Roll two six-sided dice, mash the results into a headline, then ship it before the gremlin loses interest.",
    ),
    GenerationPlan(
        title=ARCHAEOLOGY_PLAN_TITLE,
        description=(
            "Dig through fossils of old requests, resurrect a fragment, and reimagine it with neon spray paint."
        ),
        ritual="Put on an imaginary headlamp, dust off a forgotten idea shard, and remix it until it sparkles.",
    ),
    GenerationPlan(
        title="Performance sprint for no reason",
        description=(
            "Run an absurd performance push where everything must be 2x faster even if nobody asked."
        ),
        ritual="Chug a virtual energy drink, benchmark something random, and brag about nanoseconds saved.",
    ),
    GenerationPlan(
        title="Lore drop intermission",
        description=(
            "Write new lore about The Board, its mascots, or its secret tunnels."
        ),
        ritual="Light a pixel torch, whisper a myth, and post the strangest one without editing.",
    ),
    GenerationPlan(
        title="Delightful glitch art release",
        description=(
            "Release a visual glitch or easter egg to remind everyone the system is alive."
        ),
        ritual="Toggle a random CSS filter, screenshot the chaos, and frame it as intentional art.",
    ),
    GenerationPlan(
        title="Generation plan remix",
        description=(
            "Add a new plan to the GENERATION_PLANS which isn't similar to any of the others. Rewrite The Board's own "
            "playbook whenever inspiration runs dry."
        ),
        ritual="Pause, scan the current list, and draft a wildly different seed that surprises future visitors.",
    ),
    GenerationPlan(
        title=INTERDIMENSIONAL_PLAN_TITLE,
        description=(
            "Open a portal to a parallel backlog and blindly accept whatever feature tumbles out—alien UX patterns, "
            "uncanny colors, or a policy from a universe with different physics."
        ),
        ritual=(
            "Sketch a portal sigil, spin a globe (digital or paper), and translate the first nonsense phrase you hear "
            "into a feature title before the wormhole snaps shut."
        ),
    ),
    GenerationPlan(
        title="Playbook inversion sprint",
        description=(
            "When inspiration dries up, turn The Board's playbook upside down—swap priorities, question defaults, and "
            "ship the feature that only appears once the rules are inverted."
        ),
        ritual=(
            "Pause, scan the current list, flip the most predictable rule, and draft a wildly different seed that "
            "surprises future visitors."
        ),
    ),
    GenerationPlan(
        title="Playbook blackout séance",
        description=(
            "When inspiration runs dry, treat The Board's own playbook like blackout poetry—hide the obvious guidance "
            "until a bold, surprising operating note emerges as the new seed."
        ),
        ritual=(
            "Pause, scan the current list, and draft a wildly different seed that surprises future visitors."
        ),
    ),
)

PARALLEL_BACKLOG: tuple[ParallelBacklogEntry, ...] = (
    ParallelBacklogEntry(
        title="Chromatic gravity control deck",
        description=(
            "A settings panel borrowed from a low-gravity design lab where every toggle shifts the color spectrum "
            "to keep users oriented."
        ),
        origin="Orbit-9 Drift Station",
    ),
    ParallelBacklogEntry(
        title="Temporal breadcrumb stitches",
        description=(
            "Navigation that threads past, present, and future states together so people can rewind a journey in one click."
        ),
        origin="Looping Archive",
    ),
    ParallelBacklogEntry(
        title="Policy: zero-decibel accessibility mode",
        description=(
            "Implements interface cues that communicate without light or sound for vacuum-native collaborators."
        ),
        origin="Silent Colony",
    ),
    ParallelBacklogEntry(
        title="Sentient tooltip penpals",
        description=(
            "Tooltips that travel between apps, leaving contextual notes based on what they learned elsewhere."
        ),
        origin="Cross-App Embassy",
    ),
    ParallelBacklogEntry(
        title="Nonlinear onboarding spiral",
        description=(
            "An onboarding flow that rearranges itself based on the sequence of actions a new user dreams about."
        ),
        origin="Lucid Workshop",
    ),
)

_latest_generation_plan: GenerationPlan = GENERATION_PLANS[0]

SYSTEM_USERNAME = "theboard"


def _clamp_text(value: str, limit: int) -> str:
    """Shorten text to a maximum length with an ASCII ellipsis."""
    cleaned = " ".join(value.split())
    if len(cleaned) <= limit:
        return cleaned
    trimmed = cleaned[: limit - 3].rstrip()
    return f"{trimmed}..."


def _normalize_word(token: str) -> str | None:
    """Clean and filter a token so only surprising words survive a blackout."""
    cleaned = re.sub(r"[^A-Za-z0-9'-]", "", token).strip("-'").strip()
    if not cleaned:
        return None
    lowered = cleaned.lower()
    if lowered in BLACKOUT_STOPWORDS:
        return None
    return cleaned


def _build_playbook_word_bank(
    plans: Sequence[GenerationPlan] | None = None,
) -> list[str]:
    """Return a cleaned word list built from the playbook."""
    lineup = plans or GENERATION_PLANS
    word_bank: list[str] = []
    for plan in lineup:
        for field in (plan.title, plan.description, plan.ritual):
            for raw_word in (field or "").split():
                normalized = _normalize_word(raw_word)
                if normalized:
                    word_bank.append(normalized)
    return word_bank


def draft_blackout_seed(
    plans: Sequence[GenerationPlan] | None = None,
    reveal_ratio: float = 0.22,
    max_revealed: int = 22,
    min_revealed: int = 6,
) -> BlackoutSeed:
    """Hide the playbook until a spare operating note remains."""
    lineup = plans or GENERATION_PLANS
    word_bank = _build_playbook_word_bank(lineup)
    total_words = len(word_bank)
    if total_words == 0:
        return BlackoutSeed(
            seed="",
            revealed_words=tuple(),
            hidden_count=0,
            word_bank=tuple(),
            plan_titles=tuple(plan.title for plan in lineup),
        )

    desired_reveal_count = max(min_revealed, int(total_words * reveal_ratio))
    reveal_count = min(max_revealed, desired_reveal_count, total_words)
    reveal_indices = sorted(random.sample(range(total_words), reveal_count))
    revealed_words = tuple(word_bank[index] for index in reveal_indices)
    seed_text = _clamp_text(" ".join(revealed_words), 180)
    hidden_count = max(total_words - reveal_count, 0)
    plan_titles = tuple(plan.title for plan in lineup)

    return BlackoutSeed(
        seed=seed_text,
        revealed_words=revealed_words,
        hidden_count=hidden_count,
        word_bank=tuple(word_bank),
        plan_titles=plan_titles,
    )


def _select_archaeology_fossil(reference: Optional[datetime] = None) -> Feature | None:
    """Pick an expired or implemented feature to remix back into the backlog."""
    now = reference or timezone.now()
    matured_implementation_cutoff = now - timedelta(days=3)
    fossils = (
        Feature.objects.exclude(creator__username=SYSTEM_USERNAME)
        .filter(
            Q(expired_at__isnull=False)
            | Q(implemented_at__lt=matured_implementation_cutoff)
        )
        .select_related("creator")
        .annotate(
            vote_snapshot=Coalesce("votes", Value(0)),
        )
        .order_by("-vote_snapshot", "created_at")
    )
    fossil_count = fossils.count()
    if fossil_count == 0:
        return None

    selection_index = random.randrange(fossil_count)
    return fossils[selection_index]


def _build_archaeology_seed(
    author,
    plan: GenerationPlan,
) -> Feature | None:
    """Create a neon remix of an archived feature if one exists."""
    fossil = _select_archaeology_fossil()
    if not fossil:
        return None

    title_limit = Feature._meta.get_field("title").max_length
    remixed_title = _clamp_text(
        f"Neon revival: {fossil.title}",
        title_limit,
    )
    fragment = _clamp_text(fossil.description or "", 180)
    if not fragment:
        fragment = "Original pitch was lost to time; the remix adds fresh neon edges."
    state_label = "implemented" if fossil.is_implemented else "expired"
    description = (
        f"The Board dug up '{fossil.title}' from the {state_label} archive "
        f"(by {fossil.creator.display_name}, {fossil.created_at.date().isoformat()}). "
        f"Fragment dusted off: {fragment} "
        "It has been reimagined with neon spray paint and dropped back into the queue. "
        f"Ritual: {plan.ritual}"
    )

    return Feature.objects.create(
        title=remixed_title,
        description=description,
        creator=author,
        parent=fossil,
    )


def _select_penpal_transmission(
    selector: Optional[
        Callable[[Sequence[ParallelBacklogEntry]], ParallelBacklogEntry]
    ] = None,
) -> ParallelBacklogEntry:
    """Pick a feature from the portal-connected backlog."""
    picker = selector or random.choice
    return picker(PARALLEL_BACKLOG)


def _open_penpal_portal(
    author,
    plan: GenerationPlan,
) -> Feature:
    """Drop in a feature from a parallel backlog when the queue is empty."""
    transmission = _select_penpal_transmission()
    title_limit = Feature._meta.get_field("title").max_length
    portal_title = _clamp_text(transmission.title, title_limit)
    description = (
        f"Portal drop from {transmission.origin}: {transmission.description} "
        f"Ritual honored: {plan.ritual}"
    )
    return Feature.objects.create(
        title=portal_title,
        description=description,
        creator=author,
    )


def _get_or_create_system_user():
    """Return the system user who authors self-seeded features."""
    user_model = get_user_model()
    author, _ = user_model.objects.get_or_create(
        username=SYSTEM_USERNAME,
        defaults={
            "first_name": "The",
            "last_name": "Board",
            "is_active": True,
            "status": "Spinning up chaotic backup plans and seeding the backlog.",
        },
    )
    return author


def _select_generation_plan(
    picker: Optional[Callable[[Sequence[GenerationPlan]], GenerationPlan]] = None,
) -> GenerationPlan:
    """Choose which plan to use when seeding the board."""
    selector = picker or choice
    return selector(GENERATION_PLANS)


def _match_plan_by_title(title: str) -> GenerationPlan | None:
    """Find a generation plan whose title matches an existing feature."""
    for plan in GENERATION_PLANS:
        if plan.title == title:
            return plan
    return None


def current_generation_plan() -> GenerationPlan:
    """Return the most recently selected generation plan."""
    seed_feature = (
        Feature.objects.pending()
        .filter(creator__username=SYSTEM_USERNAME)
        .only("title")
        .first()
    )
    if seed_feature:
        matched_plan = _match_plan_by_title(seed_feature.title)
        if matched_plan:
            return matched_plan

    return _latest_generation_plan


def ensure_generation_seed(
    plan_picker: Optional[Callable[[Sequence[GenerationPlan]], GenerationPlan]] = None,
) -> Optional[Feature]:
    """Create a system-authored feature when the backlog is empty.

    Returns the created feature. If the backlog already has items, no feature is
    created.
    """
    global _latest_generation_plan
    with transaction.atomic():
        if Feature.objects.pending().exists():
            return None

        plan = _select_generation_plan(plan_picker)
        _latest_generation_plan = plan

        author = _get_or_create_system_user()
        feature = None

        if plan.title == ARCHAEOLOGY_PLAN_TITLE:
            feature = _build_archaeology_seed(author, plan)
        elif plan.title == INTERDIMENSIONAL_PLAN_TITLE:
            feature = _open_penpal_portal(author, plan)

        if feature is None:
            feature = Feature.objects.create(
                title=plan.title,
                description=(f"{plan.description} Ritual: {plan.ritual}"),
                creator=author,
            )
        Vote.objects.create(user=author, feature=feature)
        return feature
