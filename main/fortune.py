"""Curated fortune cookie quotes for the homepage."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import hashlib
from typing import Sequence

from django.utils import timezone


@dataclass(frozen=True)
class Fortune:
    """Represents a single fortune pulled from a themed package."""

    text: str
    attribution: str
    collection: str
    package: str


FORTUNE_COOKIES: Sequence[Fortune] = (
    Fortune(
        text="Yoda reminds you to commit fully-half-hearted tries never move starfighters.",
        attribution="Jedi Master Yoda",
        collection="Star Wars",
        package="fortune-mod-starwars",
    ),
    Fortune(
        text="Han insists that odds are for droids; courage is for pilots.",
        attribution="Han Solo",
        collection="Star Wars",
        package="fortune-mod-starwars",
    ),
    Fortune(
        text="Leia radios in: hope survives every hyperspace jump if you carry it.",
        attribution="Leia Organa",
        collection="Star Wars",
        package="fortune-mod-starwars",
    ),
    Fortune(
        text="Ahsoka centers her breath and lets clarity guide the lightsabers.",
        attribution="Ahsoka Tano",
        collection="Star Wars",
        package="fortune-mod-starwars",
    ),
    Fortune(
        text="Rey charts today's path by trusting the Force and her friends equally.",
        attribution="Rey Skywalker",
        collection="Star Wars",
        package="fortune-mod-starwars",
    ),
    Fortune(
        text="The Ministry of Silly Walks suggests one bold, ridiculous step toward delight.",
        attribution="Monty Python Ministry Clerk",
        collection="Monty Python",
        package="fortune-mod-montypython",
    ),
    Fortune(
        text="An ex-parrot's echo reminds you to refuse dull explanations for dazzling ideas.",
        attribution="Monty Python's Parrot Shop Proprietor",
        collection="Monty Python",
        package="fortune-mod-montypython",
    ),
    Fortune(
        text="The Knights Who Formerly Said Ni now request bravery pruned of fear.",
        attribution="Knight of Ni",
        collection="Monty Python",
        package="fortune-mod-montypython",
    ),
    Fortune(
        text="A deadpan historian notes that absurd detours can still reach the Grail.",
        attribution="Monty Python Narrator",
        collection="Monty Python",
        package="fortune-mod-montypython",
    ),
    Fortune(
        text="Tim the Enchanter politely recommends planning, then adding one spark of kaboom.",
        attribution="Tim the Enchanter",
        collection="Monty Python",
        package="fortune-mod-montypython",
    ),
    Fortune(
        text="Stan's lesson today: honesty plus friends beats every overblown conspiracy.",
        attribution="Stan Marsh",
        collection="South Park",
        package="fortune-mod-southpark",
    ),
    Fortune(
        text="Kyle adjusts his ushanka and says better questions calm any town panic.",
        attribution="Kyle Broflovski",
        collection="South Park",
        package="fortune-mod-southpark",
    ),
    Fortune(
        text="Kenny gives a muffled thumbs up-resilience is the best winter coat.",
        attribution="Kenny McCormick",
        collection="South Park",
        package="fortune-mod-southpark",
    ),
    Fortune(
        text="Cartman accidentally proves that persistence makes even wild schemes real.",
        attribution="Eric Cartman",
        collection="South Park",
        package="fortune-mod-southpark",
    ),
    Fortune(
        text="Chef hums about feeding people kindness before you give them lectures.",
        attribution="Chef",
        collection="South Park",
        package="fortune-mod-southpark",
    ),
    Fortune(
        text="Leela files a mission report: courage plus competence saves the day.",
        attribution="Turanga Leela",
        collection="Futurama",
        package="fortune-mod-futurama",
    ),
    Fortune(
        text="Fry presses a red button labeled Believe Anyway and it somehow works.",
        attribution="Philip J. Fry",
        collection="Futurama",
        package="fortune-mod-futurama",
    ),
    Fortune(
        text="Bender bets on himself; swagger mixed with skill is contagious.",
        attribution="Bender Bending Rodriguez",
        collection="Futurama",
        package="fortune-mod-futurama",
    ),
    Fortune(
        text="Professor Farnsworth's latest invention is a note: Good news-you still have time.",
        attribution="Professor Hubert J. Farnsworth",
        collection="Futurama",
        package="fortune-mod-futurama",
    ),
    Fortune(
        text="Hermes signs form 42B reminding you to balance ambition and rest.",
        attribution="Hermes Conrad",
        collection="Futurama",
        package="fortune-mod-futurama",
    ),
    Fortune(
        text="Granny Weatherwax folds her arms until reality behaves; remember your inner steel.",
        attribution="Esmerelda Weatherwax",
        collection="Discworld",
        package="fortune-mod-discworld",
    ),
    Fortune(
        text="Sam Vimes lights a cigar and promises that small honest steps build cities.",
        attribution="Commander Sam Vimes",
        collection="Discworld",
        package="fortune-mod-discworld",
    ),
    Fortune(
        text="Tiffany Aching chalks a circle and says defend your boundaries with kindness.",
        attribution="Tiffany Aching",
        collection="Discworld",
        package="fortune-mod-discworld",
    ),
    Fortune(
        text="Death speaks in capital letters: THIS DAY IS YOURS; DO SOMETHING INTERESTING.",
        attribution="Death",
        collection="Discworld",
        package="fortune-mod-discworld",
    ),
    Fortune(
        text="Lord Vetinari reorganizes chaos and quietly calls it civic duty-you can, too.",
        attribution="Lord Havelock Vetinari",
        collection="Discworld",
        package="fortune-mod-discworld",
    ),
)


def _community_fortune_pool() -> list[Fortune]:
    """Return approved community submissions as ``Fortune`` objects."""
    from .models import QuoteSuggestion

    suggestions = QuoteSuggestion.objects.filter(is_approved=True).order_by("pk")
    fortunes: list[Fortune] = []
    for suggestion in suggestions:
        fortunes.append(
            Fortune(
                text=suggestion.text,
                attribution=suggestion.attribution,
                collection="Community Submissions",
                package=f"user-submitted-{suggestion.pk}",
            )
        )
    return fortunes


def get_daily_fortune(for_date: date | None = None) -> Fortune:
    """Return a deterministic fortune for the provided date."""

    available_fortunes = [*_community_fortune_pool(), *FORTUNE_COOKIES]

    if not available_fortunes:
        raise RuntimeError("Fortune data is missing.")

    target_date = for_date or timezone.now().date()
    digest = hashlib.sha256(target_date.isoformat().encode("utf-8")).digest()
    index = int.from_bytes(digest[:4], "big") % len(available_fortunes)
    return available_fortunes[index]


__all__ = ["Fortune", "FORTUNE_COOKIES", "get_daily_fortune"]
