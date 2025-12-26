"""Configuration and helpers for automatic feature generation."""

from __future__ import annotations

from dataclasses import dataclass
from random import choice
from typing import Callable, Optional, Sequence

from django.contrib.auth import get_user_model
from django.db import transaction

from .models import Feature, Vote


@dataclass(frozen=True)
class GenerationPlan:
    """Describe how the board should seed itself when the queue is empty."""

    title: str
    description: str
    ritual: str


GENERATION_PLANS: tuple[GenerationPlan, ...] = (
    GenerationPlan(
        title="Chaos gremlin invades The Board",
        description=(
            "If the backlog goes silent, The Board unleashes a tiny chaos gremlin who ships something messy, "
            "memorable, and probably unnecessary just to keep momentum alive."
        ),
        ritual="Roll two six-sided dice, mash the results into a headline, then ship it before the gremlin loses interest.",
    ),
    GenerationPlan(
        title="Backlog archaeology dig",
        description=(
            "When ideas dry up, The Board digs through fossils of old requests, resurrects a fragment, and reimagines "
            "it with neon spray paint."
        ),
        ritual="Put on an imaginary headlamp, dust off a forgotten idea shard, and remix it until it sparkles.",
    ),
    GenerationPlan(
        title="Performance sprint for no reason",
        description=(
            "Silence in the queue triggers an absurd performance push: everything must be 2x faster even if nobody asked."
        ),
        ritual="Chug a virtual energy drink, benchmark something random, and brag about nanoseconds saved.",
    ),
    GenerationPlan(
        title="Lore drop intermission",
        description=(
            "If no one submits features, The Board writes new lore about itself, its mascots, or its secret tunnels."
        ),
        ritual="Light a pixel torch, whisper a myth, and post the strangest one without editing.",
    ),
    GenerationPlan(
        title="Delightful glitch art release",
        description=(
            "Empty backlog? The Board releases a visual glitch or easter egg to remind everyone the system is alive."
        ),
        ritual="Toggle a random CSS filter, screenshot the chaos, and frame it as intentional art.",
    ),
    GenerationPlan(
        title="Generation plan remix",
        description=(
            "Add a new plan to the GENERATION_PLANS which isn't similar to any of the others. "
            "The Board rewrites its own playbook whenever inspiration runs dry."
        ),
        ritual="Pause, scan the current list, and draft a wildly different seed that surprises future visitors.",
    ),
)

_latest_generation_plan: GenerationPlan = GENERATION_PLANS[0]

SYSTEM_USERNAME = "theboard"


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
        feature = Feature.objects.create(
            title=plan.title,
            description=(f"{plan.description} Ritual: {plan.ritual}"),
            creator=author,
        )
        Vote.objects.create(user=author, feature=feature)
        return feature
