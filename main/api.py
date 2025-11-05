"""Django Ninja API configuration and endpoints."""

from __future__ import annotations

import logging
from typing import Any

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.core.cache import caches
from django.core.cache.backends.base import InvalidCacheBackendError
from django.db import connections
from django.db.models import Count, Prefetch, Q
from django.db.utils import OperationalError
from django.http import HttpRequest
from ninja import NinjaAPI
from ninja.errors import HttpError
from ninja.security import SessionAuth

from . import models, schemas, turnstile
from .utils import get_next_iteration_at

FEATURE_DAILY_LIMIT = 3
SIGNUP_DAILY_LIMIT = 2
SIGNUP_RATE_LIMIT_TTL_SECONDS = 60 * 60 * 24

logger = logging.getLogger(__name__)

PENDING_VARIATION_FILTER = Q(
    variations__implemented_at__isnull=True,
    variations__expired_at__isnull=True,
)


def custom_exception_handler(request: HttpRequest, exc: Exception):
    """Custom exception handler to format errors with 'error' key instead of 'detail'."""
    from django.http import JsonResponse

    if isinstance(exc, HttpError):
        return JsonResponse({"error": exc.message}, status=exc.status_code)
    return None


api = NinjaAPI(
    title="The Board API",
    version="1.0.0",
    description="A self-modifying feature board API",
    docs_url="/docs",
)

# Register custom exception handler.
api.exception_handler(HttpError)(custom_exception_handler)

session_auth = SessionAuth(csrf=False)


def _user_vote_ids(user: models.User) -> set[int]:
    """Get set of feature IDs the user has voted for."""
    if not user.is_authenticated:
        return set()
    return set(user.votes.values_list("feature_id", flat=True))


def _serialize_user(user: models.User) -> dict[str, Any]:
    """Convert a user model to a dictionary for schema validation."""
    return {
        "id": user.pk,
        "username": user.username,
        "display_name": user.display_name,
        "is_superuser": user.is_superuser,
    }


def _serialize_feature(
    feature: models.Feature,
    user_has_voted: bool = False,
) -> dict[str, Any]:
    """Convert a feature model to a dictionary for schema validation."""
    last_vote = feature.vote_records.order_by("-created_at").first()

    data: dict[str, Any] = {
        "id": feature.pk,
        "title": feature.title,
        "description": feature.description,
        "created_at": feature.created_at,
        "implemented_at": feature.implemented_at,
        "creator": _serialize_user(feature.creator),
        "vote_total": feature.vote_total,
        "user_has_voted": user_has_voted,
        "last_upvote_at": last_vote.created_at if last_vote else None,
        "expired_at": feature.expired_at,
        "expires_at": feature.expires_at,
    }

    if hasattr(feature, "variation_count"):
        data["variation_count"] = feature.variation_count

    if feature.parent_id:
        data["parent"] = {
            "id": feature.parent.pk,
            "title": feature.parent.title,
        }
    else:
        data["parent"] = None

    return data


def _client_ip(request: HttpRequest) -> str | None:
    """Extract client IP from request headers."""
    forwarded = request.META.get("HTTP_CF_CONNECTING_IP") or request.META.get(
        "HTTP_X_FORWARDED_FOR"
    )
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


@api.get(
    "/features", response=schemas.FeaturesListResponse, operation_id="api_features_list"
)
def features_list(request: HttpRequest) -> dict[str, Any]:
    """List pending features ordered by popularity and implemented features chronologically."""
    models.Feature.expire_stale()

    pending_qs = (
        models.Feature.objects.pending()
        .ordered_by_popularity()
        .select_related("creator", "parent")
        .annotate(
            variation_count=Count(
                "variations",
                filter=PENDING_VARIATION_FILTER,
                distinct=True,
            )
        )
    )

    implemented_qs = (
        models.Feature.objects.implemented()
        .with_vote_totals()
        .select_related("creator", "parent")
        .annotate(
            variation_count=Count(
                "variations",
                filter=PENDING_VARIATION_FILTER,
                distinct=True,
            )
        )
        .order_by("-implemented_at", "-created_at")
    )

    graveyard_qs = (
        models.Feature.objects.expired()
        .with_vote_totals()
        .select_related("creator", "parent")
        .annotate(
            variation_count=Count(
                "variations",
                filter=PENDING_VARIATION_FILTER,
                distinct=True,
            )
        )
        .order_by("-expired_at", "-created_at")
    )

    vote_ids = _user_vote_ids(request.user)
    features = [
        _serialize_feature(feature, feature.id in vote_ids) for feature in pending_qs
    ]
    implemented_features = [
        _serialize_feature(feature, feature.id in vote_ids)
        for feature in implemented_qs
    ]
    graveyard_features = [
        _serialize_feature(feature, feature.id in vote_ids) for feature in graveyard_qs
    ]

    can_submit = (
        request.user.is_authenticated
        and not models.Feature.user_has_reached_daily_limit(
            request.user, limit=FEATURE_DAILY_LIMIT
        )
    )

    next_iteration = get_next_iteration_at()

    return {
        "features": features,
        "implemented_features": implemented_features,
        "graveyard_features": graveyard_features,
        "can_submit": can_submit,
        "user": _serialize_user(request.user)
        if request.user.is_authenticated
        else None,
        "next_iteration_at": next_iteration,
    }


@api.post(
    "/features/create",
    response={201: schemas.FeatureCreateResponse},
    auth=session_auth,
    operation_id="api_feature_create",
)
def feature_create(
    request: HttpRequest, data: schemas.FeatureCreateInput
) -> tuple[int, dict[str, Any]]:
    """Create a new feature or variation."""
    models.Feature.expire_stale()

    if models.Feature.user_has_reached_daily_limit(
        request.user, limit=FEATURE_DAILY_LIMIT
    ):
        raise HttpError(
            403,
            f"Daily submission limit reached: {FEATURE_DAILY_LIMIT}",
        )

    if turnstile.is_enabled():
        verification_token = data.turnstile_token or ""
        verification = turnstile.verify(
            verification_token,
            remote_ip=_client_ip(request),
        )

        if not verification.success:
            logger.info(
                "Turnstile verification failed for user=%s errors=%s",
                request.user.pk,
                verification.error_codes,
            )
            raise HttpError(400, "Verification failed. Please try again.")

    title = data.title.strip()
    description = data.description.strip()

    if not title or not description:
        raise HttpError(400, "Title and description are required")

    parent_feature = None
    if data.parent_id:
        try:
            parent_feature = models.Feature.objects.get(pk=data.parent_id)
        except models.Feature.DoesNotExist as exc:
            raise HttpError(404, "Parent feature not found") from exc
        if parent_feature.is_implemented:
            raise HttpError(400, "Cannot add variations to an implemented feature")
        if parent_feature.is_expired:
            raise HttpError(400, "Cannot add variations to an expired feature")

    feature = models.Feature.objects.create(
        title=title,
        description=description,
        creator=request.user,
        parent=parent_feature,
    )

    models.Vote.objects.create(user=request.user, feature=feature)

    vote_ids = _user_vote_ids(request.user)
    return 201, {
        "feature": _serialize_feature(feature, feature.id in vote_ids),
        "message": "Feature created successfully",
    }


@api.get(
    "/features/{pk}",
    response=schemas.FeatureDetailResponse,
    operation_id="api_feature_detail",
)
def feature_detail(request: HttpRequest, pk: int) -> dict[str, Any]:
    """Get a single feature with its variations."""
    models.Feature.expire_stale()

    variations_qs = (
        models.Feature.objects.pending()
        .ordered_by_popularity()
        .select_related("creator")
        .annotate(
            variation_count=Count(
                "variations",
                filter=PENDING_VARIATION_FILTER,
                distinct=True,
            )
        )
    )

    try:
        feature = (
            models.Feature.objects.ordered_by_popularity()
            .select_related("creator", "parent")
            .prefetch_related(Prefetch("variations", queryset=variations_qs))
            .annotate(
                variation_count=Count(
                    "variations",
                    filter=PENDING_VARIATION_FILTER,
                    distinct=True,
                )
            )
            .get(pk=pk)
        )
    except models.Feature.DoesNotExist as exc:
        raise HttpError(404, "Feature not found") from exc

    vote_ids = _user_vote_ids(request.user)
    variations = [
        _serialize_feature(variation, variation.id in vote_ids)
        for variation in feature.variations.all()
    ]

    can_submit_variation = (
        not feature.is_implemented
        and not feature.is_expired
        and request.user.is_authenticated
        and not models.Feature.user_has_reached_daily_limit(
            request.user, limit=FEATURE_DAILY_LIMIT
        )
    )

    return {
        "feature": _serialize_feature(feature, feature.id in vote_ids),
        "variations": variations,
        "can_submit_variation": can_submit_variation,
        "user": _serialize_user(request.user)
        if request.user.is_authenticated
        else None,
    }


@api.post(
    "/features/{pk}/delete",
    response=schemas.MessageResponse,
    auth=session_auth,
    operation_id="api_feature_delete",
)
def feature_delete(request: HttpRequest, pk: int) -> dict[str, str]:
    """Delete a feature (only by its creator)."""
    try:
        feature = models.Feature.objects.get(pk=pk)
    except models.Feature.DoesNotExist as exc:
        raise HttpError(404, "Feature not found") from exc

    if not (request.user.is_superuser or feature.creator_id == request.user.id):
        raise HttpError(403, "You do not have permission to delete this feature")

    feature.delete()
    return {"message": "Feature deleted successfully"}


@api.post(
    "/features/{pk}/vote",
    response=schemas.VoteToggleResponse,
    auth=session_auth,
    operation_id="api_vote_toggle",
)
def vote_toggle(
    request: HttpRequest, pk: int, data: schemas.VoteToggleInput
) -> dict[str, Any]:
    """Toggle a vote on a feature (requires Turnstile verification in production)."""
    models.Feature.expire_stale()

    try:
        feature = (
            models.Feature.objects.select_related("creator")
            .annotate(total_votes=Count("vote_records", distinct=True))
            .get(pk=pk)
        )
    except models.Feature.DoesNotExist as exc:
        raise HttpError(404, "Feature not found") from exc

    if feature.is_implemented:
        raise HttpError(400, "Feature has already been implemented")
    if feature.is_expired:
        raise HttpError(400, "Feature has already been retired")

    if turnstile.is_enabled():
        verification_token = data.turnstile_token or ""
        verification = turnstile.verify(
            verification_token,
            remote_ip=_client_ip(request),
        )

        if not verification.success:
            logger.info(
                "Turnstile verification failed for user=%s feature=%s errors=%s",
                request.user.pk,
                feature.pk,
                verification.error_codes,
            )
            raise HttpError(400, "Verification failed. Please try again.")

    vote, created = models.Vote.objects.get_or_create(
        feature=feature,
        user=request.user,
    )
    if not created:
        vote.delete()
        action = "removed"
    else:
        action = "added"

    feature.refresh_from_db(fields=["created_at"])
    vote_total = feature.vote_records.count()
    has_voted = models.Vote.objects.filter(
        user=request.user,
        feature=feature,
    ).exists()

    return {
        "action": action,
        "has_voted": has_voted,
        "vote_total": vote_total,
    }


@api.post("/auth/login", response=schemas.LoginResponse, operation_id="api_login")
def auth_login(request: HttpRequest, data: schemas.LoginInput) -> dict[str, Any]:
    """Authenticate a user."""
    username = data.username.strip()
    password = data.password.strip()

    if not username or not password:
        raise HttpError(400, "Username and password are required")

    user = authenticate(request, username=username, password=password)
    if user is None:
        raise HttpError(401, "Invalid credentials")

    login(request, user)
    return {
        "message": "Login successful",
        "user": _serialize_user(user),
    }


@api.post("/auth/logout", response=schemas.MessageResponse, operation_id="api_logout")
def auth_logout(request: HttpRequest) -> dict[str, str]:
    """Log out the current user."""
    logout(request)
    return {"message": "Logout successful"}


@api.post(
    "/auth/signup", response={201: schemas.SignupResponse}, operation_id="api_signup"
)
def auth_signup(
    request: HttpRequest, data: schemas.SignupInput
) -> tuple[int, dict[str, Any]]:
    """Register a new user account."""
    if request.user.is_authenticated:
        raise HttpError(400, "Already authenticated")

    signup_cache = None
    signup_cache_key: str | None = None
    signup_count = 0
    if settings.ENVIRONMENT.lower() == "production":
        client_ip = _client_ip(request) or "unknown"
        signup_cache_key = f"signup-rate-limit:{client_ip}"
        try:
            signup_cache = caches["default"]
            signup_count = signup_cache.get(signup_cache_key, 0)
        except InvalidCacheBackendError:
            signup_cache = None
            logger.warning("Signup rate limiting skipped: default cache unavailable.")
        except Exception:
            signup_cache = None
            logger.exception(
                "Signup rate limiting skipped due to cache read failure for IP %s",
                client_ip,
            )
        else:
            if signup_count >= SIGNUP_DAILY_LIMIT:
                raise HttpError(
                    429,
                    "Too many accounts created from this IP today. Please try again later.",
                )

    username = data.username.strip()
    normalized_username = username.lower()
    password = data.password.strip()
    password_confirm = data.password_confirm.strip()

    if not username or not password:
        raise HttpError(400, "Username and password are required")

    if password != password_confirm:
        raise HttpError(400, "Passwords do not match")

    if models.User.objects.filter(username=normalized_username).exists():
        raise HttpError(400, "Username already in use")

    user = models.User.objects.create_user(
        username=normalized_username,
        password=password,
    )
    if signup_cache and signup_cache_key:
        try:
            signup_cache.set(
                signup_cache_key,
                signup_count + 1,
                SIGNUP_RATE_LIMIT_TTL_SECONDS,
            )
        except Exception:
            logger.exception(
                "Failed to update signup rate limit counter for key %s",
                signup_cache_key,
            )

    login(request, user)
    return 201, {
        "message": "Account created successfully",
        "user": _serialize_user(user),
    }


@api.get(
    "/auth/me",
    response=schemas.CurrentUserResponse,
    auth=session_auth,
    operation_id="api_current_user",
)
def current_user(request: HttpRequest) -> dict[str, Any]:
    """Get the current authenticated user."""
    can_submit = not models.Feature.user_has_reached_daily_limit(
        request.user, limit=FEATURE_DAILY_LIMIT
    )

    return {
        "user": _serialize_user(request.user),
        "can_submit": can_submit,
    }


@api.get("/top", response=schemas.FeatureDetailResponse, operation_id="api_top")
def top_feature(request: HttpRequest) -> dict[str, Any]:
    """Return the highest-rated feature as JSON."""
    models.Feature.expire_stale()

    variations_qs = (
        models.Feature.objects.pending()
        .ordered_by_popularity()
        .select_related("creator")
        .annotate(
            variation_count=Count(
                "variations",
                filter=PENDING_VARIATION_FILTER,
                distinct=True,
            )
        )
    )

    feature = (
        models.Feature.objects.pending()
        .ordered_by_popularity()
        .select_related("creator", "parent")
        .prefetch_related(Prefetch("variations", queryset=variations_qs))
        .annotate(
            variation_count=Count(
                "variations",
                filter=PENDING_VARIATION_FILTER,
                distinct=True,
            )
        )
        .first()
    )
    if not feature:
        raise HttpError(404, "No features available.")

    vote_ids = _user_vote_ids(request.user)
    variations = [
        _serialize_feature(variation, variation.id in vote_ids)
        for variation in feature.variations.all()
    ]

    can_submit_variation = (
        request.user.is_authenticated
        and not models.Feature.user_has_reached_daily_limit(
            request.user, limit=FEATURE_DAILY_LIMIT
        )
    )

    return {
        "feature": _serialize_feature(feature, feature.id in vote_ids),
        "variations": variations,
        "can_submit_variation": can_submit_variation,
        "user": _serialize_user(request.user)
        if request.user.is_authenticated
        else None,
    }


# Health check endpoint (separate from main API, not included in Swagger).
health_api = NinjaAPI(
    title="Health Check",
    version="1.0.0",
    docs_url=None,
    urls_namespace="health",
)


@health_api.get("", response=schemas.HealthCheckResponse, operation_id="healthz")
def healthz(request: HttpRequest) -> tuple[int, dict[str, Any]]:
    """Health endpoint touching database and cache connections."""
    status = 200
    results: dict[str, Any] = {}

    try:
        connection = connections["default"]
        with connection.cursor():
            pass
        results["database"] = "ok"
    except OperationalError as exc:
        results["database"] = "error"
        results["database_error"] = str(exc)
        status = 503

    try:
        cache = caches["default"]
        cache.set("healthz-ping", "pong", 5)
        if cache.get("healthz-ping") == "pong":
            results["cache"] = "ok"
        else:
            results["cache"] = "error"
            status = 503
    except InvalidCacheBackendError:
        results["cache"] = "unconfigured"
    except Exception as exc:
        results["cache"] = "error"
        results["cache_error"] = str(exc)
        status = 503

    return status, results
