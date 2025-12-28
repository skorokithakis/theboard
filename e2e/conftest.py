from __future__ import annotations

import os
import subprocess
import sys
from typing import Iterator

import pytest
from playwright.sync_api import Playwright, sync_playwright

from .shared import (
    BASE_DIR,
    SETTINGS_MODULE,
    SERVER_PORT,
    cleanup_database,
    run_manage_command,
    signup_user,
    wait_for_server,
    api_with_state,
)


@pytest.fixture(scope="session", autouse=True)
def prepare_database() -> Iterator[None]:
    cleanup_database()
    run_manage_command("migrate", "--noinput")
    yield
    cleanup_database()


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
        wait_for_server(f"http://localhost:{SERVER_PORT}/healthz/")
        yield f"http://localhost:{SERVER_PORT}"
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
        cleanup_database()


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
    storage_state, credentials = signup_user(playwright_sync)
    api_context = api_with_state(playwright_sync, storage_state)
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
