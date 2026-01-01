"""Avatar generation utilities for Board members."""

from __future__ import annotations

import colorsys
import hashlib
import math
import logging
from dataclasses import dataclass
from io import BytesIO
from random import Random
from typing import Iterable

from django.core.files.base import ContentFile
from django.utils import timezone
from PIL import Image, ImageDraw, ImageFilter

from .models import User

AVATAR_SIZE = 256
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ContributionProfile:
    """Snapshot of a member's participation footprint."""

    features_submitted: int
    features_shipped: int
    votes_cast: int

    @property
    def total_energy(self) -> int:
        """Rough measure of how vibrant the avatar should be."""
        return max(
            6,
            self.features_submitted * 2 + self.features_shipped * 3 + self.votes_cast,
        )


def _hsl_to_rgb(h: float, s: float, l: float) -> tuple[int, int, int]:
    """Convert HSL values (0-360, 0-100, 0-100) to an RGB tuple."""
    r, g, b = colorsys.hls_to_rgb(h / 360.0, l / 100.0, s / 100.0)
    return (int(r * 255), int(g * 255), int(b * 255))


def _palette_from_digest(seed: bytes, contribution: ContributionProfile) -> list[tuple[int, int, int]]:
    """Generate a joyful palette influenced by the user's contributions."""
    base_hue = seed[0] % 360
    vibrancy = min(82, 55 + contribution.features_submitted * 3)
    lift = min(78, 48 + contribution.features_shipped * 5)
    accent_hue = (base_hue + 60 + contribution.votes_cast * 2) % 360
    spark_hue = (base_hue + 128) % 360

    return [
        _hsl_to_rgb(base_hue, vibrancy, lift),
        _hsl_to_rgb(accent_hue, 85, min(88, lift + 10)),
        _hsl_to_rgb(spark_hue, 72, 72),
        _hsl_to_rgb((accent_hue + 200) % 360, 68, 64),
    ]


def _contribution_profile(user: User) -> ContributionProfile:
    """Collect contribution metrics used to influence the avatar output."""
    submissions = user.features.count()
    shipped = user.features.filter(implemented_at__isnull=False).count()
    votes = user.votes.count()
    return ContributionProfile(
        features_submitted=submissions,
        features_shipped=shipped,
        votes_cast=votes,
    )


def _draw_arc_bursts(
    draw: ImageDraw.ImageDraw,
    center: tuple[float, float],
    max_radius: float,
    layers: Iterable[int],
    palette: list[tuple[int, int, int]],
    rng: Random,
) -> None:
    """Sweep bright arcs around the avatar to represent feature submissions."""
    cx, cy = center
    layer_values = list(layers)
    for index, layer in enumerate(layer_values, start=1):
        radius = max_radius * (0.22 + (index / (len(layer_values) + 1)))
        thickness = 10 + (layer % 6)
        start_angle = rng.randint(0, 360)
        extent = 140 + (layer * 9)
        bbox = (
            cx - radius,
            cy - radius,
            cx + radius,
            cy + radius,
        )
        color = palette[layer % len(palette)]
        draw.arc(bbox, start=start_angle, end=start_angle + extent, fill=color, width=thickness)


def _draw_stars(
    draw: ImageDraw.ImageDraw,
    center: tuple[float, float],
    count: int,
    radius: float,
    palette: list[tuple[int, int, int]],
    rng: Random,
) -> None:
    """Scatter starbursts that celebrate shipped ideas."""
    cx, cy = center
    for idx in range(count):
        angle = rng.random() * math.tau
        distance = radius * (0.3 + rng.random() * 0.6)
        spikes = 6 + idx % 3
        outer = 20 + rng.randint(0, 12)
        inner = outer / 2.2
        points = []
        for i in range(spikes * 2):
            spin_angle = angle + (math.pi * i / spikes)
            length = outer if i % 2 == 0 else inner
            points.append(
                (
                    cx + math.cos(spin_angle) * distance * (length / outer),
                    cy + math.sin(spin_angle) * distance * (length / outer),
                )
            )
        color = palette[(idx + 1) % len(palette)]
        draw.polygon(points, fill=color)


def _draw_confetti(
    draw: ImageDraw.ImageDraw,
    size: int,
    count: int,
    palette: list[tuple[int, int, int]],
    rng: Random,
) -> None:
    """Add small confetti to reflect ongoing voting activity."""
    for idx in range(count):
        x = rng.randint(6, size - 6)
        y = rng.randint(6, size - 6)
        color = palette[(idx + 2) % len(palette)]
        scatter_size = rng.randint(4, 10)
        draw.ellipse(
            (
                x - scatter_size / 2,
                y - scatter_size / 2,
                x + scatter_size / 2,
                y + scatter_size / 2,
            ),
            fill=color,
        )


def generate_user_avatar(user: User) -> str | None:
    """Create and persist a fresh avatar for the given user.

    The output is a 256x256 WebP that blends abstract arcs (feature ideas),
    starbursts (shipped ideas), and confetti (votes cast).
    """

    profile = _contribution_profile(user)
    signature = f"{user.pk}:{user.username}:{profile.features_submitted}:{profile.features_shipped}:{profile.votes_cast}"
    digest = hashlib.sha256(signature.encode("utf-8")).digest()
    digest_hex = digest.hex()
    rng = Random(digest)
    palette = _palette_from_digest(digest, profile)

    base_color = _hsl_to_rgb(digest[1] % 360, 52, 18 + profile.features_shipped * 4)
    canvas = Image.new("RGBA", (AVATAR_SIZE, AVATAR_SIZE), base_color + (255,))
    draw = ImageDraw.Draw(canvas, "RGBA")

    light = Image.new("RGBA", (AVATAR_SIZE, AVATAR_SIZE))
    light_draw = ImageDraw.Draw(light, "RGBA")
    light_color = palette[1] + (130,)
    light_draw.ellipse(
        (-40, AVATAR_SIZE * 0.2, AVATAR_SIZE * 0.8, AVATAR_SIZE * 1.1), fill=light_color
    )
    canvas = Image.alpha_composite(canvas, light.filter(ImageFilter.GaussianBlur(radius=24)))

    center = (AVATAR_SIZE / 2, AVATAR_SIZE / 2)
    submission_layers = range(max(3, profile.features_submitted + 2))
    _draw_arc_bursts(draw, center, AVATAR_SIZE / 2 - 12, submission_layers, palette, rng)

    shipped_count = max(1, profile.features_shipped) if profile.features_shipped else 0
    if shipped_count:
        _draw_stars(draw, center, shipped_count, AVATAR_SIZE / 2 - 40, palette, rng)

    confetti_count = min(32, profile.total_energy)
    _draw_confetti(draw, AVATAR_SIZE, confetti_count, palette, rng)

    final_image = canvas.convert("RGB")
    buffer = BytesIO()
    final_image.save(buffer, format="WEBP", quality=95, method=6)

    timestamp_ms = int(timezone.now().timestamp() * 1000)
    file_name = f"{user.username or 'member'}-{timestamp_ms}-{digest_hex[:8]}.webp"
    if getattr(user, "avatar", None) and user.avatar:
        user.avatar.delete(save=False)
    user.avatar.save(file_name, ContentFile(buffer.getvalue()), save=True)

    return user.avatar.url


def refresh_user_avatar(user: User) -> None:
    """Best-effort wrapper to generate and persist a member's avatar."""
    if not user:
        return

    try:
        generate_user_avatar(user)
    except Exception:
        logger.exception("Failed to generate avatar for user_id=%s", getattr(user, "pk", None))
