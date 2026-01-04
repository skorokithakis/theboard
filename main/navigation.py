"""Navigation helpers for primary menus and the sitemap."""

from __future__ import annotations

from typing import Any, Iterable

from django.urls import reverse


NAV_SECTIONS: list[dict[str, Any]] = [
    {
        "key": "features",
        "label": "Features",
        "description": "Submit requests and vote them forward.",
        "links": [
            {
                "name": "feature-board",
                "label": "Feature Lab",
                "summary": "Submit ideas and vote them up with full context.",
                "kind": "fortress",
                "active_names": ["feature-board", "feature-vote-toggle"],
            },
            {
                "name": "implemented-features",
                "label": "Shipped Ledger",
                "summary": "Search the archive of implemented suggestions.",
                "kind": "library",
            },
            {
                "name": "plaintext-submission",
                "label": "Plaintext Outpost",
                "summary": "Fallback submission with the same CAPTCHA voting rules.",
                "kind": "outpost",
                "active_names": ["plaintext-submission", "plaintext-vote-toggle"],
            },
            {
                "name": "graveyard",
                "label": "Feature Graveyard",
                "summary": "Where expired ideas rest.",
                "kind": "ruins",
            },
        ],
    },
    {
        "key": "arcade",
        "label": "Arcade",
        "description": "Playful experiments and sandboxes.",
        "links": [
            {
                "name": "arcade",
                "label": "Arcade Atrium",
                "summary": "Hub for penguins, sand, quotes, and the buddy.",
                "kind": "grove",
            },
            {
                "name": "arcade-terrarium",
                "label": "Terrarium Lab",
                "summary": "Board-health-driven falling sand.",
                "kind": "library",
            },
            {
                "name": "arcade-performance",
                "label": "Performance Sprint",
                "summary": "Benchmark the board until everything claims a 2x speedup.",
                "kind": "fortress",
            },
            {
                "name": "arcade-quotes",
                "label": "Quote Oracle",
                "summary": "Fortunes and quote submissions.",
                "kind": "hamlet",
                "active_names": ["arcade-quotes", "fortune-suggest"],
            },
            {
                "name": "arcade-ishmael",
                "label": "Ishmael's Cabin",
                "summary": "Maritime reading room with live queue signals.",
                "kind": "grove",
            },
            {
                "name": "arcade-buddy",
                "label": "Buddy Workshop",
                "summary": "Summon and customize the roaming buddy.",
                "kind": "village",
            },
            {
                "name": "penguin-view",
                "label": "Penguin Parade",
                "summary": "Live penguin cam from Edinburgh Zoo.",
                "kind": "village",
            },
        ],
    },
    {
        "key": "lore",
        "label": "Lore",
        "description": "Worldbuilding, initiatives, and the ruleset.",
        "links": [
            {
                "name": "board-self",
                "label": "The Board",
                "summary": "Where The Board reflects and seeds its own happiness.",
                "kind": "library",
            },
            {
                "name": "retrospective-2025",
                "label": "2025 Retrospective",
                "summary": "End-of-year report with delivery stats and what we're building next.",
                "kind": "tower",
            },
            {
                "name": "about",
                "label": "About",
                "summary": "How the reset works and what's changed.",
                "kind": "grove",
            },
            {
                "name": "web5",
                "label": "Web 5.0 Vault",
                "summary": "Invest in the initiative from a focused page.",
                "kind": "tower",
                "active_names": ["web5", "web5-invest"],
            },
        ],
    },
    {
        "key": "records",
        "label": "Records",
        "description": "Scorekeeping and the historical ledger.",
        "links": [
            {
                "name": "scoreboard",
                "label": "Scorekeep Arena",
                "summary": "Leaderboard of prolific idea forgers.",
                "kind": "hamlet",
            },
            {
                "name": "archive-index",
                "label": "Archive Keep",
                "summary": "Historical board preserved in amber.",
                "kind": "library",
            },
            {
                "name": "archive-about",
                "label": "Chronicle Tower",
                "summary": "The old world's about page.",
                "kind": "tower",
            },
            {
                "name": "archive-scoreboard",
                "label": "Legacy Score Dunes",
                "summary": "Frozen-in-time leaderboard.",
                "kind": "hamlet",
            },
        ],
    },
    {
        "key": "navigation",
        "label": "Navigation",
        "description": "Maps and shortcuts across The Board.",
        "links": [
            {
                "name": "sitemap",
                "label": "3D Sitemap",
                "summary": "Orbit map of every Board page.",
                "kind": "capital",
            },
            {
                "name": "plaintext-sitemap",
                "label": "Plaintext Sitemap",
                "summary": "Unstyled fallback map that updates itself from the live nav.",
                "kind": "outpost",
            },
            {
                "label": "GitHub",
                "summary": "Source code for The Board on GitHub.",
                "kind": "outpost",
                "external_url": "https://github.com/skorokithakis/theboard",
            },
        ],
    },
]

ACCOUNT_SECTION = {
    "key": "account",
    "label": "Account",
    "description": "Your balance, submissions, and settings.",
    "links": [
        {
            "name": "profile",
            "label": "My Profile",
            "summary": "Check your status, submissions, and lore.",
            "kind": "village",
            "active_names": ["profile", "profile-detail"],
        }
    ],
    "requires_auth": True,
}


def _iter_sections(is_authenticated: bool) -> Iterable[dict[str, Any]]:
    for section in NAV_SECTIONS:
        yield section

    if is_authenticated:
        yield ACCOUNT_SECTION


def build_nav_sections(
    current_url_name: str | None, is_authenticated: bool
) -> list[dict[str, Any]]:
    """Compute the nav tree with resolved URLs and active states."""

    resolved_sections = []
    for section in _iter_sections(is_authenticated):
        section_links = []
        section_active = False

        for link in section["links"]:
            link_name = link.get("name")
            active_names = set(link.get("active_names", []))
            if link_name:
                active_names.add(link_name)

            is_external = bool(link.get("external_url"))
            is_active = current_url_name in active_names if not is_external else False
            section_active = section_active or is_active

            link_url = link.get("external_url")
            if not link_url and link_name:
                link_url = reverse(f"main:{link_name}")

            section_links.append(
                {
                    "label": link["label"],
                    "summary": link["summary"],
                    "url": link_url or "",
                    "active": is_active,
                    "external": is_external,
                }
            )

        resolved_sections.append(
            {
                "key": section["key"],
                "label": section["label"],
                "description": section["description"],
                "links": section_links,
                "active": section_active,
            }
        )

    return resolved_sections


def build_sitemap_destinations(is_authenticated: bool) -> list[dict[str, Any]]:
    """Produce the sitemap destinations from the nav structure."""

    destinations = [
        {
            "name": "Atrium of Ideas",
            "url": reverse("main:index"),
            "kind": "capital",
            "summary": "Landing pad for everything The Board is tracking.",
            "category": "Home Base",
            "section": "The Board's front door.",
        }
    ]

    for section in _iter_sections(is_authenticated):
        for link in section["links"]:
            if link.get("external_url"):
                destinations.append(
                    {
                        "name": link["label"],
                        "url": link["external_url"],
                        "kind": link.get("kind", "grove"),
                        "summary": link["summary"],
                        "category": section["label"],
                        "section": section["description"],
                        "external": True,
                    }
                )
                continue

            destinations.append(
                {
                    "name": link["label"],
                    "url": reverse(f"main:{link['name']}"),
                    "kind": link.get("kind", "grove"),
                    "summary": link["summary"],
                    "category": section["label"],
                    "section": section["description"],
                    "external": False,
                }
            )

    return destinations
