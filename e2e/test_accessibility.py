from __future__ import annotations

import hashlib

import html5lib
import pytest
import tinycss2
from axe_playwright_python.sync_playwright import Axe

from .shared import PUBLIC_PATHS, unique_nav_hrefs

_VALIDATED_STYLES: dict[str, str] = {}


def _capture_stylesheets(response, stylesheets: dict[str, str]) -> None:
    """Store CSS responses so we can run them through the validator."""
    try:
        content_type = response.headers.get("content-type", "")
    except Exception:
        content_type = ""

    if (
        response.request.resource_type != "stylesheet"
        and "text/css" not in content_type
    ):
        return

    try:
        stylesheets[response.url] = response.text()
    except Exception:
        return


def _validate_html(html: str, page_path: str) -> None:
    normalized = html.lower()
    assert "<!doctype html" in normalized, f"Missing doctype on {page_path}"

    parser = html5lib.HTMLParser(strict=True)
    try:
        parser.parse(html)
    except Exception as exc:  # pragma: no cover - exercise defensive branch in CI
        raise AssertionError(f"HTML parsing failed on {page_path}: {exc}") from exc


def _validate_css(stylesheets: dict[str, str]) -> None:
    for source, css_text in stylesheets.items():
        if not css_text.strip():
            continue
        digest = hashlib.sha256(css_text.encode("utf-8")).hexdigest()
        if digest in _VALIDATED_STYLES:
            continue

        parsed = tinycss2.parse_stylesheet(
            css_text,
            skip_comments=True,
            skip_whitespace=True,
        )
        formatted_errors = [
            f"{error.source_line}:{error.source_column} {error.message}"
            for error in parsed
            if getattr(error, "type", None) == "error"
        ]
        assert not formatted_errors, (
            f"CSS validation errors in {source}:\n"
            + "\n".join(sorted(formatted_errors))
        )
        _VALIDATED_STYLES[digest] = source


def _assert_no_axe_violations(page, page_path: str) -> None:
    axe = Axe()
    results = axe.run(page)
    violations = results.response.get("violations", [])
    if not violations:
        return

    summaries = []
    for violation in violations:
        node_targets = [
            ", ".join(node.get("target", [])) for node in violation.get("nodes", [])
        ]
        summaries.append(
            f"{violation.get('id')}: {violation.get('description')} "
            f"({len(violation.get('nodes', []))} nodes) "
            f"{' | '.join(node_targets)}"
        )
    assert False, f"Axe accessibility violations on {page_path}:\n" + "\n".join(
        summaries
    )


def _collect_inline_styles(page) -> dict[str, str]:
    styles = page.eval_on_selector_all(
        "style",
        "elements => elements.map((node, index) => ({ key: `inline-style-${index}`, css: node.textContent || '' }))",
    )
    return {style["key"]: style["css"] for style in styles if style.get("css")}


def _collect_styles_for_page(page) -> dict[str, str]:
    stylesheets: dict[str, str] = {}
    page.on("response", lambda response: _capture_stylesheets(response, stylesheets))
    return stylesheets


@pytest.mark.parametrize("path", PUBLIC_PATHS)
def test_public_pages_meet_accessibility_standards(anonymous_page, path):
    stylesheets = _collect_styles_for_page(anonymous_page)
    response = anonymous_page.goto(path, wait_until="networkidle")
    assert response is not None and response.ok, f"Failed to load {path}"

    inline_styles = _collect_inline_styles(anonymous_page)
    stylesheets.update(inline_styles)

    _validate_html(anonymous_page.content(), path)
    _validate_css(stylesheets)
    _assert_no_axe_violations(anonymous_page, path)


def test_sitemap_semantics_stay_valid(anonymous_page):
    stylesheets = _collect_styles_for_page(anonymous_page)
    response = anonymous_page.goto("/sitemap/", wait_until="networkidle")
    assert response is not None and response.ok

    sitemap_links = unique_nav_hrefs(anonymous_page, "a.map-ledger__link")
    assert sitemap_links, "Expected sitemap to expose navigation targets"

    inline_styles = _collect_inline_styles(anonymous_page)
    stylesheets.update(inline_styles)

    _validate_html(anonymous_page.content(), "/sitemap/")
    _validate_css(stylesheets)
    _assert_no_axe_violations(anonymous_page, "/sitemap/")
