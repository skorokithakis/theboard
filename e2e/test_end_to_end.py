from __future__ import annotations

import re

from playwright.sync_api import Playwright, expect
from uuid import uuid4

from .shared import (
    PUBLIC_PATHS,
    api_with_state,
    expand_navigation,
    post_json,
    signup_user,
    unique_nav_hrefs,
)


def test_anonymous_access_public_pages(anonymous_page, live_server: str):
    for path in PUBLIC_PATHS:
        response = anonymous_page.goto(path, wait_until="networkidle")
        assert response is not None and response.ok, f"Failed to load {path}"
        expect(anonymous_page.locator("body")).to_be_visible()


def test_anonymous_navigation_via_menu_and_sitemap(anonymous_page, live_server: str):
    anonymous_page.goto("/", wait_until="networkidle")

    nav_hrefs = unique_nav_hrefs(anonymous_page, "a.site-nav__link")
    for href in nav_hrefs:
        expand_navigation(anonymous_page, href)
        if href.startswith("http"):
            with anonymous_page.context.expect_page() as new_page_info:
                anonymous_page.click(f"a.site-nav__link[href='{href}']")
            new_page = new_page_info.value
            new_page.wait_for_load_state()
            expect(new_page).to_have_url(href)
            new_page.close()
            anonymous_page.bring_to_front()
        else:
            anonymous_page.click(f"a.site-nav__link[href='{href}']")
            expect(anonymous_page).to_have_url(f"{live_server.rstrip('/')}{href}")
        anonymous_page.goto("/", wait_until="networkidle")
        expand_navigation(anonymous_page)

    anonymous_page.goto("/sitemap/", wait_until="networkidle")
    sitemap_hrefs = unique_nav_hrefs(anonymous_page, "a.map-ledger__link")
    for href in sitemap_hrefs:
        if href.startswith("http"):
            with anonymous_page.context.expect_page() as new_page_info:
                anonymous_page.click(f"a.map-ledger__link[href='{href}']")
            new_page = new_page_info.value
            new_page.wait_for_load_state()
            expect(new_page).to_have_url(href)
            new_page.close()
            anonymous_page.bring_to_front()
        else:
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

    expand_navigation(page, "/profile/")
    expect(page.locator("a.site-nav__link", has_text="My Profile")).to_be_visible()


def test_authenticated_navigation_via_menu_and_sitemap(auth_session, live_server: str):
    page = auth_session["page"]
    page.goto("/", wait_until="networkidle")

    nav_hrefs = unique_nav_hrefs(page, "a.site-nav__link")
    for href in nav_hrefs:
        expand_navigation(page, href)
        if href.startswith("http"):
            with page.context.expect_page() as new_page_info:
                page.click(f"a.site-nav__link[href='{href}']")
            new_page = new_page_info.value
            new_page.wait_for_load_state()
            expect(new_page).to_have_url(href)
            new_page.close()
            page.bring_to_front()
        else:
            page.click(f"a.site-nav__link[href='{href}']")
            expect(page).to_have_url(f"{live_server.rstrip('/')}{href}")
        page.goto("/", wait_until="networkidle")
        expand_navigation(page)

    page.goto("/sitemap/", wait_until="networkidle")
    sitemap_hrefs = unique_nav_hrefs(page, "a.map-ledger__link")
    for href in sitemap_hrefs:
        if href.startswith("http"):
            with page.context.expect_page() as new_page_info:
                page.click(f"a.map-ledger__link[href='{href}']")
            new_page = new_page_info.value
            new_page.wait_for_load_state()
            expect(new_page).to_have_url(href)
            new_page.close()
            page.bring_to_front()
        else:
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
    other_state, _ = signup_user(playwright_sync)
    other_api = api_with_state(playwright_sync, other_state)
    feature_title = f"Peer feature {uuid4().hex[:6]}"
    create_resp = post_json(
        other_api,
        "/api/features/create",
        {"title": feature_title, "description": "Vote for this peer feature"},
    )
    assert create_resp.ok, create_resp.text()
    feature_id = create_resp.json()["feature"]["id"]
    other_api.dispose()

    user_state, _ = signup_user(playwright_sync)
    context = browser.new_context(base_url=live_server, storage_state=user_state)
    page = context.new_page()
    page.goto("/features/", wait_until="networkidle")

    user_api = api_with_state(playwright_sync, user_state)
    vote_response = post_json(user_api, f"/api/features/{feature_id}/vote", {})
    assert vote_response.ok, vote_response.text()
    user_api.dispose()

    updated_card = page.locator("article.feature-card", has_text=feature_title).first
    page.reload(wait_until="networkidle")
    updated_card = page.locator("article.feature-card", has_text=feature_title).first
    expect(updated_card).to_be_visible()
    expect(updated_card.get_by_role("button", name="Remove vote")).to_be_visible()

    user_api = api_with_state(playwright_sync, user_state)
    features = user_api.get("/api/features").json()["features"]
    target = next(item for item in features if item["id"] == feature_id)
    assert target["user_has_voted"] is True
    assert target["vote_total"] >= 1

    user_api.dispose()
    context.close()


def test_neon_egg_claim_adds_bonus_vote(auth_session, live_server: str):
    page = auth_session["page"]
    api_context = auth_session["api"]
    feature_title = f"Neon egg {uuid4().hex[:6]}"

    create_resp = post_json(
        api_context,
        "/api/features/create",
        {"title": feature_title, "description": "Neon vote target"},
    )
    assert create_resp.ok, create_resp.text()
    feature_id = create_resp.json()["feature"]["id"]

    page.goto("/", wait_until="networkidle")
    page.locator(".neon-egg").first.click()
    modal = page.locator(".neon-egg-modal.is-visible")
    expect(modal).to_be_visible()

    expect(page.locator("#neon-egg-feature option").first).to_be_visible()
    page.select_option("#neon-egg-feature", label=feature_title)
    page.get_by_role("button", name="Claim neon vote").click()
    expect(page.locator(".neon-egg-status")).to_contain_text("neon vote")

    refreshed = api_context.get("/api/features").json()
    target = next(item for item in refreshed["features"] if item["id"] == feature_id)
    assert target["bonus_votes"] == 1
    assert target["vote_total"] == 2


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


def test_performance_sprint_interactions(anonymous_page, live_server: str):
    page = anonymous_page
    page.goto("/arcade/performance/", wait_until="networkidle")

    energy_fill = page.locator("[data-energy-fill]")
    initial_width = energy_fill.evaluate("el => el.style.width")
    page.get_by_role("button", name="Chug virtual energy drink").click()
    updated_width = energy_fill.evaluate("el => el.style.width")
    assert updated_width != initial_width

    log_items = page.locator("[data-benchmark-log] .performance-log__item")
    starting_count = log_items.count()
    page.get_by_role("button", name="Benchmark something random").click()
    expect(log_items).to_have_count(starting_count + 1, timeout=2000)

    brag_items = page.locator("[data-brag-board] .performance-bragboard__item")
    page.get_by_role("button", name="Brag about nanoseconds saved").click()
    expect(brag_items).to_have_count(1, timeout=2000)
    expect(page.locator("[data-brag-target]")).to_contain_text("faster")


def test_glitch_art_lab_interactions(anonymous_page, live_server: str):
    page = anonymous_page
    page.goto("/arcade/glitch/", wait_until="networkidle")

    viewport = page.locator("[data-glitch-viewport]")
    expect(viewport).to_be_visible()

    initial_filter = viewport.get_attribute("data-active-filter")
    page.get_by_role("button", name="Toggle random filter").click()
    expect(page.locator("[data-glitch-current]")).not_to_have_text(re.compile("^\\s*$"))
    updated_filter = viewport.get_attribute("data-active-filter")
    if initial_filter and updated_filter == initial_filter:
        page.get_by_role("button", name="Toggle random filter").click()
        updated_filter = viewport.get_attribute("data-active-filter")

    page.get_by_role("button", name="Frame this glitch").click()
    frames = page.locator("[data-glitch-gallery] [data-glitch-frame]")
    expect(frames).to_have_count(1, timeout=1500)
    expect(frames.first).to_have_attribute("data-filter-name", re.compile(".+"))
    preview = frames.first.locator(".glitch-frame__preview")
    expect(preview.locator(".glitch-echo").first).to_be_visible()
    expect(page.locator("[data-glitch-placeholder]")).to_have_count(0)
    assert updated_filter or initial_filter


def test_chaos_gremlin_lab_interactions(anonymous_page, live_server: str):
    page = anonymous_page
    page.goto("/arcade/gremlin/", wait_until="networkidle")

    roll_button = page.get_by_role("button", name="Roll the chaos dice")
    ship_button = page.get_by_role("button", name="Ship the headline")
    omen_text = page.locator("[data-gremlin-omen-text]")
    omen_flair = page.locator("[data-gremlin-omen-flair]")
    die_face = page.locator("[data-gremlin-die='a']")

    initial_omen = omen_text.inner_text()
    expect(omen_flair).to_have_text("Waiting")
    expect(ship_button).to_be_disabled()
    roll_button.click()
    expect(ship_button).to_be_enabled()
    expect(die_face).to_have_text(re.compile("[1-6]"))
    expect(omen_text).not_to_have_text(re.compile(re.escape(initial_omen)))
    expect(omen_flair).not_to_have_text("Waiting")

    ship_button.click()
    log_entries = page.locator("[data-gremlin-log] .gremlin-log__entry")
    expect(log_entries).to_have_count(1, timeout=2000)
    expect(page.locator("[data-gremlin-log-count]")).to_contain_text("shipped")


def test_assistant_toggle_and_gift_effect(auth_session, live_server: str):
    page = auth_session["page"]
    page.goto("/arcade/buddy/", wait_until="networkidle")

    body = page.locator("body")
    toggle = page.locator("[data-shimeji-master-toggle]")
    expect(toggle).to_be_visible()
    expect(body).to_have_attribute("data-shimeji-enabled", "false")

    toggle.click()
    expect(body).to_have_attribute("data-shimeji-enabled", "true")
    buddy = page.locator("[data-shimeji-root]")
    expect(buddy).to_be_visible()

    page.locator("[data-shimeji-open-shop]").first.click()
    lantern_action = page.locator("[data-item-id='lantern'] [data-purchase]")
    expect(lantern_action).to_be_visible()
    lantern_action.click()
    expect(lantern_action).to_be_disabled()
    assert page.evaluate("document.body.classList.contains('has-shimeji-lantern')")
    assert buddy.evaluate("node => node.classList.contains('has-lantern')")

    page.locator(".shimeji-shop__close").click()
    expect(page.locator(".shimeji-shop")).not_to_have_class(re.compile("is-open"))

    toggle.click()
    expect(body).to_have_attribute("data-shimeji-enabled", "false")
    assert buddy.evaluate("node => node.classList.contains('is-hidden')")
