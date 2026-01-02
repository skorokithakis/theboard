"""Pydantic schemas for API request/response validation."""

from __future__ import annotations

from datetime import datetime

from ninja import Schema


class UserSchema(Schema):
    """User representation in API responses."""

    id: int
    username: str
    display_name: str
    avatar_url: str | None = None
    status: str | None = None
    is_superuser: bool
    balance: int
    web5_invested: int
    last_daily_bonus_at: datetime | None = None
    next_daily_bonus_at: datetime | None = None
    daily_bonus_available: bool
    daily_bonus_amount: int


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
    implemented_state: str | None = None
    implementation_commit_url: str | None = None
    implementation_failure_notes: str | None = None
    creator: UserSchema
    vote_total: int
    user_has_voted: bool
    parent: ParentFeatureSchema | None = None
    variation_count: int | None = None
    last_upvote_at: datetime | None = None
    expired_at: datetime | None = None
    expires_at: datetime | None = None


class FeatureDetailSchema(Schema):
    """Detailed feature representation with variations."""

    id: int
    title: str
    description: str
    created_at: datetime
    implemented_at: datetime | None = None
    implemented_state: str | None = None
    implementation_commit_url: str | None = None
    implementation_failure_notes: str | None = None
    creator: UserSchema
    vote_total: int
    user_has_voted: bool
    parent: ParentFeatureSchema | None = None
    variation_count: int | None = None
    last_upvote_at: datetime | None = None
    variations: list[FeatureSchema] | None = None
    expired_at: datetime | None = None
    expires_at: datetime | None = None


class FeatureCreateInput(Schema):
    """Input for creating a new feature or variation."""

    title: str
    description: str
    parent_id: int | None = None
    turnstile_token: str | None = None


class LoginInput(Schema):
    """Input for user login."""

    username: str
    password: str


class SignupInput(Schema):
    """Input for user registration."""

    username: str
    password: str
    password_confirm: str


class VoteToggleInput(Schema):
    """Input for vote toggle (with optional Turnstile token)."""

    turnstile_token: str | None = None


class FeaturesListResponse(Schema):
    """Response for features list endpoint."""

    features: list[FeatureSchema]
    implemented_features: list[FeatureSchema]
    graveyard_features: list[FeatureSchema]
    can_submit: bool
    user: UserSchema | None
    next_iteration_at: datetime | None = None


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
    daily_bonus_awarded: bool
    daily_bonus_amount: int


class SignupResponse(Schema):
    """Response for signup endpoint."""

    message: str
    user: UserSchema
    daily_bonus_awarded: bool
    daily_bonus_amount: int


class Web5InvestmentInput(Schema):
    """Input payload for Web 5.0 investment."""

    amount: int


class Web5InvestmentResponse(Schema):
    """Response after investing in Web 5.0."""

    message: str
    total_committed: int
    user_committed: int
    balance: int


class Web5StatusResponse(Schema):
    """Read-only snapshot of Web 5.0 fund totals."""

    total_committed: int
    user_committed: int
    balance: int


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
