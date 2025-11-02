"""Cloudflare Turnstile verification utilities."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Iterable
from urllib import error, parse, request

from django.conf import settings

VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class VerificationResult:
    success: bool
    error_codes: tuple[str, ...]


def is_enabled() -> bool:
    """Return whether Turnstile checks should run in the current environment."""
    return bool(getattr(settings, "TURNSTILE_ENABLED", False))


def verify(response_token: str, remote_ip: str | None = None) -> VerificationResult:
    """
    Validate a Turnstile response token using the site secret.

    Returns a VerificationResult indicating success and any error codes provided
    by the API. Any transport or parsing failures are treated as verification
    failures.
    """
    if not is_enabled():
        return VerificationResult(success=True, error_codes=())

    secret = getattr(settings, "TURNSTILE_SECRET_KEY", "")
    if not secret:
        logger.error("Turnstile verification attempted without TURNSTILE_SECRET_KEY")
        return VerificationResult(success=False, error_codes=("missing-secret",))

    if not response_token:
        return VerificationResult(
            success=False, error_codes=("missing-input-response",)
        )

    payload: dict[str, str] = {
        "secret": secret,
        "response": response_token,
    }
    if remote_ip:
        payload["remoteip"] = remote_ip

    encoded = parse.urlencode(payload).encode("utf-8")
    req = request.Request(
        VERIFY_URL,
        data=encoded,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=5) as resp:
            raw = resp.read().decode("utf-8")
    except error.URLError as exc:
        logger.warning("Turnstile verification request failed: %s", exc)
        return VerificationResult(success=False, error_codes=("network-error",))

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning("Turnstile verification returned invalid JSON: %s", exc)
        return VerificationResult(success=False, error_codes=("invalid-json",))

    success = bool(parsed.get("success", False))
    error_codes = _coerce_error_codes(parsed.get("error-codes", ()))
    return VerificationResult(success=success, error_codes=error_codes)


def _coerce_error_codes(raw_codes: Iterable[str] | str | None) -> tuple[str, ...]:
    if raw_codes is None:
        return ()
    if isinstance(raw_codes, str):
        return (raw_codes,)
    return tuple(str(code) for code in raw_codes)
