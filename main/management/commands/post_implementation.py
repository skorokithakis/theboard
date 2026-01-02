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
        parser.add_argument(
            "--commit-url",
            dest="commit_url",
            help="Optional GitHub commit or diff URL associated with this implementation",
        )
        parser.add_argument(
            "--failure-notes",
            dest="failure_notes",
            help="Optional diagnostic notes explaining why the implementation failed",
        )

    def handle(self, *args, **options) -> None:
        feature_id = options["feature_id"]
        failed = options["failed"]
        commit_url = (options.get("commit_url") or "").strip()
        failure_notes = (options.get("failure_notes") or "").strip()

        try:
            feature = Feature.objects.get(id=feature_id)
        except Feature.DoesNotExist:
            raise CommandError(f"Feature with ID {feature_id} does not exist")

        feature_title = feature.title
        desired_state = (
            Feature.ImplementationState.UNSUCCESSFUL
            if failed
            else Feature.ImplementationState.SUCCESSFUL
        )
        now = timezone.now()
        if failed and not failure_notes:
            failure_notes = (
                f"Marked unsuccessful via post_implementation at {now.isoformat()}."
            )
        if feature.implemented_at is not None:
            updates = feature.apply_implementation_outcome(
                implementation_state=desired_state,
                failure_notes=failure_notes if failed else "",
                commit_url=commit_url or None,
                persist=True,
            )
            if updates:
                self.stdout.write(
                    self.style.WARNING(
                        f'Updated implementation metadata for "{feature_title}" (ID: {feature_id}): '
                        f"{', '.join(updates)}"
                    )
                )
            else:
                self.stdout.write(
                    self.style.WARNING(
                        f'Feature "{feature_title}" (ID: {feature_id}) was already marked as '
                        f"{feature.get_implemented_state_display().lower()} with the same details."
                    )
                )
            self.stdout.write(
                self.style.WARNING(
                    "Votes and variation clean-up were skipped because the feature was already shipped."
                )
            )
            return

        feature.implement(
            when=now,
            commit_url=commit_url or None,
            implementation_state=desired_state,
            failure_notes=failure_notes,
        )
        feature.refresh_from_db(
            fields=[
                "e2e_test_reference",
                "e2e_tests_last_synced_at",
                "implemented_at",
            ]
        )

        self._penalize_inactive_features()

        # Clear vote records for the implemented feature but leave pending votes intact
        deleted_count, _ = Vote.objects.filter(feature=feature).delete()

        self.stdout.write(
            self.style.SUCCESS(
                f'Successfully marked feature "{feature_title}" (ID: {feature_id}) as '
                f"{'failed' if failed else 'implemented'} at {now.isoformat()}"
            )
        )
        self.stdout.write(
            self.style.SUCCESS(
                "End-to-end coverage noted at "
                f"{feature.e2e_tests_last_synced_at.isoformat()} "
                f"via {feature.e2e_test_reference}"
            )
        )
        if deleted_count > 0:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Archived {deleted_count} vote(s) for the implemented feature"
                )
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
