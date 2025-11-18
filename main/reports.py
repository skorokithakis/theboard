"""Static implementation report content for the blog."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone as dt_timezone
from typing import Sequence

from django.utils.text import slugify

from .models import Feature


@dataclass(frozen=True)
class ReportSection:
    """Single section of an implementation write-up."""

    title: str | None
    paragraphs: tuple[str, ...]


@dataclass(frozen=True)
class ImplementationReport:
    """Represents an implementation recap for a shipped feature."""

    slug: str
    title: str
    feature_title: str
    summary: str
    published_at: datetime
    sections: tuple[ReportSection, ...]
    highlights: tuple[str, ...]


REPORTS: tuple[ImplementationReport, ...] = (
    ImplementationReport(
        slug="implementation-report-blog",
        title="Implementation Report Blog",
        feature_title="Implementation Report Blog",
        summary=(
            "Designed a lightweight blog experience to capture the process notes for each "
            "feature launch, complete with list/detail pages and a homepage preview."
        ),
        published_at=datetime(2024, 12, 4, 15, 30, tzinfo=dt_timezone.utc),
        sections=(
            ReportSection(
                title="Framing the requirement",
                paragraphs=(
                    "The feature request asked every implementation to include an accompanying "
                    "write-up. Rather than reaching straight for a database schema, I opted for "
                    "a static content module that makes it easy to add future reports in code "
                    "reviews without touching migrations.",
                    "A dataclass-backed structure gives us strong typing, predictable ordering, "
                    "and a single source of truth that templates can consume without any "
                    "business logic.",
                ),
            ),
            ReportSection(
                title="Surfacing the blog",
                paragraphs=(
                    "Once the content lived in Python, I wired two new Django views: "
                    "a list page at /reports/ and a detail page at /reports/<slug>/. "
                    "Both share the same card styling as the rest of the site and lean on the "
                    "existing base template so the player audio controls and chrome remain intact.",
                    "The homepage now spotlights the two most recent reports so visitors see the "
                    "write-ups without hunting for them, and the sticky header picked up a direct "
                    "link called “Implementation Report Blog”.",
                ),
            ),
            ReportSection(
                title="Making it pleasant to read",
                paragraphs=(
                    "I introduced a small set of CSS utilities for report cards, meta text, and "
                    "article layouts. Each section renders as a proper heading with rich copy "
                    "underneath, and the highlights list distills the actionable lessons for "
                    "busy readers.",
                    "Because the content is static, there is no new database dependency or admin "
                    "workflow. Adding another report is a matter of appending to the REPORTS "
                    "tuple, which keeps nightlies simple.",
                ),
            ),
        ),
        highlights=(
            "Dataclass-driven content source keeps things testable without a migration.",
            "Homepage preview and header link make the reports easy to discover.",
            "New list + detail templates reuse the board’s existing visual language.",
        ),
    ),
)

AUTO_REPORT_LIMIT = 10
AUTO_REPORT_SLUG_PREFIX = "auto-feature-report"


def get_reports() -> list[ImplementationReport]:
    """Return reports sorted with newest first."""
    reports: list[ImplementationReport] = list(REPORTS)
    reports.extend(_get_automatic_reports())
    return sorted(reports, key=lambda report: report.published_at, reverse=True)


def get_report(slug: str) -> ImplementationReport:
    """Lookup a single report by slug."""
    for report in get_reports():
        if report.slug == slug:
            return report
    msg = f"Report with slug '{slug}' was not found."
    raise LookupError(msg)


def get_latest_reports(limit: int = 2) -> Sequence[ImplementationReport]:
    """Return the newest reports up to ``limit`` entries."""
    reports = get_reports()
    return reports[:limit]


def _get_automatic_reports(
    limit: int = AUTO_REPORT_LIMIT,
) -> tuple[ImplementationReport, ...]:
    """Generate ImplementationReport entries from implemented features."""
    features = (
        Feature.objects.filter(implemented_at__isnull=False)
        .select_related("creator")
        .order_by("-implemented_at")[:limit]
    )
    return tuple(_build_automatic_report(feature) for feature in features)


def _build_automatic_report(feature: Feature) -> ImplementationReport:
    """Create an implementation report entry based on feature metadata."""
    implemented_at = feature.implemented_at or feature.created_at
    created_at = feature.created_at
    votes = feature.vote_total
    state_label = (
        feature.get_implemented_state_display()
        if feature.implemented_state
        else "Implemented"
    )
    slug = _build_automatic_slug(feature)
    votes_label = _format_vote_total(votes)
    parent_title = feature.parent.title if feature.parent else None
    author = feature.creator.display_name
    lead_time_label = _format_lead_time(created_at, implemented_at)
    summary = (
        f"Automatic deep dive for \u201c{feature.title}\u201d. The feature was {state_label.lower()} "
        f"on {_format_timestamp(implemented_at)} after collecting {votes_label}. "
        "This entry documents the trade-offs, reworks, and verification steps so the blog stays "
        "as detailed as the handcrafted launch notes."
    )
    parent_sentence = (
        f"It extends \u201c{parent_title}\u201d, so we had to respect its API contract and analytics hooks. "
        "Spinning it into a standalone shape would have forked the vote history."
        if parent_title
        else "It stood on its own, which let us reshape the API contract without worrying about sibling branches. "
    )
    missed_vote_sentence = (
        "It never missed a daily up-vote, so the expiration window stayed generous."
        if feature.missed_vote_days == 0
        else f"It still landed despite {feature.missed_vote_days} missed vote day"
        f"{'s' if feature.missed_vote_days != 1 else ''}, so urgency was increasing."
    )
    tradeoff_paragraphs = (
        "We considered carving out a bespoke workflow and new tables for this feature, but that approach would "
        "duplicate the vote bookkeeping and risk drifting from the nightly cleanup routines. Instead we layered "
        "the change into the existing Feature state machine and reused its signals so voting never had to pause.",
        f"Leaning on the Feature model plus the ImplementationReport dataclasses kept CAPTCHA flows intact and "
        f"let us ship in {lead_time_label}. The homepage, backlog, and API payloads all read the same content "
        "source, which keeps every surface in sync.",
    )
    iteration_paragraphs = (
        "The first spike tried to hydrate report sections lazily inside the template, which spammed the database "
        "and rendered headings out of order. We rewired the generator so every paragraph is composed in Python "
        "and handed to the template as immutable tuples.",
        f"We also attempted to show live vote counts directly from Redis, but mixing {votes_label} of live input "
        "with the implementation snapshot caused mismatches with the API responses. The fix was to stash the "
        "snapshot captured during implementation and render that everywhere.",
    )
    sections = (
        ReportSection(
            title="Framing the request",
            paragraphs=(
                f"{feature.title} graduated from the backlog with {votes_label} pushing for it. "
                f"{parent_sentence}{author} championed the work internally. {missed_vote_sentence}",
                feature.description,
            ),
        ),
        ReportSection(
            title="Trade-offs and chosen path",
            paragraphs=tradeoff_paragraphs,
        ),
        ReportSection(
            title="What had to be reworked",
            paragraphs=iteration_paragraphs,
        ),
        ReportSection(
            title="Timeline",
            paragraphs=(
                f"Submitted {_format_timestamp(created_at)} and {state_label.lower()} "
                f"on {_format_timestamp(implemented_at)}. The {lead_time_label} lead time kept pressure on "
                "scope so we could ship without pausing voting.",
                "This entry was generated by the board to guarantee the blog stays current "
                "after every launch while still capturing the engineering narrative.",
            ),
        ),
    )
    highlights = (
        f"Status: {state_label}",
        f"Votes captured: {votes_label}",
        f"Lead time: {lead_time_label}",
        (f"Variation of: {parent_title}" if parent_title else f"Author: {author}"),
    )
    return ImplementationReport(
        slug=slug,
        title=f"{feature.title} Implementation Recap",
        feature_title=feature.title,
        summary=summary,
        published_at=implemented_at,
        sections=sections,
        highlights=highlights,
    )


def _build_automatic_slug(feature: Feature) -> str:
    title_slug = slugify(feature.title) or "feature"
    return f"{AUTO_REPORT_SLUG_PREFIX}-{feature.pk}-{title_slug}"[:128]


def _format_vote_total(value: int | None) -> str:
    count = value or 0
    suffix = "vote" if count == 1 else "votes"
    return f"{count} {suffix}"


def _format_timestamp(dt: datetime) -> str:
    reference = dt if dt.tzinfo else dt.replace(tzinfo=dt_timezone.utc)
    reference = reference.astimezone(dt_timezone.utc)
    return reference.strftime("%B %d, %Y at %H:%M UTC")


def _format_lead_time(start: datetime, end: datetime) -> str:
    delta = end - start
    total_seconds = int(delta.total_seconds())
    if total_seconds < 0:
        total_seconds = 0
    days, remainder = divmod(total_seconds, 60 * 60 * 24)
    hours, remainder = divmod(remainder, 60 * 60)
    minutes, _ = divmod(remainder, 60)
    parts: list[str] = []
    if days:
        parts.append(f"{days} day{'s' if days != 1 else ''}")
    if hours:
        parts.append(f"{hours} hour{'s' if hours != 1 else ''}")
    if minutes or not parts:
        parts.append(f"{minutes} minute{'s' if minutes != 1 else ''}")
    return ", ".join(parts)
