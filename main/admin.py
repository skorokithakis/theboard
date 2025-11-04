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
        fields = ("email",)


class CustomUserChangeForm(UserChangeForm):
    class Meta(UserChangeForm.Meta):
        model = models.User
        fields = "__all__"


@admin.register(models.User)
class CustomUserAdmin(BaseUserAdmin):
    """Configure admin interface for the email-based user model."""

    add_form = CustomUserCreationForm
    form = CustomUserChangeForm
    model = models.User

    list_display = ("email", "first_name", "last_name", "is_staff", "is_active")
    list_filter = ("is_staff", "is_superuser", "is_active", "groups")
    ordering = ("email",)
    search_fields = ("email", "first_name", "last_name")

    fieldsets = (
        (None, {"fields": ("email", "password")}),
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
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": (
                    "email",
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
        "parent",
        "display_vote_total",
    )
    list_filter = ("created_at", "implemented_at", "parent")
    search_fields = ("title", "description", "creator__email")
    autocomplete_fields = ("creator", "parent")
    ordering = ("-created_at",)

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
