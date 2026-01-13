"""Curated fortune cookie quotes for the homepage."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
import hashlib
import random
from typing import Sequence

from django.core.cache import cache
from django.utils import timezone


@dataclass(frozen=True)
class Fortune:
    """Represents a single fortune pulled from a themed package."""

    text: str
    attribution: str
    collection: str
    package: str
    submitted_by: str | None = None


COMMUNITY_FORTUNE_WEIGHT = 3
RECENT_FORTUNE_WINDOW = 3
FORTUNE_CACHE_TIMEOUT_SECONDS = 6 * 60 * 60


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
                submitted_by=suggestion.submitted_by.display_name,
            )
        )
    return fortunes


def _fortune_candidates() -> list[Fortune]:
    """Return weighted fortune candidates with community submissions boosted."""
    community_fortunes = _community_fortune_pool()
    weighted_pool: list[Fortune] = []
    for fortune in community_fortunes:
        weighted_pool.extend([fortune] * COMMUNITY_FORTUNE_WEIGHT)
    weighted_pool.extend(FORTUNE_COOKIES)
    return weighted_pool


def _fortune_seed(target_date: date) -> int:
    """Create a deterministic random seed from the provided date."""
    digest = hashlib.sha256(target_date.isoformat().encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


def _fortune_signature(fortune: Fortune) -> tuple[str, str, str]:
    """Stable identifier for a fortune to compare against recent draws."""
    return (fortune.collection, fortune.package, fortune.text)


def _candidate_signature(candidates: Sequence[Fortune]) -> str:
    """Return a stable digest for the candidate pool to version cache entries."""
    digest = hashlib.sha256()
    for fortune in candidates:
        digest.update(fortune.collection.encode("utf-8"))
        digest.update(b"\0")
        digest.update(fortune.package.encode("utf-8"))
        digest.update(b"\0")
        digest.update(fortune.text.encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()


def _recent_hits_from_history(
    current_date: date, history: dict[date, Fortune]
) -> dict[tuple[str, str, str], int]:
    """Count recent fortune occurrences based on the computed history."""
    hits: dict[tuple[str, str, str], int] = {}
    for offset in range(1, RECENT_FORTUNE_WINDOW + 1):
        prior_date = current_date - timedelta(days=offset)
        if prior_date in history:
            signature = _fortune_signature(history[prior_date])
            hits[signature] = hits.get(signature, 0) + 1
    return hits


def _select_weighted_fortune(
    *,
    seed: int,
    candidates: Sequence[Fortune],
    recent_hits: dict[tuple[str, str, str], int],
    last_signature: tuple[str, str, str] | None,
) -> Fortune:
    """Pick a weighted fortune while preferring less-recent entries."""
    if not candidates:
        raise RuntimeError("Fortune data is missing.")

    rng = random.Random(seed)
    shuffled_candidates = list(candidates)
    rng.shuffle(shuffled_candidates)

    unique_signatures = {_fortune_signature(candidate) for candidate in candidates}
    preferred_candidates = shuffled_candidates
    if (
        last_signature
        and len(unique_signatures) > 1
        and any(_fortune_signature(c) != last_signature for c in shuffled_candidates)
    ):
        filtered = [
            candidate
            for candidate in shuffled_candidates
            if _fortune_signature(candidate) != last_signature
        ]
        if filtered:
            preferred_candidates = filtered

    best_candidate = preferred_candidates[0]
    best_rank = (
        recent_hits.get(_fortune_signature(best_candidate), 0),
        rng.random(),
    )

    for candidate in preferred_candidates[1:]:
        signature = _fortune_signature(candidate)
        rank = (recent_hits.get(signature, 0), rng.random())
        if rank < best_rank:
            best_rank = rank
            best_candidate = candidate

    return best_candidate


def get_daily_fortune(for_date: date | None = None) -> Fortune:
    """Return a deterministic fortune for the provided date."""

    target_date = for_date or timezone.now().date()
    candidates = _fortune_candidates()
    if not candidates:
        raise RuntimeError("Fortune data is missing.")

    candidate_signature = _candidate_signature(candidates)
    cache_key = f"daily-fortune:{target_date.isoformat()}:{candidate_signature}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    history: dict[date, Fortune] = {}
    anchor_date = date(target_date.year, 1, 1)
    if anchor_date > target_date:
        anchor_date = target_date - timedelta(days=RECENT_FORTUNE_WINDOW)

    current_date = anchor_date

    while current_date <= target_date:
        recent_hits = _recent_hits_from_history(current_date, history)
        yesterday = current_date - timedelta(days=1)
        last_signature = (
            _fortune_signature(history[yesterday]) if yesterday in history else None
        )
        fortune_choice = _select_weighted_fortune(
            seed=_fortune_seed(current_date),
            candidates=candidates,
            recent_hits=recent_hits,
            last_signature=last_signature,
        )
        history[current_date] = fortune_choice
        current_date += timedelta(days=1)

    result = history[target_date]
    cache.set(cache_key, result, FORTUNE_CACHE_TIMEOUT_SECONDS)
    return result


__all__ = ["Fortune", "FORTUNE_COOKIES", "get_daily_fortune"]
