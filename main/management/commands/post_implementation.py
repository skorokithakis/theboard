"""Management command to mark a feature as implemented."""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.core.management.base import CommandError
from django.utils import timezone

from main.models import Feature, Vote


class Command(BaseCommand):
    """Mark a feature as implemented by setting a timestamp."""

    help = "Mark a feature as implemented"

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "feature_id",
            type=int,
            help="The ID of the feature to mark as implemented",
        )

    def handle(self, *args, **options) -> None:
        feature_id = options["feature_id"]

        try:
            feature = Feature.objects.get(id=feature_id)
        except Feature.DoesNotExist:
            raise CommandError(f"Feature with ID {feature_id} does not exist")

        feature_title = feature.title
        if feature.implemented_at is not None:
            self.stdout.write(
                self.style.WARNING(
                    f'Feature "{feature_title}" (ID: {feature_id}) was already marked as implemented at {feature.implemented_at.isoformat()}'
                )
            )
            return

        now = timezone.now()
        feature.implement(when=now)

        # Clean up votes for all implemented and expired features
        implemented_feature_ids = Feature.objects.filter(
            implemented_at__isnull=False
        ).values_list("id", flat=True)
        expired_feature_ids = Feature.objects.filter(
            expired_at__isnull=False
        ).values_list("id", flat=True)

        deleted_count, _ = Vote.objects.filter(
            feature_id__in=list(implemented_feature_ids) + list(expired_feature_ids)
        ).delete()

        self.stdout.write(
            self.style.SUCCESS(
                f'Successfully marked feature "{feature_title}" (ID: {feature_id}) as implemented at {now.isoformat()}'
            )
        )
        if deleted_count > 0:
            self.stdout.write(
                self.style.SUCCESS(
                    f'Cleaned up {deleted_count} vote(s) from implemented and expired features'
                )
            )
