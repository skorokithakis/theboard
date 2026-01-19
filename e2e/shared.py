from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional, Tuple
from urllib.error import URLError
from urllib.request import Request, urlopen
from uuid import uuid4

from playwright.sync_api import Playwright

BASE_DIR = Path(__file__).resolve().parent.parent
SETTINGS_MODULE = os.environ.setdefault(
    "DJANGO_SETTINGS_MODULE", "theboard.e2e_settings"
)
E2E_DB_PATH = Path(os.environ.get("E2E_DB_PATH") or (BASE_DIR / "_e2e_db.sqlite3"))
SERVER_PORT = int(os.environ.get("E2E_TEST_PORT", "8001"))
SERVER_URL = f"http://localhost:{SERVER_PORT}"

PUBLIC_PATHS: Tuple[str, ...] = (
    "/",
    "/features/",
    "/plaintext-submission/",
    "/graveyard/",
    "/about/",
    "/the-board/",
    "/lore/zero-decibel/",
    "/lore/intermission/",
    "/arcade/",
    "/arcade/terrarium/",
    "/arcade/quotes/",
    "/arcade/performance/",
    "/arcade/glitch/",
    "/arcade/gremlin/",
    "/arcade/buddy/",
    "/arcade/penguins/",
    "/arcade/ishmael/",
    "/web5/",
    "/scoreboard/",
    "/archive/",
    "/archive/about/",
    "/archive/scoreboard/",
    "/sitemap/",
)


def wait_for_server(url: str, timeout: float = 30) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            request = Request(url, method="GET")
            with urlopen(request):
                return
        except URLError:
            time.sleep(0.5)
    raise RuntimeError(f"Timed out waiting for server at {url}")


def cleanup_database() -> None:
    if E2E_DB_PATH.exists():
        E2E_DB_PATH.unlink()


def run_manage_command(*args: str) -> None:
    env = {**os.environ, "DJANGO_SETTINGS_MODULE": SETTINGS_MODULE}
    subprocess.run(
        [sys.executable, "manage.py", *args, f"--settings={SETTINGS_MODULE}"],
        cwd=BASE_DIR,
        check=True,
        env=env,
    )


def post_json(api_context, path: str, payload: dict):
    return api_context.post(
        path,
        data=json.dumps(payload),
        headers={"content-type": "application/json"},
    )


def signup_user(playwright: Playwright) -> tuple[dict, dict[str, str]]:
    api_context = playwright.request.new_context(base_url=SERVER_URL)
    credentials = {
        "username": f"tester_{uuid4().hex[:8]}",
        "password": "Test-pass-123",
        "password_confirm": "Test-pass-123",
    }
    response = post_json(api_context, "/api/auth/signup", credentials)
    assert response.ok, f"Signup failed: {response.status} {response.text()}"
    storage = api_context.storage_state()
    api_context.dispose()
    return storage, credentials


def api_with_state(playwright: Playwright, storage_state: dict):
    return playwright.request.new_context(
        base_url=SERVER_URL,
        storage_state=storage_state,
    )


def expand_navigation(page, target_href: Optional[str] = None) -> None:
    toggle = page.locator(".site-nav__toggle")
    if toggle.is_visible() and toggle.get_attribute("aria-expanded") != "true":
        toggle.click()

    if target_href:
        section_button = page.locator(
            f"a.site-nav__link[href='{target_href}']"
        ).locator(
            "xpath=ancestor::li[contains(@class, 'site-nav__section')]//button[contains(@class, 'site-nav__section-toggle')]"
        )
        if section_button.count() > 0:
            section_button.first.click()
        return

    section_toggles = page.locator(".site-nav__section-toggle")
    for idx in range(section_toggles.count()):
        section_toggles.nth(idx).click()


def unique_nav_hrefs(page, selector: str) -> list[str]:
    hrefs = page.eval_on_selector_all(
        selector,
        "elements => elements.map(el => el.getAttribute('href')).filter(Boolean)",
    )
    return list(dict.fromkeys(hrefs))  # Preserve order while deduplicating.
