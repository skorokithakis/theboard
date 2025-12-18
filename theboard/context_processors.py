from django.conf import settings as sett

from main.navigation import build_nav_sections
from main.health import get_board_health


def settings(request):
    return {"settings": sett}


def board_health(request):
    return {"board_health": get_board_health()}


def navigation(request):
    """Expose grouped navigation for the header and sitemap."""

    current_name = getattr(getattr(request, "resolver_match", None), "url_name", None)
    return {
        "nav_sections": build_nav_sections(
            current_name,
            request.user.is_authenticated if request.user else False,
        )
    }
