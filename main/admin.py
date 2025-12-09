"""Admin registrations for core models."""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.forms import UserChangeForm, UserCreationForm
from django.db.models import Count
from djangoql.admin import DjangoQLSearchMixin

from . import models


class CustomUserCreationForm(UserCreationForm):
    class Meta(UserCreationForm.Meta):
        model = models.User
        fields = ("username",)


class CustomUserChangeForm(UserChangeForm):
    class Meta(UserChangeForm.Meta):
        model = models.User
        fields = "__all__"


@admin.register(models.User)
class CustomUserAdmin(BaseUserAdmin):
    """Configure admin interface for the username-based user model."""

    add_form = CustomUserCreationForm
    form = CustomUserChangeForm
    model = models.User

    list_display = (
        "username",
        "first_name",
        "last_name",
        "balance",
        "is_staff",
        "is_active",
    )
    list_filter = ("is_staff", "is_superuser", "is_active", "groups")
    ordering = ("username",)
    search_fields = ("username", "first_name", "last_name")
    readonly_fields = ("last_daily_bonus_at",)

    fieldsets = (
        (None, {"fields": ("username", "password")}),
        ("Personal info", {"fields": ("first_name", "last_name")}),
        (
            "Permissions",
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                )
            },
        ),
        ("Economy", {"fields": ("balance", "last_daily_bonus_at")}),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": (
                    "username",
                    "password1",
                    "password2",
                    "is_staff",
                    "is_superuser",
                    "is_active",
                    "groups",
                    "user_permissions",
                ),
            },
        ),
    )


@admin.register(models.Feature)
class FeatureAdmin(DjangoQLSearchMixin, admin.ModelAdmin):
    list_display = (
        "title",
        "creator",
        "created_at",
        "implemented_at",
        "implemented_state",
        "parent",
        "display_vote_total",
    )
    list_filter = ("created_at", "implemented_at", "implemented_state", "parent")
    search_fields = ("title", "description", "creator__username")
    autocomplete_fields = ("creator", "parent")
    ordering = ("-created_at",)
    readonly_fields = ("created_at", "implemented_at", "expired_at", "votes")
    fieldsets = (
        (
            "Feature request",
            {
                "fields": (
                    "title",
                    "description",
                    "creator",
                    "parent",
                )
            },
        ),
        (
            "Lifecycle",
            {
                "fields": (
                    "created_at",
                    "implemented_at",
                    "implemented_state",
                    "expired_at",
                    "missed_vote_days",
                    "votes",
                )
            },
        ),
    )

    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        # Use the same annotation name the model's ``vote_total`` property expects
        # so the property can read the cached value without Django attempting to
        # assign to the read-only attribute.
        return queryset.annotate(total_votes=Count("vote_records", distinct=True))

    @admin.display(description="Votes", ordering="total_votes")
    def display_vote_total(self, obj: models.Feature) -> int:
        return getattr(obj, "vote_total", 0)


@admin.register(models.Vote)
class VoteAdmin(DjangoQLSearchMixin, admin.ModelAdmin):
    list_display = ("feature", "user", "created_at")
    list_filter = ("created_at",)
    autocomplete_fields = ("feature", "user")


@admin.register(models.QuoteSuggestion)
class QuoteSuggestionAdmin(DjangoQLSearchMixin, admin.ModelAdmin):
    """Moderation interface for community fortune submissions."""

    list_display = (
        "attribution",
        "display_excerpt",
        "is_approved",
        "submitted_by",
        "created_at",
        "approved_at",
    )
    list_filter = ("is_approved", "created_at", "approved_at")
    search_fields = ("text", "attribution", "submitted_by__username")
    autocomplete_fields = ("submitted_by",)
    ordering = ("-created_at",)

    @admin.display(description="Quote")
    def display_excerpt(self, obj: models.QuoteSuggestion) -> str:
        return obj.text[:80] + ("…" if len(obj.text) > 80 else "")


@admin.register(models.WebFiveInvestment)
class WebFiveInvestmentAdmin(DjangoQLSearchMixin, admin.ModelAdmin):
    """Admin listing for Web 5.0 treasury contributions."""

    list_display = ("user", "amount", "created_at")
    list_filter = ("created_at",)
    search_fields = ("user__username",)
    autocomplete_fields = ("user",)
