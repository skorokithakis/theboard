"""Economy utilities for daily login rewards and balances."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.db import models
from django.utils import timezone

DAILY_LOGIN_BONUS = 25


def _current_utc_date(reference: datetime | None = None):
    """Return the UTC date for the provided reference or now."""
    moment = reference or timezone.now()
    return moment.astimezone(dt_timezone.utc).date()


def _start_of_day(moment: datetime) -> datetime:
    """Return the UTC midnight for the provided moment."""
    return moment.replace(hour=0, minute=0, second=0, microsecond=0)


def has_claimed_daily_bonus(user, reference: datetime | None = None) -> bool:
    """Return True when the user has already claimed today's daily bonus."""
    if not user.last_daily_bonus_at:
        return False
    return _current_utc_date(user.last_daily_bonus_at) == _current_utc_date(reference)


def next_daily_bonus_at(user, reference: datetime | None = None) -> datetime | None:
    """Return when the next bonus will become available."""
    now = reference or timezone.now()
    now_utc = now.astimezone(dt_timezone.utc)
    if user.last_daily_bonus_at:
        last_award = user.last_daily_bonus_at.astimezone(dt_timezone.utc)
        if last_award.date() == now_utc.date():
            return _start_of_day(last_award) + timedelta(days=1)
    return _start_of_day(now_utc) + timedelta(days=1)


def award_daily_login_bonus(
    user,
    *,
    amount: int | None = None,
    reference: datetime | None = None,
) -> bool:
    """Grant the daily login bonus if it has not been claimed yet."""
    if not getattr(user, "is_authenticated", False):
        return False

    reference_time = reference or timezone.now()
    user_id = getattr(user, "pk", None)
    if user_id is None:
        return False

    if has_claimed_daily_bonus(user, reference_time):
        return False

    bonus_amount = amount if amount is not None else DAILY_LOGIN_BONUS
    user_model = get_user_model()
    updated = user_model.objects.filter(pk=user_id).update(
        balance=models.F("balance") + bonus_amount,
        last_daily_bonus_at=reference_time,
    )
    if updated:
        user.refresh_from_db(fields=["balance", "last_daily_bonus_at"])
    return bool(updated)


def daily_bonus_status(user, reference: datetime | None = None) -> dict[str, object]:
    """Summarize bonus availability for UI and API responses."""
    now = reference or timezone.now()
    claimed_today = has_claimed_daily_bonus(user, now)
    return {
        "amount": DAILY_LOGIN_BONUS,
        "available": getattr(user, "is_authenticated", False) and not claimed_today,
        "last_awarded_at": user.last_daily_bonus_at,
        "next_available_at": next_daily_bonus_at(user, reference=now),
    }
