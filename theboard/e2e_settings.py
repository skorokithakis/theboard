"""Settings overrides for running Playwright-powered end-to-end tests."""

from __future__ import annotations

from pathlib import Path

from .settings import *  # noqa: F403

BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = True
SECRET_KEY = "local-e2e-secret-key"
ENVIRONMENT = "local"

E2E_DB_NAME = BASE_DIR / "_e2e_db.sqlite3"
DATABASES = {  # type: ignore[override]
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": E2E_DB_NAME,
    }
}

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

STATICFILES_STORAGE = "django.contrib.staticfiles.storage.StaticFilesStorage"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": STATICFILES_STORAGE},
}

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

TURNSTILE_ENABLED = False
