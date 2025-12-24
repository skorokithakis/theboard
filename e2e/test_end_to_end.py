from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Iterator, Tuple
from urllib.error import URLError
from urllib.request import Request, urlopen
from uuid import uuid4

import pytest
from playwright.sync_api import Playwright, expect, sync_playwright

BASE_DIR = Path(__file__).resolve().parent.parent
SETTINGS_MODULE = os.environ.setdefault(
    "DJANGO_SETTINGS_MODULE", "theboard.e2e_settings"
)
E2E_DB_PATH = BASE_DIR / "_e2e_db.sqlite3"
SERVER_PORT = int(os.environ.get("E2E_TEST_PORT", "8001"))
SERVER_URL = f"http://localhost:{SERVER_PORT}"

PUBLIC_PATHS: Tuple[str, ...] = (
    "/",
    "/features/",
    "/plaintext-submission/",
    "/graveyard/",
    "/about/",
    "/the-board/",
    "/arcade/",
    "/arcade/terrarium/",
    "/arcade/quotes/",
    "/arcade/buddy/",
    "/arcade/penguins/",
    "/web5/",
    "/scoreboard/",
    "/archive/",
    "/archive/about/",
    "/archive/scoreboard/",
    "/sitemap/",
)


def _wait_for_server(url: str, timeout: float = 30) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            request = Request(url, method="GET")
            with urlopen(request):
                return
        except URLError:
            time.sleep(0.5)
    raise RuntimeError(f"Timed out waiting for server at {url}")


def _cleanup_database() -> None:
    if E2E_DB_PATH.exists():
        E2E_DB_PATH.unlink()


def _run_manage_command(*args: str) -> None:
    env = {**os.environ, "DJANGO_SETTINGS_MODULE": SETTINGS_MODULE}
    subprocess.run(
        [sys.executable, "manage.py", *args, f"--settings={SETTINGS_MODULE}"],
        cwd=BASE_DIR,
        check=True,
        env=env,
    )


def _post_json(api_context, path: str, payload: dict):
    return api_context.post(
        path,
        data=json.dumps(payload),
        headers={"content-type": "application/json"},
    )


def _signup_user(playwright: Playwright) -> tuple[dict, dict[str, str]]:
    api_context = playwright.request.new_context(base_url=SERVER_URL)
    credentials = {
        "username": f"tester_{uuid4().hex[:8]}",
        "password": "Test-pass-123",
        "password_confirm": "Test-pass-123",
    }
    response = _post_json(api_context, "/api/auth/signup", credentials)
    assert response.ok, f"Signup failed: {response.status} {response.text()}"
    storage = api_context.storage_state()
    api_context.dispose()
    return storage, credentials


def _api_with_state(playwright: Playwright, storage_state: dict):
    return playwright.request.new_context(
        base_url=SERVER_URL,
        storage_state=storage_state,
    )


def _unique_nav_hrefs(page, selector: str) -> list[str]:
    hrefs = page.eval_on_selector_all(
        selector,
        "elements => elements.map(el => el.getAttribute('href')).filter(Boolean)",
    )
    return list(dict.fromkeys(hrefs))  # Preserve order while deduplicating.


@pytest.fixture(scope="session", autouse=True)
def prepare_database() -> Iterator[None]:
    _cleanup_database()
    _run_manage_command("migrate", "--noinput")
    yield
    _cleanup_database()


@pytest.fixture(scope="session")
def live_server(prepare_database: None) -> Iterator[str]:
    env = {**os.environ, "DJANGO_SETTINGS_MODULE": SETTINGS_MODULE}
    server = subprocess.Popen(
        [
            sys.executable,
            "manage.py",
            "runserver",
            f"0.0.0.0:{SERVER_PORT}",
            "--noreload",
            "--insecure",
            f"--settings={SETTINGS_MODULE}",
        ],
        cwd=BASE_DIR,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )
    try:
        _wait_for_server(f"{SERVER_URL}/healthz/")
        yield SERVER_URL
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
        _cleanup_database()


@pytest.fixture(scope="session")
def playwright_sync() -> Iterator[Playwright]:
    with sync_playwright() as playwright:
        yield playwright


@pytest.fixture(scope="session")
def browser(playwright_sync: Playwright):
    browser = playwright_sync.chromium.launch(headless=True)
    yield browser
    browser.close()


@pytest.fixture
def anonymous_page(browser, live_server: str):
    context = browser.new_context(base_url=live_server)
    page = context.new_page()
    yield page
    context.close()


@pytest.fixture
def auth_session(playwright_sync: Playwright, browser, live_server: str):
    storage_state, credentials = _signup_user(playwright_sync)
    api_context = _api_with_state(playwright_sync, storage_state)
    context = browser.new_context(
        base_url=live_server,
        storage_state=storage_state,
    )
    page = context.new_page()
    yield {
        "page": page,
        "context": context,
        "api": api_context,
        "storage_state": storage_state,
        "credentials": credentials,
    }
    api_context.dispose()
    context.close()


def test_anonymous_access_public_pages(anonymous_page, live_server: str):
    for path in PUBLIC_PATHS:
        response = anonymous_page.goto(path, wait_until="networkidle")
        assert response is not None and response.ok, f"Failed to load {path}"
        expect(anonymous_page.locator("body")).to_be_visible()


def test_anonymous_navigation_via_menu_and_sitemap(anonymous_page, live_server: str):
    anonymous_page.goto("/", wait_until="networkidle")

    nav_hrefs = _unique_nav_hrefs(anonymous_page, "a.site-nav__link")
    for href in nav_hrefs:
        anonymous_page.click(f"a.site-nav__link[href='{href}']")
        expect(anonymous_page).to_have_url(f"{live_server.rstrip('/')}{href}")
        anonymous_page.goto("/", wait_until="networkidle")

    anonymous_page.goto("/sitemap/", wait_until="networkidle")
    sitemap_hrefs = _unique_nav_hrefs(anonymous_page, "a.map-ledger__link")
    for href in sitemap_hrefs:
        anonymous_page.click(f"a.map-ledger__link[href='{href}']")
        expect(anonymous_page).to_have_url(f"{live_server.rstrip('/')}{href}")
        anonymous_page.goto("/sitemap/", wait_until="networkidle")


def test_authenticated_access_public_and_protected_pages(
    auth_session, live_server: str
):
    page = auth_session["page"]
    protected_paths = list(PUBLIC_PATHS) + ["/profile/"]

    for path in protected_paths:
        response = page.goto(path, wait_until="networkidle")
        assert response is not None and response.ok, f"Failed to load {path}"
        expect(page.locator("body")).to_be_visible()

    expect(page.locator("a.site-nav__link", has_text="My Profile")).to_be_visible()


def test_authenticated_navigation_via_menu_and_sitemap(auth_session, live_server: str):
    page = auth_session["page"]
    page.goto("/", wait_until="networkidle")

    nav_hrefs = _unique_nav_hrefs(page, "a.site-nav__link")
    for href in nav_hrefs:
        page.click(f"a.site-nav__link[href='{href}']")
        expect(page).to_have_url(f"{live_server.rstrip('/')}{href}")
        page.goto("/", wait_until="networkidle")

    page.goto("/sitemap/", wait_until="networkidle")
    sitemap_hrefs = _unique_nav_hrefs(page, "a.map-ledger__link")
    for href in sitemap_hrefs:
        page.click(f"a.map-ledger__link[href='{href}']")
        expect(page).to_have_url(f"{live_server.rstrip('/')}{href}")
        page.goto("/sitemap/", wait_until="networkidle")


def test_authenticated_can_submit_and_delete_feature(
    auth_session, live_server: str, playwright_sync: Playwright
):
    page = auth_session["page"]
    api_context = auth_session["api"]
    feature_title = f"E2E Feature {uuid4().hex[:6]}"
    description = "Automated end-to-end submission flow."

    page.goto("/features/", wait_until="networkidle")
    page.get_by_label("Title").fill(feature_title)
    page.get_by_label("Description").fill(description)
    with page.expect_navigation():
        page.get_by_role("button", name="Submit feature").click()
    expect(page.get_by_text("Feature submitted to the fresh board.")).to_be_visible()
    expect(page.get_by_text(feature_title)).to_be_visible()

    feature_list = api_context.get("/api/features").json()
    created = next(
        feature
        for feature in feature_list["features"]
        if feature["title"] == feature_title
    )
    delete_response = api_context.post(
        f"/api/features/{created['id']}/delete",
    )
    assert delete_response.ok, delete_response.text()

    refreshed = api_context.get("/api/features").json()
    titles = [item["title"] for item in refreshed["features"]]
    assert feature_title not in titles


def test_authenticated_can_vote_for_other_users_feature(
    playwright_sync: Playwright, browser, live_server: str
):
    other_state, _ = _signup_user(playwright_sync)
    other_api = _api_with_state(playwright_sync, other_state)
    feature_title = f"Peer feature {uuid4().hex[:6]}"
    create_resp = _post_json(
        other_api,
        "/api/features/create",
        {"title": feature_title, "description": "Vote for this peer feature"},
    )
    assert create_resp.ok, create_resp.text()
    feature_id = create_resp.json()["feature"]["id"]
    other_api.dispose()

    user_state, _ = _signup_user(playwright_sync)
    context = browser.new_context(base_url=live_server, storage_state=user_state)
    page = context.new_page()
    page.goto("/features/", wait_until="networkidle")

    user_api = _api_with_state(playwright_sync, user_state)
    vote_response = _post_json(user_api, f"/api/features/{feature_id}/vote", {})
    assert vote_response.ok, vote_response.text()
    user_api.dispose()

    updated_card = page.locator("article.feature-card", has_text=feature_title).first
    page.reload(wait_until="networkidle")
    updated_card = page.locator("article.feature-card", has_text=feature_title).first
    expect(updated_card).to_be_visible()
    expect(updated_card.get_by_role("button", name="Remove vote")).to_be_visible()

    user_api = _api_with_state(playwright_sync, user_state)
    features = user_api.get("/api/features").json()["features"]
    target = next(item for item in features if item["id"] == feature_id)
    assert target["user_has_voted"] is True
    assert target["vote_total"] >= 1

    user_api.dispose()
    context.close()


def test_arcade_terrarium_interactions(anonymous_page, live_server: str):
    page = anonymous_page
    page.goto("/arcade/terrarium/", wait_until="networkidle")

    canvas = page.locator("[data-sand-canvas]")
    expect(canvas).to_have_attribute("width", "640")
    expect(canvas).to_have_attribute("height", "480")

    page.get_by_role("button", name="Large").click()
    expect(canvas).to_have_attribute("width", "1280")
    expect(canvas).to_have_attribute("height", "800")

    page.get_by_role("button", name="Small").click()
    expect(page.locator("[data-sand-size-note]")).to_contain_text("640 x 480")

    page.get_by_role("button", name="Fullscreen").click()
    fullscreen_width = int(page.get_attribute("[data-sand-canvas]", "width") or "0")
    assert fullscreen_width >= 900
    page.get_by_role("button", name="Small").click()

    page.locator("[data-sand-brush='1']").click()
    expect(page.locator("[data-sand-status]")).to_contain_text("fine brush")

    invader_toggle = page.locator("[data-sand-invaders-toggle]")
    spawn_button = page.locator("[data-sand-invaders-spawn]")
    expect(spawn_button).to_be_disabled()
    invader_toggle.click()
    expect(invader_toggle).to_have_attribute("aria-pressed", "true")
    expect(spawn_button).to_be_enabled()
    invader_status = page.locator("[data-sand-invaders-status]")
    expect(invader_status).to_be_visible()
    assert "invader" in invader_status.inner_text().lower()

    breaker_toggle = page.locator("[data-breaker-toggle]")
    serve_button = page.locator("[data-breaker-serve]")
    expect(serve_button).to_be_disabled()
    breaker_toggle.click()
    expect(breaker_toggle).to_have_attribute("aria-pressed", "true")
    expect(serve_button).to_be_enabled()
    serve_button.click()
    breaker_status = page.locator("[data-breaker-status]")
    assert "orb" in breaker_status.inner_text().lower()
