"""Application data models."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone as dt_timezone

from django.conf import settings
from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.db.models import Count
from django.utils import timezone
from django.utils.text import slugify


class UserManager(BaseUserManager):
    """Custom manager that uses a unique username for authentication."""

    use_in_migrations = True

    def _create_user(
        self, username: str, password: str | None, **extra_fields
    ) -> "User":
        if not username:
            raise ValueError("A username must be provided.")
        username = self.model.normalize_username(username)
        username = username.lower()
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

    class MenuSide(models.TextChoices):
        LEFT = "left", "Left"
        RIGHT = "right", "Right"

    username = models.CharField(
        max_length=150,
        unique=True,
        help_text="Unique handle members use to sign in and identify themselves.",
    )
    first_name = models.CharField(max_length=30, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    status = models.CharField(
        max_length=160,
        blank=True,
        help_text=(
            "Short message the member can pin to their profile to share their current focus or vibe."
        ),
    )
    balance = models.PositiveIntegerField(
        default=0,
        help_text="Amount of virtual currency the member has earned for daily logins and future board rewards.",
    )
    last_daily_bonus_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Timestamp of when the member most recently received the daily login bonus.",
    )
    menu_side = models.CharField(
        max_length=5,
        choices=MenuSide.choices,
        default=MenuSide.LEFT,
        help_text="Preferred side of the page where the global navigation menu should appear.",
    )
    menu_collapsed = models.BooleanField(
        default=False,
        help_text="Whether the global navigation should stay in its condensed, collapsed state for this member.",
    )
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

    def with_latest_vote_at(self) -> "FeatureQuerySet":
        """Annotate features with the timestamp of their most recent vote."""
        return self.annotate(latest_vote_at=models.Max("vote_records__created_at"))

    def ordered_by_popularity(self) -> "FeatureQuerySet":
        return self.with_vote_totals().order_by("-total_votes", "-created_at")

    def pending(self) -> "FeatureQuerySet":
        """Return features that have not been implemented or expired."""
        return self.filter(implemented_at__isnull=True, expired_at__isnull=True)

    def implemented(self) -> "FeatureQuerySet":
        """Return features that have been marked as implemented."""
        return self.filter(implemented_at__isnull=False)

    def expired(self) -> "FeatureQuerySet":
        """Return features that have expired without being implemented."""
        return self.filter(expired_at__isnull=False)


class Feature(models.Model):
    """A feature request or variation proposed by the community."""

    EXPIRATION_AGE = timedelta(days=7)

    class ImplementationState(models.TextChoices):
        SUCCESSFUL = "successful", "Successful"
        UNSUCCESSFUL = "unsuccessful", "Unsuccessful"

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
    implementation_commit_url = models.URLField(
        blank=True,
        default="",
        help_text=(
            "Direct link to the GitHub commit or diff that shipped this feature so contributors can review the code."
        ),
    )
    implemented_state = models.CharField(
        max_length=32,
        choices=ImplementationState.choices,
        null=True,
        blank=True,
        help_text="Outcome of the implementation run so we can distinguish successful vs. unsuccessful launches.",
    )
    e2e_test_reference = models.CharField(
        max_length=255,
        blank=True,
        help_text=(
            "Path or identifier for the end-to-end test that validates this feature once it has been implemented."
        ),
    )
    e2e_tests_last_synced_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text=(
            "Timestamp of when end-to-end coverage was last created or refreshed for this implemented feature."
        ),
    )
    expired_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Timestamp for when the feature was retired without being implemented.",
    )
    votes = models.IntegerField(
        null=True,
        blank=True,
        help_text=(
            "Historical vote count captured when the feature shipped or was retired. "
            "Only used once the feature is implemented or expired to keep showing votes after nightly cleanup."
        ),
    )
    missed_vote_days = models.PositiveIntegerField(
        default=0,
        help_text=(
            "Number of daily vote resets where this feature failed to receive an up-vote. "
            "Each missed day shortens the time before the feature expires."
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
        if (self.is_implemented or self.is_expired) and self.votes is not None:
            return self.votes
        return self.live_vote_total

    @property
    def is_implemented(self) -> bool:
        """Return True when the feature has been marked as implemented."""
        return self.implemented_at is not None

    @property
    def is_expired(self) -> bool:
        """Return True when the feature has been retired without implementation."""
        return self.expired_at is not None

    @property
    def expires_at(self) -> datetime | None:
        """Return the scheduled expiration timestamp (created_at + 7 days)."""
        if self.is_implemented or self.is_expired:
            return None
        penalty = timedelta(days=self.missed_vote_days)
        return self.created_at + self.EXPIRATION_AGE - penalty

    def implement(
        self, when: datetime | None = None, commit_url: str | None = None
    ) -> None:
        """Mark the feature as implemented and snapshot its vote total."""
        timestamp = when or timezone.now()
        snapshot = self.live_vote_total
        self.implemented_at = timestamp
        self.expired_at = None
        self.votes = snapshot
        if commit_url:
            self.implementation_commit_url = commit_url
        if not self.implemented_state:
            self.implemented_state = self.ImplementationState.SUCCESSFUL
        if not self.e2e_test_reference:
            slug = slugify(self.title) or f"feature-{self.pk or 'untracked'}"
            self.e2e_test_reference = f"e2e/implemented/{slug}.py"
        self.e2e_tests_last_synced_at = timestamp
        update_fields = [
            "implemented_at",
            "expired_at",
            "votes",
            "implemented_state",
            "e2e_test_reference",
            "e2e_tests_last_synced_at",
        ]
        if commit_url:
            update_fields.append("implementation_commit_url")
        self.save(update_fields=update_fields)
        self._delete_descendant_variations()

    def _delete_descendant_variations(self) -> None:
        """Delete every variation branching from this feature."""
        model = type(self)
        pending_ids = list(
            model.objects.filter(parent_id=self.pk).values_list("id", flat=True)
        )
        if not pending_ids:
            return

        descendant_ids: set[int] = set()
        while pending_ids:
            descendant_ids.update(pending_ids)
            pending_ids = list(
                model.objects.filter(parent_id__in=pending_ids).values_list(
                    "id", flat=True
                )
            )

        if descendant_ids:
            model.objects.filter(id__in=descendant_ids).delete()

    def expire(
        self,
        when: datetime | None = None,
        snapshot: int | None = None,
    ) -> None:
        """Retire the feature without implementation and snapshot its vote total."""
        timestamp = when or timezone.now()
        final_votes = snapshot if snapshot is not None else self.live_vote_total
        self.expired_at = timestamp
        self.votes = final_votes
        self.implemented_state = None
        self.save(update_fields=["expired_at", "votes", "implemented_state"])
        Vote.objects.filter(feature=self).delete()

    @classmethod
    def expire_stale(cls, reference: datetime | None = None) -> list[int]:
        """Expire features that have been pending for longer than the grace period."""
        now = reference or timezone.now()
        stale_features = (
            cls.objects.pending()
            .annotate(total_votes=Count("vote_records", distinct=True))
            .only(
                "id",
                "created_at",
                "missed_vote_days",
                "implemented_at",
                "expired_at",
            )
        )
        to_expire: list[Feature] = []
        for feature in stale_features:
            expires_at = feature.expires_at
            if expires_at and expires_at <= now:
                snapshot = getattr(feature, "total_votes", None)
                if snapshot is None:
                    snapshot = feature.live_vote_total
                feature.expired_at = now
                feature.votes = snapshot
                feature.implemented_state = None
                to_expire.append(feature)
        if not to_expire:
            return []

        expired_ids = [feature.pk for feature in to_expire]
        cls.objects.bulk_update(to_expire, ["expired_at", "votes", "implemented_state"])
        if expired_ids:
            Vote.objects.filter(feature_id__in=expired_ids).delete()
        return expired_ids

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


class QuoteSuggestion(models.Model):
    """User-submitted fortunes that can rotate onto the homepage."""

    text = models.TextField(
        help_text="Full quote that may appear in the rotating fortune slot.",
    )
    attribution = models.CharField(
        max_length=255,
        help_text="Name or source credited alongside the quote.",
    )
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="quote_suggestions",
        on_delete=models.CASCADE,
        help_text="Community member who suggested the quote.",
    )
    created_at = models.DateTimeField(
        auto_now_add=True,
        help_text="Timestamp for when the quote suggestion was created.",
    )
    is_approved = models.BooleanField(
        default=False,
        help_text="Indicates whether moderators have cleared this quote for rotation.",
    )
    approved_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Timestamp captured the moment moderation approved the quote.",
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.attribution}: {self.text[:40]}..."

    def save(self, *args, **kwargs):
        """Ensure the approval timestamp mirrors moderation state."""
        if self.is_approved and not self.approved_at:
            self.approved_at = timezone.now()
        elif not self.is_approved:
            self.approved_at = None
        super().save(*args, **kwargs)


class WebFiveInvestmentQuerySet(models.QuerySet):
    """Aggregations for Web 5.0 investments."""

    def total_committed(self) -> int:
        """Return the total coins committed across all investors."""
        total = self.aggregate(total=models.Sum("amount")).get("total") or 0
        return int(total)

    def total_for_user(self, user: User | None) -> int:
        """Return how much a member has personally invested."""
        if not getattr(user, "is_authenticated", False):
            return 0
        total = (
            self.filter(user=user).aggregate(total=models.Sum("amount")).get("total")
            or 0
        )
        return int(total)


class WebFiveInvestment(models.Model):
    """Records of coins funneled into the Web 5.0 initiative."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="web5_investments",
        on_delete=models.CASCADE,
        help_text="Member fueling the Web 5.0 treasury with their balance.",
    )
    amount = models.PositiveIntegerField(
        help_text="Number of coins committed to the Web 5.0 acceleration fund.",
    )
    created_at = models.DateTimeField(
        auto_now_add=True,
        help_text="Timestamp marking when this Web 5.0 investment was locked in.",
    )

    objects = WebFiveInvestmentQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.user} invested {self.amount}c in Web 5.0"
