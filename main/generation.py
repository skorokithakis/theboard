"""Configuration and helpers for automatic feature generation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from django.contrib.auth import get_user_model
from django.db import transaction

from .models import Feature


@dataclass(frozen=True)
class GenerationPlan:
    """Describe how the board should seed itself when the queue is empty."""

    title: str
    description: str
    ritual: str


SELF_CARE_PLAN = GenerationPlan(
    title="Self-care check-in for The Board",
    description=(
        "When the queue is empty, The Board adds a joyful feature to its own page so the next "
        "implementation window still ships something delightful."
    ),
    ritual="Brew warm digital coffee, take a breath, and post a cozy improvement.",
)

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
            "status": "Taking a self-care break and seeding the backlog.",
        },
    )
    return author


def ensure_generation_seed() -> Optional[Feature]:
    """Create a system-authored feature when the backlog is empty.

    Returns the created feature or the existing one if it was just seeded.
    If the backlog already has items, no feature is created.
    """
    with transaction.atomic():
        if Feature.objects.pending().exists():
            return None

        existing = Feature.objects.filter(
            title=SELF_CARE_PLAN.title,
            implemented_at__isnull=True,
            expired_at__isnull=True,
        ).first()
        if existing:
            return existing

        author = _get_or_create_system_user()
        return Feature.objects.create(
            title=SELF_CARE_PLAN.title,
            description=(
                f"{SELF_CARE_PLAN.description} "
                f"Ritual: {SELF_CARE_PLAN.ritual}"
            ),
            creator=author,
        )
