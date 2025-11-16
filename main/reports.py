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
    summary = (
        f"Automatic recap for \u201c{feature.title}\u201d. The feature was {state_label.lower()} "
        f"on {_format_timestamp(implemented_at)} after collecting {_format_vote_total(votes)}."
    )
    sections = (
        ReportSection(
            title="What changed",
            paragraphs=(
                f"{feature.title} exited the backlog with {_format_vote_total(votes)} and a "
                f"{state_label.lower()} launch state.",
                feature.description,
            ),
        ),
        ReportSection(
            title="Timeline",
            paragraphs=(
                f"Submitted {_format_timestamp(created_at)} and {state_label.lower()} "
                f"on {_format_timestamp(implemented_at)}.",
                "This entry was generated by the board to guarantee the blog stays current "
                "after every launch.",
            ),
        ),
    )
    highlights = (
        f"Status: {state_label}",
        f"Votes captured: {_format_vote_total(votes)}",
        f"Author: {feature.creator.display_name}",
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
