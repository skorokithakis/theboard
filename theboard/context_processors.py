from django.conf import settings as sett

from main import easter_eggs
from main.navigation import build_nav_sections
from main.health import get_board_health


def settings(request):
    return {"settings": sett}


def board_health(request):
    return {"board_health": get_board_health()}


def navigation(request):
    """Expose grouped navigation for the header and sitemap."""

    current_name = getattr(getattr(request, "resolver_match", None), "url_name", None)
    menu_side = getattr(request.user, "menu_side", "left") or "left"
    menu_collapsed = bool(getattr(request.user, "menu_collapsed", False))
    if menu_side not in ("left", "right"):
        menu_side = "left"
    return {
        "nav_sections": build_nav_sections(
            current_name,
            request.user.is_authenticated if request.user else False,
        ),
        "nav_preferences": {
            "side": menu_side,
            "collapsed": menu_collapsed,
        },
    }


def neon_eggs(request):
    """Expose neon egg metadata to templates for the hidden hunt."""

    return {"neon_eggs": easter_eggs.serialize()}
