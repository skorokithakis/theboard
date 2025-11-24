"""Middleware for economy features."""

from __future__ import annotations

from . import economy


class DailyLoginRewardMiddleware:
    """Award the daily login bonus as soon as an authenticated user hits the site."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, "user", None)
        if user is not None and getattr(user, "is_authenticated", False):
            economy.award_daily_login_bonus(user)
        return self.get_response(request)
