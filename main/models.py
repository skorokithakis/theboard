"""Application data models."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone as dt_timezone

from django.conf import settings
from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.utils import timezone


class UserManager(BaseUserManager):
    """Custom manager that uses a unique username for authentication."""

    use_in_migrations = True

    def _create_user(
        self, username: str, password: str | None, **extra_fields
    ) -> "User":
        if not username:
            raise ValueError("A username must be provided.")
        username = self.model.normalize_username(username)
        user = self.model(username=username, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(
        self, username: str, password: str | None = None, **extra_fields
    ) -> "User":
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(username, password, **extra_fields)

    def create_superuser(
        self,
        username: str,
        password: str | None,
        **extra_fields,
    ) -> "User":
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)

        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")

        return self._create_user(username, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    """Custom user model that authenticates with a unique username."""

    username = models.CharField(
        max_length=150,
        unique=True,
        help_text="Unique handle members use to sign in and identify themselves.",
    )
    first_name = models.CharField(max_length=30, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    is_staff = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "username"
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        verbose_name = "user"
        verbose_name_plural = "users"

    def __str__(self) -> str:
        return self.display_name

    @property
    def display_name(self) -> str:
        """Readable name for templates and API payloads."""
        full_name = self.get_full_name()
        return full_name if full_name else self.username

    def get_full_name(self) -> str:
        return " ".join(filter(None, [self.first_name, self.last_name]))

    def get_short_name(self) -> str:
        return self.first_name or self.username


class FeatureQuerySet(models.QuerySet):
    """Custom queryset utilities for Feature objects."""

    def with_vote_totals(self) -> "FeatureQuerySet":
        return self.annotate(total_votes=models.Count("vote_records", distinct=True))

    def ordered_by_popularity(self) -> "FeatureQuerySet":
        return self.with_vote_totals().order_by("-total_votes", "-created_at")

    def pending(self) -> "FeatureQuerySet":
        """Return features that have not been implemented yet."""
        return self.filter(implemented_at__isnull=True)

    def implemented(self) -> "FeatureQuerySet":
        """Return features that have been marked as implemented."""
        return self.filter(implemented_at__isnull=False)


class Feature(models.Model):
    """A feature request or variation proposed by the community."""

    title = models.CharField(max_length=200)
    description = models.TextField()
    creator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="features",
        on_delete=models.CASCADE,
    )
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        related_name="variations",
        on_delete=models.SET_NULL,
        help_text="Optional parent feature for marking this as a variation.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    implemented_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Timestamp for when the feature was implemented.",
    )
    votes = models.IntegerField(
        null=True,
        blank=True,
        help_text=(
            "Historical vote count captured at implementation time. "
            "Only used once the feature is implemented to keep showing votes after nightly cleanup."
        ),
    )

    objects = FeatureQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.title

    @property
    def live_vote_total(self) -> int:
        """Return the live vote count, using an annotation when available."""
        annotated_total = getattr(self, "total_votes", None)
        if annotated_total is not None:
            return annotated_total
        return self.vote_records.count()

    @property
    def vote_total(self) -> int:
        """Return pre-annotated vote totals or compute on demand."""
        if self.is_implemented and self.votes is not None:
            return self.votes
        return self.live_vote_total

    @property
    def is_implemented(self) -> bool:
        """Return True when the feature has been marked as implemented."""
        return self.implemented_at is not None

    def implement(self, when: datetime | None = None) -> None:
        """Mark the feature as implemented and snapshot its vote total."""
        timestamp = when or timezone.now()
        snapshot = self.live_vote_total
        self.implemented_at = timestamp
        self.votes = snapshot
        self.save(update_fields=["implemented_at", "votes"])

    @classmethod
    def submissions_in_utc_day(cls, user: User, when: datetime | None = None) -> int:
        """Count submissions a user has created within the UTC day containing ``when``."""
        reference = when or timezone.now()
        reference_utc = reference.astimezone(dt_timezone.utc)
        start = reference_utc.replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
        return (
            cls.objects.filter(
                creator=user,
                created_at__gte=start,
                created_at__lt=end,
            )
            .only("id")
            .count()
        )

    @classmethod
    def user_has_reached_daily_limit(cls, user: User, limit: int = 3) -> bool:
        """Return True if the user has already hit the submission limit for the UTC day."""
        return cls.submissions_in_utc_day(user) >= limit


class Vote(models.Model):
    """Represents a single up-vote from a user on a feature."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="votes",
        on_delete=models.CASCADE,
    )
    feature = models.ForeignKey(
        Feature,
        related_name="vote_records",
        on_delete=models.CASCADE,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "feature"],
                name="unique_vote_per_user_feature",
            )
        ]

    def __str__(self) -> str:
        return f"{self.user} → {self.feature}"
