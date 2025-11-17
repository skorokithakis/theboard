"""Forms used throughout the main application."""

from __future__ import annotations

from django import forms
from django.contrib.auth import password_validation
from django.utils.translation import gettext_lazy as _

from . import models


class FeatureForm(forms.ModelForm):
    """Form for creating feature requests or variations."""

    class Meta:
        model = models.Feature
        fields = ["title", "description", "parent"]
        widgets = {
            "title": forms.TextInput(
                attrs={
                    "placeholder": _("Concise feature title"),
                    "class": "input",
                }
            ),
            "description": forms.Textarea(
                attrs={
                    "rows": 6,
                    "placeholder": _("Describe the problem and desired outcome."),
                    "class": "textarea",
                }
            ),
            "parent": forms.Select(attrs={"class": "select"}),
        }

    def __init__(self, *args, allow_parent: bool = True, **kwargs):
        super().__init__(*args, **kwargs)
        if not allow_parent:
            self.fields.pop("parent")
        else:
            self.fields["parent"].required = False
            self.fields["parent"].label = _("Variation of")
            self.fields["parent"].help_text = _(
                "Select a parent feature if this submission is a variation."
            )
            self.fields["parent"].queryset = models.Feature.objects.select_related(
                "creator"
            ).order_by("title")


class QuoteSuggestionForm(forms.ModelForm):
    """Form for capturing community quotes for the homepage fortune slot."""

    class Meta:
        model = models.QuoteSuggestion
        fields = ["text", "attribution"]
        labels = {
            "text": _("Quote"),
            "attribution": _("Attribution"),
        }
        error_messages = {
            "text": {"required": _("Please provide the quote text.")},
            "attribution": {"required": _("Let readers know who to credit.")},
        }
        widgets = {
            "text": forms.Textarea(
                attrs={
                    "rows": 3,
                    "placeholder": _("Share an uplifting, witty, or inspiring quote."),
                    "class": "textarea",
                }
            ),
            "attribution": forms.TextInput(
                attrs={
                    "placeholder": _("Who said this?"),
                    "class": "input",
                }
            ),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def clean_text(self) -> str:
        text = (self.cleaned_data.get("text") or "").strip()
        if not text:
            raise forms.ValidationError(_("Please provide the quote text."))
        return text

    def clean_attribution(self) -> str:
        attribution = (self.cleaned_data.get("attribution") or "").strip()
        if not attribution:
            raise forms.ValidationError(_("Let readers know who to credit."))
        return attribution


class SignUpForm(forms.ModelForm):
    """Registration form that captures username and password."""

    password1 = forms.CharField(
        label=_("Password"),
        strip=False,
        widget=forms.PasswordInput(
            attrs={
                "placeholder": _("Choose a password"),
                "autocomplete": "new-password",
            }
        ),
    )
    password2 = forms.CharField(
        label=_("Password confirmation"),
        strip=False,
        widget=forms.PasswordInput(
            attrs={
                "placeholder": _("Re-enter your password"),
                "autocomplete": "new-password",
            }
        ),
    )

    class Meta:
        model = models.User
        fields = ("username",)
        widgets = {
            "username": forms.TextInput(
                attrs={
                    "placeholder": _("Username"),
                    "autocomplete": "username",
                }
            )
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            existing_classes = field.widget.attrs.get("class", "")
            field.widget.attrs["class"] = (existing_classes + " input").strip()

    def clean_username(self) -> str:
        username = (self.cleaned_data.get("username") or "").strip()
        if not username:
            raise forms.ValidationError(_("Please choose a username."))
        return username

    def clean_password2(self) -> str:
        password1 = self.cleaned_data.get("password1")
        password2 = self.cleaned_data.get("password2")
        if not password2:
            raise forms.ValidationError(_("Please confirm your password."))
        if password1 and password1 != password2:
            raise forms.ValidationError(_("The two password fields didn't match."))
        password_validation.validate_password(password2, self.instance)
        return password2

    def save(self, commit: bool = True) -> models.User:
        user = super().save(commit=False)
        user.set_password(self.cleaned_data["password1"])
        if commit:
            user.save()
        return user
