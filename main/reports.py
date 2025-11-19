"""Static implementation report content for the blog."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone as dt_timezone
import re
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
    ImplementationReport(
        slug="unique-implementation-writeups",
        title="Every launch gets its own write-up",
        feature_title="I'm sure the intention was to create a different blog post for each feature implemented",
        summary=(
            "Replaced the copy/paste generator with a workflow that requires engineers to author "
            "feature-specific launch notes. The Feature model now carries structured recap fields, "
            "the admin exposes them, and the blog only renders entries once that text exists."
        ),
        published_at=datetime(2025, 11, 19, 0, 0, tzinfo=dt_timezone.utc),
        sections=(
            ReportSection(
                title="Why the generator had to go",
                paragraphs=(
                    "Automatic recaps sounded clever until we shipped a few — every new entry recycled the same prose "
                    "with a handful of interpolated nouns. Players correctly called out that the blog was useless for "
                    "understanding what actually shipped. We decided to stop showing placeholders altogether and focus "
                    "on tooling that makes proper write-ups fast to produce.",
                ),
            ),
            ReportSection(
                title="Documented in the Feature model",
                paragraphs=(
                    "Each Feature now owns a summary, Markdown body, and highlight bullets dedicated to its implementation "
                    "report. The admin groups those fields under a new “Implementation report” section so the engineer "
                    "who ships the work can capture the narrative before flipping the switch. The management command refuses "
                    "to mark a feature implemented until the write-up is filled in, which keeps the archive honest.",
                ),
            ),
            ReportSection(
                title="Rendering richer posts",
                paragraphs=(
                    "The reports module parses the Markdown headings into the same ReportSection dataclasses used everywhere "
                    "else. That parsing logic fans out paragraphs, trims bullet markers for highlights, and falls back to factual "
                    "metadata if the summary is missing. Implemented features without a write-up are now skipped entirely so the "
                    "blog only shows entries that actually describe engineering work.",
                ),
            ),
        ),
        highlights=(
            "Manual write-ups are required before running the post_implementation command.",
            "Markdown headings become proper sections in the Implementation Report Blog.",
            "Features without a documented recap no longer appear in the blog listing.",
        ),
    ),
)

AUTO_REPORT_LIMIT = 10
AUTO_REPORT_SLUG_PREFIX = "auto-feature-report"
MANUAL_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s*(.+?)\s*$")


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
    reports: list[ImplementationReport] = []
    for feature in features:
        entry = _build_automatic_report(feature)
        if entry is not None:
            reports.append(entry)
    return tuple(reports)


def _build_automatic_report(feature: Feature) -> ImplementationReport | None:
    """Create an implementation report entry using the documented write-up."""
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
    default_summary = _build_default_summary(
        feature.title,
        state_label,
        implemented_at,
        votes_label,
    )
    manual_content = _build_manual_report_content(
        feature=feature,
        default_summary=default_summary,
    )
    if manual_content is None:
        return None
    summary, sections, highlights = manual_content
    if not highlights:
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


def _build_manual_report_content(
    *,
    feature: Feature,
    default_summary: str,
) -> tuple[str, tuple[ReportSection, ...], tuple[str, ...]] | None:
    """Parse the feature's manual write-up into the dataclass payload."""
    sections = _parse_manual_sections(feature.implementation_report_body or "")
    if not sections:
        return None
    summary = (feature.implementation_report_summary or "").strip() or default_summary
    highlights = _parse_manual_highlights(
        feature.implementation_report_highlights or ""
    )
    return summary, sections, highlights


def _parse_manual_sections(raw: str) -> tuple[ReportSection, ...]:
    """Convert Markdown-style headings and paragraphs into ReportSection tuples."""
    text = raw.strip()
    if not text:
        return tuple()
    sections: list[ReportSection] = []
    current_title: str | None = None
    current_lines: list[str] = []

    def flush() -> None:
        if not current_lines:
            return
        paragraphs = _build_paragraphs(current_lines)
        current_lines.clear()
        if not paragraphs:
            return
        sections.append(
            ReportSection(
                title=current_title,
                paragraphs=tuple(paragraphs),
            )
        )

    for raw_line in raw.splitlines():
        match = MANUAL_HEADING_RE.match(raw_line)
        if match:
            flush()
            current_title = match.group(1).strip()
            continue
        current_lines.append(raw_line)
    flush()
    return tuple(sections)


def _build_paragraphs(lines: list[str]) -> list[str]:
    """Collapse text lines into logical paragraphs separated by blank rows."""
    if not lines:
        return []
    paragraphs: list[str] = []
    chunk: list[str] = []
    for line in lines:
        if not line.strip():
            if chunk:
                paragraphs.append(_normalize_paragraph(chunk))
                chunk = []
            continue
        chunk.append(line.strip())
    if chunk:
        paragraphs.append(_normalize_paragraph(chunk))
    return paragraphs


def _normalize_paragraph(lines: list[str]) -> str:
    return " ".join(line.strip() for line in lines if line.strip())


def _parse_manual_highlights(raw: str) -> tuple[str, ...]:
    """Convert newline-separated bullet points into highlight entries."""
    if not raw.strip():
        return tuple()
    highlights: list[str] = []
    for line in raw.splitlines():
        cleaned = line.strip()
        if not cleaned:
            continue
        if cleaned[0] in {"-", "*"}:
            cleaned = cleaned[1:].strip()
        if cleaned:
            highlights.append(cleaned)
    return tuple(highlights)


def _build_default_summary(
    title: str,
    state_label: str,
    implemented_at: datetime,
    votes_label: str,
) -> str:
    """Fallback summary that still references factual data for the feature."""
    return (
        f"Deep dive for \u201c{title}\u201d. The feature was {state_label.lower()} "
        f"on {_format_timestamp(implemented_at)} after collecting {votes_label}. "
        "Document how it shipped and what changed so the archive stays useful."
    )
