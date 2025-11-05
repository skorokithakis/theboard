"""Management command to create a regular user identified by username."""

from __future__ import annotations

from getpass import getpass

from django.contrib.auth import get_user_model, password_validation
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Create a regular user account that authenticates with a username."

    def add_arguments(self, parser) -> None:
        parser.add_argument("username", help="Unique username for the new account.")
        parser.add_argument(
            "--password",
            dest="password",
            help="Set an initial password. If omitted, you'll be prompted.",
        )
        parser.add_argument(
            "--no-password",
            action="store_true",
            help="Create the user without setting a password.",
        )

    def handle(self, *args, **options) -> None:
        username_input = (options["username"] or "").strip()
        if not username_input:
            raise CommandError("Username cannot be blank.")
        username = username_input.lower()

        password_option = options.get("password")
        no_password = bool(options.get("no_password"))

        if password_option and no_password:
            raise CommandError("Cannot use --password together with --no-password.")

        User = get_user_model()
        if User.objects.filter(username=username).exists():
            raise CommandError(
                f"Username '{username_input}' conflicts with an existing account when lowercased."
            )

        password = None
        if password_option:
            password = password_option
            self._validate_password(password, username)
        elif not no_password:
            password = self._prompt_for_password(username)

        user = User.objects.create_user(username=username, password=password)
        self.stdout.write(
            self.style.SUCCESS(
                f"User '{user.username}' created successfully (id={user.pk})."
            )
        )

    def _prompt_for_password(self, username: str) -> str:
        """Prompt interactively for a password until confirmation succeeds."""
        for _ in range(3):
            first = getpass("Password: ")
            second = getpass("Password (again): ")
            if not first:
                self.stderr.write("Error: password cannot be blank.")
                continue
            if first != second:
                self.stderr.write("Error: passwords did not match.")
                continue
            try:
                self._validate_password(first, username)
            except CommandError as exc:
                self.stderr.write(f"Error: {exc}")
                continue
            return first
        raise CommandError("Password setup failed after 3 attempts.")

    def _validate_password(self, password: str, username: str) -> None:
        """Validate the password using Django's validators."""
        User = get_user_model()
        temp_user = User(username=username.lower())
        try:
            password_validation.validate_password(password, temp_user)
        except ValidationError as exc:
            raise CommandError("; ".join(exc.messages)) from exc
