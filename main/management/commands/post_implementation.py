"""Management command to mark a feature as implemented."""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count, F
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
        parser.add_argument(
            "--failed",
            action="store_true",
            dest="failed",
            help="Mark the implementation as unsuccessful",
        )

    def handle(self, *args, **options) -> None:
        feature_id = options["feature_id"]
        failed = options["failed"]

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
        if failed:
            feature.implemented_state = Feature.ImplementationState.UNSUCCESSFUL

        feature.implement(when=now)

        self._penalize_inactive_features()

        # Reset all votes for the next iteration
        deleted_count, _ = Vote.objects.all().delete()

        self.stdout.write(
            self.style.SUCCESS(
                f'Successfully marked feature "{feature_title}" (ID: {feature_id}) as '
                f"{'failed' if failed else 'implemented'} at {now.isoformat()}"
            )
        )
        if deleted_count > 0:
            self.stdout.write(
                self.style.SUCCESS(f"Reset all votes: deleted {deleted_count} vote(s)")
            )

    def _penalize_inactive_features(self) -> None:
        """Shorten the lifespan for pending features that earned zero votes."""
        updated = (
            Feature.objects.pending()
            .annotate(daily_votes=Count("vote_records"))
            .filter(daily_votes=0)
            .update(missed_vote_days=F("missed_vote_days") + 1)
        )
        if updated:
            self.stdout.write(
                self.style.WARNING(
                    f"Penalized {updated} inactive feature(s) for earning zero votes."
                )
            )
