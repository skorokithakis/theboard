"""Pydantic schemas for API request/response validation."""

from __future__ import annotations

from datetime import datetime

from ninja import Schema


class UserSchema(Schema):
    """User representation in API responses."""

    id: int
    email: str
    display_name: str
    is_superuser: bool


class ParentFeatureSchema(Schema):
    """Minimal parent feature representation."""

    id: int
    title: str


class FeatureSchema(Schema):
    """Feature representation in list views."""

    id: int
    title: str
    description: str
    created_at: datetime
    implemented_at: datetime | None = None
    creator: UserSchema
    vote_total: int
    user_has_voted: bool
    parent: ParentFeatureSchema | None = None
    variation_count: int | None = None
    last_upvote_at: datetime | None = None


class FeatureDetailSchema(Schema):
    """Detailed feature representation with variations."""

    id: int
    title: str
    description: str
    created_at: datetime
    implemented_at: datetime | None = None
    creator: UserSchema
    vote_total: int
    user_has_voted: bool
    parent: ParentFeatureSchema | None = None
    variation_count: int | None = None
    last_upvote_at: datetime | None = None
    variations: list[FeatureSchema] | None = None


class FeatureCreateInput(Schema):
    """Input for creating a new feature or variation."""

    title: str
    description: str
    parent_id: int | None = None
    turnstile_token: str | None = None


class LoginInput(Schema):
    """Input for user login."""

    email: str
    password: str


class SignupInput(Schema):
    """Input for user registration."""

    email: str
    password: str
    password_confirm: str


class VoteToggleInput(Schema):
    """Input for vote toggle (with optional Turnstile token)."""

    turnstile_token: str | None = None


class FeaturesListResponse(Schema):
    """Response for features list endpoint."""

    features: list[FeatureSchema]
    implemented_features: list[FeatureSchema]
    can_submit: bool
    user: UserSchema | None


class FeatureDetailResponse(Schema):
    """Response for feature detail endpoint."""

    feature: FeatureSchema
    variations: list[FeatureSchema]
    can_submit_variation: bool
    user: UserSchema | None


class FeatureCreateResponse(Schema):
    """Response for feature creation."""

    feature: FeatureSchema
    message: str


class MessageResponse(Schema):
    """Generic message response."""

    message: str


class ErrorResponse(Schema):
    """Generic error response."""

    error: str
    error_codes: list[str] | None = None
    limit: int | None = None


class LoginResponse(Schema):
    """Response for login endpoint."""

    message: str
    user: UserSchema


class SignupResponse(Schema):
    """Response for signup endpoint."""

    message: str
    user: UserSchema


class CurrentUserResponse(Schema):
    """Response for current user endpoint."""

    user: UserSchema
    can_submit: bool


class VoteToggleResponse(Schema):
    """Response for vote toggle endpoint."""

    action: str
    has_voted: bool
    vote_total: int


class HealthCheckResponse(Schema):
    """Response for health check endpoint."""

    database: str
    cache: str
    database_error: str | None = None
    cache_error: str | None = None
