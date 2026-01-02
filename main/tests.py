from __future__ import annotations

import os
import shutil
import tempfile
from datetime import date, datetime, timedelta, timezone as dt_timezone
from contextlib import contextmanager
from unittest import mock

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.sites.models import Site
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from PIL import Image

from . import (
    economy,
    factories,
    fortune,
    generation,
    health,
    models,
    terrarium,
    turnstile,
    utils,
)

User = get_user_model()


@contextmanager
def temporary_media_root():
    """Route media writes to a disposable directory for tests."""
    media_dir = tempfile.mkdtemp(prefix="media-test-")
    try:
        with override_settings(MEDIA_ROOT=media_dir, MEDIA_URL="/media/"):
            yield media_dir
    finally:
        shutil.rmtree(media_dir, ignore_errors=True)


class FeatureBoardTests(TestCase):
    def setUp(self) -> None:
        self.owner = factories.UserFactory()
        self.other = factories.UserFactory()
        self.default_password = factories.DEFAULT_USER_PASSWORD
        User.objects.filter(pk__in=[self.owner.pk, self.other.pk]).update(status="")

    def _static_override(self):
        storage_settings = {
            **settings.STORAGES,
            "staticfiles": {
                "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
            },
        }
        return override_settings(
            STATICFILES_STORAGE="django.contrib.staticfiles.storage.StaticFilesStorage",
            STORAGES=storage_settings,
        )

    def _submit_feature(self, **kwargs) -> models.Feature:
        data = {
            "title": kwargs.pop("title", factories.fake.catch_phrase()),
            "description": kwargs.pop(
                "description", factories.fake.paragraph(nb_sentences=2)
            ),
            "creator": kwargs.pop("creator", self.owner),
        }
        data.update(kwargs)
        return factories.FeatureFactory(**data)

    def _seed_plan_patch(self, plan: generation.GenerationPlan | None = None):
        target_plan = plan or generation.GENERATION_PLANS[0]
        return mock.patch("main.generation.choice", return_value=target_plan)

    def test_create_user_lowercases_username(self) -> None:
        user = User.objects.create_user(username="MiXeDCaSeUser", password="test-pass")
        self.assertEqual(user.username, "mixedcaseuser")

    def test_signup_endpoint_lowercases_username(self) -> None:
        payload = {
            "username": "NewUser",
            "password": "strong-pass-1",
            "password_confirm": "strong-pass-1",
        }
        response = self.client.post(
            "/api/auth/signup",
            payload,
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["user"]["username"], "newuser")
        self.assertTrue(User.objects.filter(username="newuser").exists())
        self.assertIn("balance", data["user"])
        self.assertTrue(data["daily_bonus_awarded"])
        self.assertEqual(data["daily_bonus_amount"], economy.DAILY_LOGIN_BONUS)
        self.assertFalse(data["user"]["daily_bonus_available"])
        self.assertIsNotNone(data["user"]["next_daily_bonus_at"])

    def test_feature_submission_generates_avatar_file(self) -> None:
        self.client.login(username=self.owner.username, password=self.default_password)
        payload = {
            "title": "Avatar-worthy feature",
            "description": "Submitting should render a fresh avatar.",
        }

        with temporary_media_root():
            response = self.client.post(
                "/api/features/create",
                payload,
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 201)

            self.owner.refresh_from_db()
            self.assertTrue(self.owner.avatar.name.endswith(".webp"))
            avatar_path = self.owner.avatar.path
            self.assertTrue(os.path.exists(avatar_path))
            with Image.open(avatar_path) as avatar_image:
                self.assertEqual(avatar_image.size, (256, 256))
                self.assertEqual(avatar_image.format, "WEBP")

    def test_avatar_refreshes_when_feature_ships(self) -> None:
        self.client.login(username=self.owner.username, password=self.default_password)
        payload = {
            "title": "Shippable idea",
            "description": "Getting this implemented should refresh the avatar.",
        }

        with temporary_media_root():
            response = self.client.post(
                "/api/features/create",
                payload,
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 201)
            feature_id = response.json()["feature"]["id"]

            self.owner.refresh_from_db()
            initial_name = self.owner.avatar.name

            feature = models.Feature.objects.get(pk=feature_id)
            feature.implement(when=timezone.now())

            self.owner.refresh_from_db()
            self.assertTrue(self.owner.avatar.name.endswith(".webp"))
            self.assertNotEqual(initial_name, self.owner.avatar.name)
            with Image.open(self.owner.avatar.path) as avatar_image:
                self.assertEqual(avatar_image.format, "WEBP")

    def test_feature_list_orders_by_vote_total(self) -> None:
        low = self._submit_feature(title="Low votes")
        top = self._submit_feature(title="Top votes", description="More detail")
        models.Vote.objects.create(user=self.owner, feature=top)
        models.Vote.objects.create(user=self.other, feature=top)
        models.Vote.objects.create(user=self.other, feature=low)

        response = self.client.get("/api/features")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("next_iteration_at", data)
        self.assertIsNotNone(data["next_iteration_at"])
        features = data["features"]
        self.assertEqual(features[0]["title"], "Top votes")
        self.assertEqual(features[0]["vote_total"], 2)
        self.assertTrue(all(item["implemented_at"] is None for item in features))
        self.assertEqual(data["implemented_features"], [])
        self.assertEqual(data["graveyard_features"], [])

    def test_feature_list_excludes_implemented_features(self) -> None:
        visible = self._submit_feature(title="Visible")
        hidden = self._submit_feature(title="Hidden")
        models.Feature.objects.filter(pk=hidden.pk).update(
            implemented_at=timezone.now()
        )

        response = self.client.get("/api/features")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        titles = [item["title"] for item in data["features"]]
        self.assertIn(visible.title, titles)
        self.assertNotIn(hidden.title, titles)
        implemented_titles = [item["title"] for item in data["implemented_features"]]
        self.assertIn(hidden.title, implemented_titles)
        self.assertEqual(data["graveyard_features"], [])

    def test_feature_list_returns_implemented_chronologically(self) -> None:
        first = self._submit_feature(title="First done")
        later = self._submit_feature(title="Later done")
        now = timezone.now()
        models.Feature.objects.filter(pk=first.pk).update(
            implemented_at=now - timedelta(days=1)
        )
        models.Feature.objects.filter(pk=later.pk).update(
            implemented_at=now + timedelta(hours=1)
        )

        response = self.client.get("/api/features")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        implemented_titles = [item["title"] for item in data["implemented_features"]]
        self.assertEqual(implemented_titles, ["Later done", "First done"])
        self.assertEqual(data["graveyard_features"], [])

    def test_feature_list_moves_stale_features_to_graveyard(self) -> None:
        stale = self._submit_feature(title="Forgotten request")
        models.Feature.objects.filter(pk=stale.pk).update(
            created_at=timezone.now() - timedelta(days=8)
        )

        seed_plan = generation.GENERATION_PLANS[0]
        with self._seed_plan_patch(seed_plan):
            response = self.client.get("/api/features")
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data["features"][0]["title"], seed_plan.title)
        graveyard_titles = [item["title"] for item in data["graveyard_features"]]
        self.assertIn("Forgotten request", graveyard_titles)

        stale.refresh_from_db()
        self.assertIsNotNone(stale.expired_at)

    def test_feature_list_seeds_generation_plan_when_empty(self) -> None:
        seed_plan = generation.GENERATION_PLANS[0]
        with self._seed_plan_patch(seed_plan):
            response = self.client.get("/api/features")
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(
            data["features"][0]["title"],
            seed_plan.title,
        )
        self.assertEqual(
            data["features"][0]["creator"]["username"],
            generation.SYSTEM_USERNAME,
        )

    def test_generation_seed_uses_random_plan_picker(self) -> None:
        selected_plan = generation.GENERATION_PLANS[2]
        feature = generation.ensure_generation_seed(
            plan_picker=lambda plans: selected_plan
        )
        self.assertIsNotNone(feature)
        assert feature is not None
        self.assertEqual(feature.title, selected_plan.title)
        self.assertIn(selected_plan.ritual, feature.description)
        self.assertEqual(generation.current_generation_plan(), selected_plan)

    def test_generation_seed_remixes_archived_feature(self) -> None:
        fossil = self._submit_feature(
            title="Dusty backlog shard",
            description="A forgotten request waiting for neon paint.",
        )
        models.Feature.objects.filter(pk=fossil.pk).update(
            expired_at=timezone.now() - timedelta(days=9),
            votes=7,
        )

        archaeology_plan = next(
            plan
            for plan in generation.GENERATION_PLANS
            if plan.title == generation.ARCHAEOLOGY_PLAN_TITLE
        )
        with self._seed_plan_patch(archaeology_plan):
            feature = generation.ensure_generation_seed()

        self.assertIsNotNone(feature)
        assert feature is not None
        self.assertEqual(feature.creator.username, generation.SYSTEM_USERNAME)
        self.assertEqual(feature.parent_id, fossil.pk)
        self.assertIn("neon", feature.description.lower())
        self.assertIn(fossil.title, feature.description)
        self.assertTrue(feature.title.startswith("Neon revival"))

    def test_interdimensional_plan_imports_portal_feature(self) -> None:
        portal_entry = generation.ParallelBacklogEntry(
            title="Waveform interface treaty",
            description="An oscillating UI pattern that keeps reshaping itself based on cross-universe feedback.",
            origin="Amplitude Annex",
        )
        portal_plan = next(
            plan
            for plan in generation.GENERATION_PLANS
            if plan.title == generation.INTERDIMENSIONAL_PLAN_TITLE
        )
        with (
            self._seed_plan_patch(portal_plan),
            mock.patch(
                "main.generation._select_penpal_transmission",
                return_value=portal_entry,
            ),
        ):
            feature = generation.ensure_generation_seed()

        self.assertIsNotNone(feature)
        assert feature is not None
        self.assertEqual(feature.title, portal_entry.title)
        self.assertIn(portal_entry.origin, feature.description)
        self.assertIn(portal_plan.ritual, feature.description)
        self.assertEqual(feature.creator.username, generation.SYSTEM_USERNAME)

    def test_expire_stale_respects_missed_vote_penalties(self) -> None:
        feature = self._submit_feature(title="Needs daily love")
        now = timezone.now()
        models.Feature.objects.filter(pk=feature.pk).update(
            created_at=now - timedelta(days=4),
            missed_vote_days=3,
        )

        expired_ids = models.Feature.expire_stale(reference=now)

        self.assertIn(feature.pk, expired_ids)
        feature.refresh_from_db()
        self.assertIsNotNone(feature.expired_at)

    def test_expire_stale_bulk_updates_with_annotated_votes(self) -> None:
        now = timezone.now()
        first = self._submit_feature(title="Archive me")
        second = self._submit_feature(title="Archive me too")
        models.Vote.objects.create(user=self.owner, feature=first)
        models.Vote.objects.create(user=self.owner, feature=second)
        models.Vote.objects.create(user=self.other, feature=second)
        models.Feature.objects.filter(pk__in=[first.pk, second.pk]).update(
            created_at=now - timedelta(days=8)
        )

        with self.assertNumQueries(3):
            expired_ids = models.Feature.expire_stale(reference=now)

        self.assertCountEqual(expired_ids, [first.pk, second.pk])
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.votes, 1)
        self.assertEqual(second.votes, 2)
        self.assertIsNotNone(first.expired_at)
        self.assertIsNotNone(second.expired_at)

    def test_expire_stale_deletes_live_vote_records(self) -> None:
        now = timezone.now()
        feature = self._submit_feature(title="Send to graveyard")
        models.Vote.objects.create(user=self.owner, feature=feature)
        models.Vote.objects.create(user=self.other, feature=feature)
        models.Feature.objects.filter(pk=feature.pk).update(
            created_at=now - timedelta(days=8)
        )

        expired_ids = models.Feature.expire_stale(reference=now)

        self.assertIn(feature.pk, expired_ids)
        self.assertFalse(models.Vote.objects.filter(feature=feature).exists())
        feature.refresh_from_db()
        self.assertEqual(feature.votes, 2)
        self.assertIsNotNone(feature.expired_at)

    def test_feature_detail_includes_implemented_feature(self) -> None:
        feature = self._submit_feature(title="Already shipped")
        implemented_at = timezone.now()
        commit_url = "https://github.com/skorokithakis/theboard/commit/abcdef123456"
        models.Feature.objects.filter(pk=feature.pk).update(
            implemented_at=implemented_at,
            implementation_commit_url=commit_url,
        )

        self.client.login(username=self.owner.username, password=self.default_password)

        response = self.client.get(f"/api/features/{feature.pk}")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsNotNone(data["feature"]["implemented_at"])
        self.assertFalse(data["can_submit_variation"])
        self.assertEqual(data["feature"]["implementation_commit_url"], commit_url)

    def test_feature_detail_marks_expired_feature(self) -> None:
        feature = self._submit_feature(title="Expired idea")
        models.Feature.objects.filter(pk=feature.pk).update(
            created_at=timezone.now() - timedelta(days=10)
        )

        self.client.login(username=self.owner.username, password=self.default_password)
        response = self.client.get(f"/api/features/{feature.pk}")
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertIsNone(data["feature"]["implemented_at"])
        self.assertIsNotNone(data["feature"]["expired_at"])
        self.assertFalse(data["can_submit_variation"])

    def test_implemented_features_page_lists_recent_ships(self) -> None:
        earlier = self._submit_feature(title="First finished")
        later = self._submit_feature(title="Second finished")
        now = timezone.now()
        models.Feature.objects.filter(pk=earlier.pk).update(
            implemented_at=now - timedelta(days=1)
        )
        models.Feature.objects.filter(pk=later.pk).update(implemented_at=now)

        with self._static_override():
            response = self.client.get(reverse("main:implemented-features"))

        self.assertEqual(response.status_code, 200)
        features = list(response.context["implemented_features"])
        self.assertEqual(
            [feature.title for feature in features],
            ["Second finished", "First finished"],
        )

    def test_implemented_features_search_matches_user_and_content(self) -> None:
        owned = self._submit_feature(
            title="Search me",
            description="Detailed search fodder",
            creator=self.owner,
        )
        other = self._submit_feature(
            title="Different thread",
            description="Completely unrelated topic",
            creator=self.other,
        )
        now = timezone.now()
        models.Feature.objects.filter(pk__in=[owned.pk, other.pk]).update(
            implemented_at=now
        )

        with self._static_override():
            username_response = self.client.get(
                reverse("main:implemented-features"), {"q": self.owner.username}
            )
            self.assertEqual(username_response.status_code, 200)
            username_features = list(username_response.context["implemented_features"])
            self.assertIn(owned, username_features)
            self.assertNotIn(other, username_features)

            content_response = self.client.get(
                reverse("main:implemented-features"), {"q": "unrelated"}
            )
            self.assertEqual(content_response.status_code, 200)
            content_features = list(content_response.context["implemented_features"])
            self.assertIn(other, content_features)
            self.assertNotIn(owned, content_features)

    @override_settings(TURNSTILE_ENABLED=True)
    def test_vote_toggle_adds_and_removes_vote(self) -> None:
        feature = self._submit_feature()
        self.client.login(username=self.owner.username, password=self.default_password)

        vote_url = f"/api/features/{feature.pk}/vote"
        with mock.patch("main.api.turnstile.verify") as verify_mock:
            verify_mock.return_value = turnstile.VerificationResult(
                success=True,
                error_codes=(),
            )
            response = self.client.post(
                vote_url,
                {"turnstile_token": "token-add"},
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 200)
            self.assertTrue(
                models.Vote.objects.filter(user=self.owner, feature=feature).exists()
            )
            verify_mock.return_value = turnstile.VerificationResult(
                success=True,
                error_codes=(),
            )
            response = self.client.post(
                vote_url,
                {"turnstile_token": "token-remove"},
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 200)
            self.assertFalse(
                models.Vote.objects.filter(user=self.owner, feature=feature).exists()
            )

        self.assertEqual(
            [call.args[0] for call in verify_mock.call_args_list],
            ["token-add", "token-remove"],
        )

    @override_settings(TURNSTILE_ENABLED=True)
    def test_vote_toggle_requires_successful_turnstile(self) -> None:
        feature = self._submit_feature()
        self.client.login(username=self.owner.username, password=self.default_password)

        vote_url = f"/api/features/{feature.pk}/vote"
        with mock.patch("main.api.turnstile.verify") as verify_mock:
            verify_mock.return_value = turnstile.VerificationResult(
                success=False,
                error_codes=("invalid-input-response",),
            )
            response = self.client.post(
                vote_url,
                {"turnstile_token": "bad-token"},
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 400)
        data = response.json()
        self.assertIn("Verification failed", data["error"])
        self.assertFalse(
            models.Vote.objects.filter(user=self.owner, feature=feature).exists()
        )

    def test_vote_toggle_skips_turnstile_when_disabled(self) -> None:
        feature = self._submit_feature()
        self.client.login(username=self.owner.username, password=self.default_password)

        vote_url = f"/api/features/{feature.pk}/vote"
        with (
            mock.patch("main.api.turnstile.verify") as verify_mock,
            mock.patch("main.api.turnstile.is_enabled", return_value=False),
        ):
            response = self.client.post(
                vote_url,
                {},
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(verify_mock.called)
        self.assertTrue(
            models.Vote.objects.filter(user=self.owner, feature=feature).exists()
        )

    def test_vote_toggle_rejects_expired_feature(self) -> None:
        feature = self._submit_feature()
        models.Feature.objects.filter(pk=feature.pk).update(
            created_at=timezone.now() - timedelta(days=8)
        )
        self.client.login(username=self.owner.username, password=self.default_password)

        vote_url = f"/api/features/{feature.pk}/vote"
        response = self.client.post(
            vote_url,
            {},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        data = response.json()
        self.assertIn("retired", data["error"].lower())
        feature.refresh_from_db()
        self.assertIsNotNone(feature.expired_at)

    def test_daily_limit_blocks_fourth_submission(self) -> None:
        self.client.login(username=self.owner.username, password=self.default_password)
        for index in range(3):
            self._submit_feature(title=f"Existing request {index + 1}")

        create_url = "/api/features/create"
        response = self.client.post(
            create_url,
            {"title": "Another", "description": "Should fail"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        data = response.json()
        self.assertIn("limit", data["error"].lower())

    def test_daily_limit_resets_next_day(self) -> None:
        feature = self._submit_feature()
        models.Feature.objects.filter(pk=feature.pk).update(
            created_at=timezone.now() - timedelta(days=1, minutes=1)
        )
        can_submit = not models.Feature.user_has_reached_daily_limit(self.owner)
        self.assertTrue(can_submit)

    def test_feature_create_auto_votes_for_creator(self) -> None:
        self.client.login(username=self.owner.username, password=self.default_password)

        response = self.client.post(
            "/api/features/create",
            {"title": "Auto vote", "description": "Adds vote automatically"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)

        payload = response.json()
        feature_id = payload["feature"]["id"]
        self.assertTrue(payload["feature"]["user_has_voted"])
        self.assertEqual(payload["feature"]["vote_total"], 1)

        feature = models.Feature.objects.get(pk=feature_id)
        self.assertTrue(
            models.Vote.objects.filter(user=self.owner, feature=feature).exists()
        )

    def test_feature_create_auto_votes_for_variation(self) -> None:
        parent = self._submit_feature(creator=self.other)
        self.client.login(username=self.owner.username, password=self.default_password)

        response = self.client.post(
            "/api/features/create",
            {
                "title": "Variation",
                "description": "Variation with automatic vote",
                "parent_id": parent.pk,
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)

        payload = response.json()
        feature_id = payload["feature"]["id"]
        self.assertTrue(payload["feature"]["user_has_voted"])
        self.assertEqual(payload["feature"]["vote_total"], 1)
        self.assertEqual(payload["feature"]["parent"]["id"], parent.pk)

        feature = models.Feature.objects.get(pk=feature_id)
        self.assertTrue(
            models.Vote.objects.filter(user=self.owner, feature=feature).exists()
        )

    def test_post_implementation_command_marks_timestamp_and_preserves_pending_votes(
        self,
    ) -> None:
        feature = self._submit_feature()
        other_feature = self._submit_feature(title="Second feature", creator=self.other)
        models.Vote.objects.create(user=self.owner, feature=feature)
        models.Vote.objects.create(user=self.other, feature=other_feature)

        call_command("post_implementation", str(feature.pk))

        feature.refresh_from_db()
        self.assertIsNotNone(feature.implemented_at)
        self.assertEqual(feature.votes, 1)
        self.assertEqual(feature.vote_total, 1)
        self.assertFalse(
            models.Vote.objects.filter(user=self.owner, feature=feature).exists()
        )
        self.assertTrue(
            models.Vote.objects.filter(user=self.other, feature=other_feature).exists()
        )
        self.assertEqual(models.Vote.objects.count(), 1)

    def test_post_implementation_command_marks_unsuccessful_state(self) -> None:
        feature = self._submit_feature()

        call_command("post_implementation", str(feature.pk), failed=True)

        feature.refresh_from_db()
        self.assertEqual(
            feature.implemented_state,
            models.Feature.ImplementationState.UNSUCCESSFUL,
        )
        self.assertIsNotNone(feature.implemented_at)

    def test_post_implementation_command_can_correct_failed_outcome(self) -> None:
        feature = self._submit_feature()
        models.Vote.objects.create(user=self.owner, feature=feature)

        call_command("post_implementation", str(feature.pk), failed=True)

        feature.refresh_from_db()
        self.assertEqual(
            feature.implemented_state,
            models.Feature.ImplementationState.UNSUCCESSFUL,
        )
        self.assertIn("post_implementation", feature.implementation_failure_notes)
        self.assertEqual(feature.votes, 1)

        commit_url = "https://example.com/fixed-success"
        call_command(
            "post_implementation",
            str(feature.pk),
            "--commit-url",
            commit_url,
        )

        feature.refresh_from_db()
        self.assertEqual(
            feature.implemented_state, models.Feature.ImplementationState.SUCCESSFUL
        )
        self.assertEqual(feature.implementation_failure_notes, "")
        self.assertEqual(feature.implementation_commit_url, commit_url)

    def test_post_implementation_command_records_commit_link(self) -> None:
        feature = self._submit_feature(title="Commit-linked ship")
        commit_url = "https://github.com/skorokithakis/theboard/commit/0000000000000000000000000000000000000000"

        call_command(
            "post_implementation",
            str(feature.pk),
            "--commit-url",
            commit_url,
        )

        feature.refresh_from_db()
        self.assertEqual(feature.implementation_commit_url, commit_url)

    def test_vote_total_uses_snapshot_after_votes_cleared(self) -> None:
        feature = self._submit_feature()
        models.Vote.objects.create(user=self.owner, feature=feature)
        models.Vote.objects.create(user=self.other, feature=feature)

        feature.implement()
        models.Vote.objects.filter(feature=feature).delete()

        feature.refresh_from_db()
        self.assertEqual(feature.votes, 2)
        self.assertEqual(feature.vote_total, 2)

    def test_post_implementation_penalizes_features_without_votes(self) -> None:
        implemented = self._submit_feature(title="Winner")
        pending_with_support = self._submit_feature(
            title="Popular idea", creator=self.other
        )
        pending_stale = self._submit_feature(title="Forgotten")

        models.Vote.objects.create(user=self.other, feature=pending_with_support)

        call_command("post_implementation", str(implemented.pk))

        pending_with_support.refresh_from_db()
        pending_stale.refresh_from_db()

        self.assertEqual(pending_with_support.missed_vote_days, 0)
        self.assertEqual(pending_stale.missed_vote_days, 1)

    def test_implement_deletes_variations_cascadingly(self) -> None:
        parent = self._submit_feature()
        child = self._submit_feature(title="Child variation", parent=parent)
        grandchild = self._submit_feature(
            title="Grandchild variation", parent=child, creator=self.other
        )
        models.Vote.objects.create(user=self.owner, feature=child)
        models.Vote.objects.create(user=self.other, feature=grandchild)

        parent.implement()

        self.assertFalse(
            models.Feature.objects.filter(pk__in=[child.pk, grandchild.pk]).exists()
        )
        self.assertFalse(
            models.Vote.objects.filter(feature__in=[child, grandchild]).exists()
        )

    def test_vote_toggle_rejects_implemented_feature(self) -> None:
        feature = self._submit_feature()
        models.Feature.objects.filter(pk=feature.pk).update(
            implemented_at=timezone.now()
        )
        self.client.login(username=self.owner.username, password=self.default_password)

        vote_url = f"/api/features/{feature.pk}/vote"
        response = self.client.post(
            vote_url,
            {},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        data = response.json()
        self.assertIn("implemented", data["error"].lower())
        self.assertFalse(
            models.Vote.objects.filter(user=self.owner, feature=feature).exists()
        )

    def test_variation_creation_blocked_when_parent_implemented(self) -> None:
        parent = self._submit_feature(creator=self.other)
        models.Feature.objects.filter(pk=parent.pk).update(
            implemented_at=timezone.now()
        )
        self.client.login(username=self.owner.username, password=self.default_password)

        response = self.client.post(
            "/api/features/create",
            {
                "title": "Variation attempt",
                "description": "Should be blocked",
                "parent_id": parent.pk,
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        data = response.json()
        self.assertIn("implemented", data["error"].lower())
        self.assertFalse(models.Feature.objects.filter(parent=parent).exists())

    def test_variation_creation_blocked_when_parent_expired(self) -> None:
        parent = self._submit_feature(creator=self.other)
        models.Feature.objects.filter(pk=parent.pk).update(
            created_at=timezone.now() - timedelta(days=9)
        )
        self.client.login(username=self.owner.username, password=self.default_password)

        response = self.client.post(
            "/api/features/create",
            {
                "title": "Expired variation attempt",
                "description": "Should be blocked",
                "parent_id": parent.pk,
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        data = response.json()
        self.assertIn("expired", data["error"].lower())
        parent.refresh_from_db()
        self.assertIsNotNone(parent.expired_at)

    def test_delete_feature_clears_parent_for_children(self) -> None:
        parent = self._submit_feature()
        child = self._submit_feature(title="Variation", parent=parent)

        self.client.login(username=self.owner.username, password=self.default_password)
        response = self.client.post(
            f"/api/features/{parent.pk}/delete",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("deleted", data["message"].lower())

        child.refresh_from_db()
        self.assertIsNone(child.parent)

    def test_superuser_can_delete_any_feature(self) -> None:
        feature = self._submit_feature(creator=self.other)

        site = Site.objects.get_current()
        domain_slug = site.domain.replace(".", "_")
        superuser = User.objects.create_superuser(
            username=f"admin_{domain_slug}", password="admin-pass"
        )
        self.client.login(username=superuser.username, password="admin-pass")

        response = self.client.post(
            f"/api/features/{feature.pk}/delete",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(models.Feature.objects.filter(pk=feature.pk).exists())

    def test_api_top_returns_highest_rated_feature(self) -> None:
        feature_low = self._submit_feature(title="Runner up")
        feature_top = self._submit_feature(title="Favorite idea")
        variation = self._submit_feature(
            title="Polish", parent=feature_top, creator=self.other
        )

        models.Vote.objects.create(user=self.owner, feature=feature_top)
        models.Vote.objects.create(user=self.other, feature=feature_top)
        models.Vote.objects.create(user=self.owner, feature=variation)
        models.Vote.objects.create(user=self.other, feature=feature_low)

        response = self.client.get("/api/top")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["feature"]["id"], feature_top.pk)
        self.assertEqual(payload["feature"]["vote_total"], 2)
        self.assertEqual(payload["feature"]["variation_count"], 1)
        self.assertEqual(payload["variations"][0]["id"], variation.pk)

    def test_api_top_seeds_generation_plan_when_empty(self) -> None:
        seed_plan = generation.GENERATION_PLANS[0]
        with self._seed_plan_patch(seed_plan):
            response = self.client.get("/api/top")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["feature"]["title"], seed_plan.title)
        self.assertEqual(
            payload["feature"]["creator"]["username"], generation.SYSTEM_USERNAME
        )
        self.assertTrue(
            models.Feature.objects.pending().filter(title=seed_plan.title).exists()
        )

    def test_api_top_skips_expired_features(self) -> None:
        active = self._submit_feature(title="Fresh idea")
        stale = self._submit_feature(title="Past its prime")
        models.Vote.objects.create(user=self.owner, feature=active)
        models.Vote.objects.create(user=self.owner, feature=stale)
        models.Vote.objects.create(user=self.other, feature=stale)
        models.Feature.objects.filter(pk=stale.pk).update(
            created_at=timezone.now() - timedelta(days=9)
        )

        response = self.client.get("/api/top")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["feature"]["id"], active.pk)

        stale.refresh_from_db()
        self.assertIsNotNone(stale.expired_at)

    def test_healthz_endpoint_reports_ok(self) -> None:
        response = self.client.get("/healthz/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("database"), "ok")
        self.assertIn("cache", payload)

    def test_post_implementation_allows_missing_write_up(self) -> None:
        feature = self._submit_feature(title="Missing write-up")

        call_command("post_implementation", str(feature.pk))

        feature.refresh_from_db()
        self.assertIsNotNone(feature.implemented_at)

    def test_profile_view_updates_status_for_owner(self) -> None:
        self.client.login(username=self.owner.username, password=self.default_password)
        response = self.client.post(
            reverse("main:profile"),
            {"status": "  shipping cool vibes "},
        )
        self.assertEqual(response.status_code, 302)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.status, "shipping cool vibes")

    def test_profile_detail_shows_status_publicly(self) -> None:
        self.owner.status = "Exploring status pages"
        self.owner.save(update_fields=["status"])

        with self._static_override():
            response = self.client.get(
                reverse("main:profile-detail", args=[self.owner.username])
            )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Exploring status pages")
        self.assertContains(response, self.owner.username)
        self.assertContains(response, "Treasury")

    def test_profile_edit_forbidden_for_other_accounts(self) -> None:
        self.client.login(username=self.other.username, password=self.default_password)
        response = self.client.post(
            reverse("main:profile-detail", args=[self.owner.username]),
            {"status": "Trying to spoof"},
        )
        self.assertEqual(response.status_code, 403)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.status, "")

    def test_profile_detail_lists_quote_submissions_with_status(self) -> None:
        pending = models.QuoteSuggestion.objects.create(
            text="Pending wisdom awaits.",
            attribution="Queue",
            submitted_by=self.owner,
        )
        approved = models.QuoteSuggestion.objects.create(
            text="Approved knowledge flows.",
            attribution="Gatekeeper",
            submitted_by=self.owner,
            is_approved=True,
            approved_at=timezone.now(),
        )

        with self._static_override():
            response = self.client.get(
                reverse("main:profile-detail", args=[self.owner.username])
            )

        self.assertEqual(response.status_code, 200)
        suggestions = response.context["quote_suggestions"]
        self.assertIn(pending, suggestions)
        self.assertIn(approved, suggestions)
        self.assertContains(response, "Pending review")
        self.assertContains(response, "Approved knowledge flows.")

    def test_profile_detail_includes_global_quote_totals(self) -> None:
        models.QuoteSuggestion.objects.create(
            text="Fresh submission.",
            attribution="Submitter",
            submitted_by=self.owner,
        )
        models.QuoteSuggestion.objects.create(
            text="Approved submission.",
            attribution="Reviewer",
            submitted_by=self.other,
            is_approved=True,
            approved_at=timezone.now(),
        )

        with self._static_override():
            response = self.client.get(
                reverse("main:profile-detail", args=[self.owner.username])
            )

        self.assertEqual(response.status_code, 200)
        totals = response.context["quote_totals"]
        self.assertEqual(totals["approved_count"], 1)
        self.assertEqual(totals["pending_count"], 1)
        self.assertContains(response, "Awaiting review")

    def test_profile_detail_lists_feature_submissions_by_state(self) -> None:
        active = self._submit_feature(title="Active spotlight", creator=self.owner)
        shipped = self._submit_feature(title="Rolled out feature", creator=self.owner)
        archived = self._submit_feature(title="Sunset idea", creator=self.owner)

        now = timezone.now()
        models.Feature.objects.filter(pk=shipped.pk).update(implemented_at=now)
        models.Feature.objects.filter(pk=archived.pk).update(expired_at=now)

        self.client.login(username=self.owner.username, password=self.default_password)
        with self._static_override():
            response = self.client.get(reverse("main:profile"))

        self.assertEqual(response.status_code, 200)
        totals = response.context["feature_totals"]
        self.assertEqual(totals["active_count"], 1)
        self.assertEqual(totals["implemented_count"], 1)
        self.assertEqual(totals["rejected_count"], 1)
        self.assertContains(response, active.title)
        self.assertContains(response, shipped.title)
        self.assertContains(response, archived.title)

    def test_profile_detail_marks_admins_with_badge(self) -> None:
        self.owner.is_staff = True
        self.owner.save(update_fields=["is_staff"])
        self.client.login(username=self.owner.username, password=self.default_password)

        with self._static_override():
            response = self.client.get(reverse("main:profile"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Admin")
        self.assertIn("profile_avatar", response.context)

    def test_about_page_reports_feature_counts(self) -> None:
        self._submit_feature(title="Backlog idea")
        shipped = self._submit_feature(title="Shipped idea")
        expired = self._submit_feature(title="Expired idea")
        models.Feature.objects.filter(pk=shipped.pk).update(
            implemented_at=timezone.now()
        )
        models.Feature.objects.filter(pk=expired.pk).update(expired_at=timezone.now())

        with self._static_override():
            response = self.client.get(reverse("main:about"))

        self.assertEqual(response.status_code, 200)
        stats = response.context["feature_stats"]
        self.assertEqual(stats["pending"], 1)
        self.assertEqual(stats["implemented"], 1)
        self.assertEqual(stats["graveyard"], 1)
        self.assertContains(response, "How it works")

    def test_feature_board_seeds_generation_plan_when_queue_empty(self) -> None:
        seed_plan = generation.GENERATION_PLANS[0]
        with self._static_override(), self._seed_plan_patch(seed_plan):
            response = self.client.get(reverse("main:feature-board"))

        self.assertEqual(response.status_code, 200)
        features = response.context["features"]
        self.assertEqual(len(features), 1)
        self.assertEqual(features[0].title, seed_plan.title)
        self.assertTrue(
            models.Feature.objects.pending().filter(title=seed_plan.title).exists()
        )

    def test_seeded_generation_plan_gets_system_vote(self) -> None:
        seed_plan = generation.GENERATION_PLANS[0]
        with self._static_override(), self._seed_plan_patch(seed_plan):
            response = self.client.get(reverse("main:feature-board"))

        self.assertEqual(response.status_code, 200)
        feature = models.Feature.objects.get(title=seed_plan.title)
        self.assertEqual(feature.vote_records.count(), 1)
        self.assertEqual(
            feature.vote_records.first().user.username, generation.SYSTEM_USERNAME
        )
        features = response.context["features"]
        self.assertEqual(features[0].vote_total, 1)

    def test_feature_board_shows_creator_name(self) -> None:
        feature = self._submit_feature(title="Author credited")
        models.Vote.objects.create(user=feature.creator, feature=feature)

        with self._static_override():
            response = self.client.get(reverse("main:feature-board"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, feature.creator.display_name)

    def test_feature_list_includes_creator_status(self) -> None:
        self.owner.status = "API surfaces the vibe"
        self.owner.save(update_fields=["status"])
        feature = self._submit_feature(title="Status aware feature")

        response = self.client.get("/api/features")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["features"][0]["id"], feature.id)
        self.assertEqual(
            payload["features"][0]["creator"]["status"], "API surfaces the vibe"
        )

    def test_login_awards_daily_bonus_once_per_day(self) -> None:
        morning = datetime(2024, 5, 1, 9, 0, tzinfo=dt_timezone.utc)
        with mock.patch("main.economy.timezone.now", return_value=morning):
            response = self.client.post(
                "/api/auth/login",
                {
                    "username": self.owner.username,
                    "password": self.default_password,
                },
                content_type="application/json",
            )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.balance, economy.DAILY_LOGIN_BONUS)
        self.assertTrue(data["daily_bonus_awarded"])
        self.assertEqual(data["user"]["balance"], economy.DAILY_LOGIN_BONUS)
        self.assertEqual(data["daily_bonus_amount"], economy.DAILY_LOGIN_BONUS)
        self.assertIn("web5_invested", data["user"])

        later_same_day = morning + timedelta(hours=3)
        with mock.patch("main.economy.timezone.now", return_value=later_same_day):
            response = self.client.post(
                "/api/auth/login",
                {
                    "username": self.owner.username,
                    "password": self.default_password,
                },
                content_type="application/json",
            )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.balance, economy.DAILY_LOGIN_BONUS)
        self.assertFalse(data["daily_bonus_awarded"])

    def test_web5_investment_view_records_contribution(self) -> None:
        self.owner.balance = 120
        self.owner.last_daily_bonus_at = timezone.now()
        self.owner.save(update_fields=["balance", "last_daily_bonus_at"])
        self.client.login(username=self.owner.username, password=self.default_password)

        with self._static_override():
            response = self.client.post(
                reverse("main:web5-invest"),
                {"amount": 70},
                follow=True,
            )

        self.assertEqual(response.status_code, 200)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.balance, 50)
        self.assertEqual(models.WebFiveInvestment.objects.count(), 1)
        self.assertEqual(
            models.WebFiveInvestment.objects.total_committed(),
            70,
        )

    def test_web5_investment_view_prevents_overspend(self) -> None:
        self.owner.balance = 15
        self.owner.last_daily_bonus_at = timezone.now()
        self.owner.save(update_fields=["balance", "last_daily_bonus_at"])
        self.client.login(username=self.owner.username, password=self.default_password)

        with self._static_override():
            response = self.client.post(
                reverse("main:web5-invest"),
                {"amount": 50},
            )

        self.assertEqual(response.status_code, 400)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.balance, 15)
        self.assertEqual(models.WebFiveInvestment.objects.count(), 0)

    def test_web5_investment_api_endpoint_deducts_balance(self) -> None:
        self.owner.balance = 90
        self.owner.last_daily_bonus_at = timezone.now()
        self.owner.save(update_fields=["balance", "last_daily_bonus_at"])
        self.client.login(username=self.owner.username, password=self.default_password)

        response = self.client.post(
            "/api/web5/invest",
            {"amount": 45},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.balance, 45)
        self.assertEqual(data["user_committed"], 45)
        self.assertEqual(data["total_committed"], 45)

    def test_homepage_exposes_assistant_toggle_and_script(self) -> None:
        with self._static_override():
            response = self.client.get("/")
        self.assertContains(response, 'data-shimeji-balance="0"')
        self.assertContains(response, 'data-shimeji-auth="false"')
        self.assertContains(response, "data-shimeji-master-toggle")
        self.assertContains(response, "js/shimeji.js")

    def test_authenticated_assistant_dataset_reflects_balance(self) -> None:
        self.owner.balance = 42
        self.owner.save(update_fields=["balance"])
        logged_in = self.client.login(
            username=self.owner.username, password=self.default_password
        )
        self.assertTrue(logged_in)

        with self._static_override():
            response = self.client.get("/")
        self.owner.refresh_from_db()
        self.assertContains(
            response,
            f'data-shimeji-balance="{self.owner.balance}"',
        )
        self.assertContains(response, 'data-shimeji-auth="true"')


class DailyFortuneTests(TestCase):
    def test_get_daily_fortune_is_deterministic(self) -> None:
        fortune_one = fortune.get_daily_fortune(date(2024, 12, 1))
        fortune_two = fortune.get_daily_fortune(date(2024, 12, 1))
        self.assertEqual(fortune_one, fortune_two)

    def test_homepage_includes_daily_fortune(self) -> None:
        storage_settings = {
            **settings.STORAGES,
            "staticfiles": {
                "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
            },
        }
        with override_settings(
            STATICFILES_STORAGE="django.contrib.staticfiles.storage.StaticFilesStorage",
            STORAGES=storage_settings,
        ):
            response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        context_fortune = response.context["daily_fortune"]
        self.assertTrue(
            context_fortune in fortune.FORTUNE_COOKIES
            or context_fortune.collection == "Community Submissions"
        )

    def test_get_daily_fortune_includes_approved_suggestions(self) -> None:
        submitter = factories.UserFactory()
        suggestion = factories.QuoteSuggestionFactory(
            text="Community wisdom deserves the spotlight.",
            attribution="Quote Bot",
            submitted_by=submitter,
            is_approved=True,
        )
        with mock.patch.object(fortune, "FORTUNE_COOKIES", ()):
            result = fortune.get_daily_fortune(date(2024, 9, 1))
        self.assertEqual(result.text, suggestion.text)
        self.assertEqual(result.attribution, suggestion.attribution)

    def test_community_fortunes_are_weighted_in_candidate_pool(self) -> None:
        submitter = factories.UserFactory()
        factories.QuoteSuggestionFactory(
            text="Boost community flavor.",
            attribution="Quote Weight",
            submitted_by=submitter,
            is_approved=True,
        )
        built_in = fortune.Fortune(
            text="Base fortune.",
            attribution="Built-in",
            collection="Core",
            package="core-1",
        )
        with mock.patch.object(fortune, "FORTUNE_COOKIES", (built_in,)):
            candidates = fortune._fortune_candidates()

        community_entries = [
            entry for entry in candidates if entry.collection == "Community Submissions"
        ]
        builtin_entries = [
            entry for entry in candidates if entry.collection != "Community Submissions"
        ]

        self.assertEqual(len(builtin_entries), 1)
        self.assertEqual(len(community_entries), fortune.COMMUNITY_FORTUNE_WEIGHT)

    def test_get_daily_fortune_avoids_recent_repeats_when_possible(self) -> None:
        fortune_one = fortune.Fortune(
            text="First pull.",
            attribution="Rotation Test",
            collection="Test",
            package="rotation-1",
        )
        fortune_two = fortune.Fortune(
            text="Second pull.",
            attribution="Rotation Test",
            collection="Test",
            package="rotation-2",
        )

        with mock.patch.object(fortune, "FORTUNE_COOKIES", (fortune_one, fortune_two)):
            result_today = fortune.get_daily_fortune(date(2024, 9, 1))
            result_tomorrow = fortune.get_daily_fortune(date(2024, 9, 2))

        self.assertNotEqual(result_today, result_tomorrow)

    def test_community_fortune_includes_submitter_name(self) -> None:
        submitter = factories.UserFactory(first_name="Quote", last_name="Fan")
        factories.QuoteSuggestionFactory(
            text="Community nod.",
            attribution="Contributor",
            submitted_by=submitter,
            is_approved=True,
        )
        with mock.patch.object(fortune, "FORTUNE_COOKIES", ()):
            result = fortune.get_daily_fortune(date(2024, 10, 1))

        self.assertEqual(result.submitted_by, submitter.display_name)


class QuoteSuggestionViewTests(TestCase):
    def setUp(self) -> None:
        self.user = factories.UserFactory()
        self.password = factories.DEFAULT_USER_PASSWORD

    def _static_override(self):
        storage_settings = {
            **settings.STORAGES,
            "staticfiles": {
                "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
            },
        }
        return override_settings(
            STATICFILES_STORAGE="django.contrib.staticfiles.storage.StaticFilesStorage",
            STORAGES=storage_settings,
        )

    def test_login_required_for_quote_submission(self) -> None:
        response = self.client.post(
            reverse("main:fortune-suggest"),
            {"text": "Hello", "attribution": "Someone"},
        )
        self.assertEqual(response.status_code, 302)
        self.assertTrue(
            response["Location"].startswith(settings.LOGIN_URL),
            msg="Unauthenticated users should be redirected to login.",
        )

    def test_successful_quote_submission_creates_pending_record(self) -> None:
        self.client.login(username=self.user.username, password=self.password)
        with self._static_override():
            response = self.client.post(
                reverse("main:fortune-suggest"),
                {"text": "Ship the fun.", "attribution": "Motivator"},
                follow=True,
            )
        self.assertEqual(response.status_code, 200)
        suggestion = models.QuoteSuggestion.objects.get()
        self.assertFalse(suggestion.is_approved)
        self.assertEqual(suggestion.submitted_by, self.user)
        self.assertContains(response, "We&#x27;ll review your quote")

    def test_invalid_submission_renders_errors(self) -> None:
        self.client.login(username=self.user.username, password=self.password)
        with self._static_override():
            response = self.client.post(
                reverse("main:fortune-suggest"),
                {"text": "", "attribution": ""},
            )
        self.assertEqual(response.status_code, 400)
        self.assertContains(
            response,
            "Please provide the quote text.",
            status_code=400,
        )


class GraveyardViewTests(TestCase):
    def setUp(self) -> None:
        self.owner = factories.UserFactory()

    def _static_override(self):
        storage_settings = {
            **settings.STORAGES,
            "staticfiles": {
                "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
            },
        }
        return override_settings(
            STATICFILES_STORAGE="django.contrib.staticfiles.storage.StaticFilesStorage",
            STORAGES=storage_settings,
        )

    def test_graveyard_page_scales_tombstones_by_votes(self) -> None:
        heavy = factories.FeatureFactory(
            title="Many votes",
            description="Popular but doomed",
            creator=self.owner,
            expired_at=timezone.now(),
            votes=12,
        )
        light = factories.FeatureFactory(
            title="Few votes",
            description="Barely noticed",
            creator=self.owner,
            expired_at=timezone.now(),
            votes=3,
        )

        with self._static_override():
            response = self.client.get(reverse("main:graveyard"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, heavy.title)
        self.assertContains(response, light.title)
        self.assertContains(response, "--tombstone-scale: 1.65")
        self.assertContains(response, "--tombstone-scale: 1.12")
        self.assertEqual(response.context["total_features"], 2)

    def test_graveyard_page_shows_empty_state(self) -> None:
        with self._static_override():
            response = self.client.get(reverse("main:graveyard"))

        self.assertContains(response, "No stones stand yet.")
        self.assertEqual(response.context["total_features"], 0)


class PerformanceSprintViewTests(TestCase):
    def setUp(self) -> None:
        self.user = factories.UserFactory()

    def _static_override(self):
        storage_settings = {
            **settings.STORAGES,
            "staticfiles": {
                "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
            },
        }
        return override_settings(
            STATICFILES_STORAGE="django.contrib.staticfiles.storage.StaticFilesStorage",
            STORAGES=storage_settings,
        )

    def test_performance_sprint_lists_claims_and_subjects(self) -> None:
        feature = factories.FeatureFactory(
            title="Benchmark-ready idea",
            creator=self.user,
        )
        factories.VoteFactory(user=self.user, feature=feature)

        with self._static_override():
            response = self.client.get(reverse("main:arcade-performance"))

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.context["sprint_claims"])
        self.assertIn(feature, response.context["lab_subjects"])
        self.assertContains(response, "Performance sprint for no reason")
        self.assertContains(response, feature.title)


class ScoreboardViewTests(TestCase):
    def setUp(self) -> None:
        self.user = factories.UserFactory()
        self.other = factories.UserFactory()
        self.third = factories.UserFactory()

    def _static_override(self):
        storage_settings = {
            **settings.STORAGES,
            "staticfiles": {
                "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
            },
        }
        return override_settings(
            STATICFILES_STORAGE="django.contrib.staticfiles.storage.StaticFilesStorage",
            STORAGES=storage_settings,
        )

    def test_head_request_returns_ok(self) -> None:
        with self._static_override():
            response = self.client.head(reverse("main:scoreboard"))

        self.assertEqual(response.status_code, 200)

    def test_leaderboard_orders_by_peer_votes(self) -> None:
        feature_primary = factories.FeatureFactory(
            title="Count my votes",
            description="Votes from peers should rank first.",
            creator=self.user,
        )
        feature_secondary = factories.FeatureFactory(
            title="Count other votes",
            description="Ensure order respects totals.",
            creator=self.other,
        )
        factories.VoteFactory(user=self.other, feature=feature_primary)
        factories.VoteFactory(user=self.third, feature=feature_primary)
        factories.VoteFactory(user=self.third, feature=feature_secondary)

        with self._static_override():
            response = self.client.get(reverse("main:scoreboard"))

        self.assertEqual(response.status_code, 200)
        leaderboard = response.context["leaderboard"]
        ordered_usernames = [entry["user"].username for entry in leaderboard]
        self.assertEqual(
            ordered_usernames[:2], [self.user.username, self.other.username]
        )
        self.assertEqual(leaderboard[0]["score"], 2)
        self.assertEqual(leaderboard[1]["score"], 1)

    def test_self_votes_are_not_counted(self) -> None:
        feature = factories.FeatureFactory(
            title="Self vote check",
            description="Ignore creator votes.",
            creator=self.user,
        )
        factories.VoteFactory(user=self.user, feature=feature)
        factories.VoteFactory(user=self.other, feature=feature)

        with self._static_override():
            response = self.client.get(reverse("main:scoreboard"))

        leaderboard = response.context["leaderboard"]
        entry = next(item for item in leaderboard if item["user"] == self.user)
        self.assertEqual(entry["score"], 1)

    def test_historical_votes_use_snapshot_totals(self) -> None:
        feature = factories.FeatureFactory(
            title="Implemented idea",
            description="Snapshot votes should count.",
            creator=self.user,
        )
        factories.VoteFactory(user=self.user, feature=feature)
        factories.VoteFactory(user=self.other, feature=feature)
        feature.implement(when=timezone.now())
        models.Vote.objects.all().delete()

        with self._static_override():
            response = self.client.get(reverse("main:scoreboard"))

        leaderboard = response.context["leaderboard"]
        entry = next(item for item in leaderboard if item["user"] == self.user)
        self.assertEqual(entry["score"], 1)

    def test_boot_receives_bug_bounty_bonus(self) -> None:
        boot = factories.UserFactory(username="boot")
        feature = factories.FeatureFactory(
            title="Boot bonus feature",
            description="Ensure bonus is added.",
            creator=self.other,
        )
        factories.VoteFactory(user=self.user, feature=feature)

        with self._static_override():
            response = self.client.get(reverse("main:scoreboard"))

        leaderboard = response.context["leaderboard"]
        boot_entry = next(item for item in leaderboard if item["user"] == boot)
        self.assertEqual(boot_entry["score"], 500)


class RetrospectiveViewTests(TestCase):
    def setUp(self) -> None:
        self.owner = factories.UserFactory()

    def _static_override(self):
        storage_settings = {
            **settings.STORAGES,
            "staticfiles": {
                "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
            },
        }
        return override_settings(
            STATICFILES_STORAGE="django.contrib.staticfiles.storage.StaticFilesStorage",
            STORAGES=storage_settings,
        )

    def test_retrospective_page_surfaces_front_runner_and_metrics(self) -> None:
        feature = factories.FeatureFactory(
            title="Front runner story",
            description="Retro smoke check",
            creator=self.owner,
        )
        factories.VoteFactory(user=self.owner, feature=feature)

        with self._static_override():
            response = self.client.get(reverse("main:retrospective-2025"))

        self.assertEqual(response.status_code, 200)
        self.assertIn("highlight_metrics", response.context)
        self.assertGreater(
            response.context["quarterly_velocity"][0]["percent"],
            0,
        )
        self.assertContains(response, "end-of-year retrospective")
        self.assertContains(response, feature.title)


class PlaintextSubmissionViewTests(TestCase):
    def setUp(self) -> None:
        self.user = factories.UserFactory(username="plain")
        self.other = factories.UserFactory()
        self.password = factories.DEFAULT_USER_PASSWORD

    def test_plaintext_page_lists_features_and_warning(self) -> None:
        feature = factories.FeatureFactory(
            title="Plain request",
            description="Check rendering",
            creator=self.other,
        )

        response = self.client.get(reverse("main:plaintext-submission"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "no-frills fallback")
        self.assertContains(response, feature.title)

    def test_plaintext_submission_creates_feature_and_vote(self) -> None:
        self.client.login(username=self.user.username, password=self.password)

        response = self.client.post(
            reverse("main:plaintext-submission"),
            {"title": "Text-only form", "description": "Stay simple"},
        )

        self.assertEqual(response.status_code, 302)
        feature = models.Feature.objects.get(title="Text-only form")
        self.assertEqual(feature.creator, self.user)
        self.assertTrue(
            models.Vote.objects.filter(user=self.user, feature=feature).exists()
        )

    @override_settings(TURNSTILE_ENABLED=True)
    def test_plaintext_vote_toggle_uses_turnstile_verification(self) -> None:
        feature = factories.FeatureFactory(
            title="Vote target",
            description="Toggle with captcha",
            creator=self.other,
        )
        self.client.login(username=self.user.username, password=self.password)

        with mock.patch("main.views.turnstile.verify") as verify_mock:
            verify_mock.return_value = turnstile.VerificationResult(
                success=True,
                error_codes=(),
            )
            response = self.client.post(
                reverse("main:plaintext-vote-toggle", args=[feature.pk]),
                {"turnstile_token": "token-add"},
            )

        self.assertEqual(response.status_code, 302)
        verify_mock.assert_called_once()
        self.assertEqual(verify_mock.call_args[0][0], "token-add")
        self.assertTrue(
            models.Vote.objects.filter(user=self.user, feature=feature).exists()
        )


class UtilsTests(TestCase):
    def test_get_next_iteration_at_before_noon_returns_same_day_noon(self) -> None:
        reference = datetime(2024, 5, 1, 9, 30, tzinfo=dt_timezone.utc)
        result = utils.get_next_iteration_at(reference)
        expected = datetime(2024, 5, 1, 12, 0, tzinfo=dt_timezone.utc)
        self.assertEqual(result, expected)

    def test_get_next_iteration_at_after_noon_returns_next_midnight(self) -> None:
        reference = datetime(2024, 5, 1, 18, 0, tzinfo=dt_timezone.utc)
        result = utils.get_next_iteration_at(reference)
        expected = datetime(2024, 5, 2, 0, 0, tzinfo=dt_timezone.utc)
        self.assertEqual(result, expected)


class BoardHealthTests(TestCase):
    def setUp(self) -> None:
        self.user = factories.UserFactory()

    def _create_failed_feature(self, title: str) -> models.Feature:
        feature = factories.FeatureFactory(
            title=title,
            description="Doomed idea",
            creator=self.user,
            implemented_at=timezone.now(),
            implemented_state=models.Feature.ImplementationState.UNSUCCESSFUL,
        )
        return feature

    def test_full_health_without_failures(self) -> None:
        board_health = health.get_board_health()
        self.assertEqual(board_health["percentage"], 100)
        self.assertEqual(board_health["failed_count"], 0)
        self.assertEqual(board_health["state"]["key"], "healthy")

    def test_penalty_applied_per_failed_feature(self) -> None:
        for index in range(3):
            self._create_failed_feature(f"Failure {index}")

        board_health = health.get_board_health()
        self.assertEqual(board_health["percentage"], 70)
        self.assertEqual(board_health["failed_count"], 3)
        self.assertEqual(board_health["state"]["key"], "scratched")

    def test_health_clamped_at_zero(self) -> None:
        for index in range(15):
            self._create_failed_feature(f"Failure {index}")

        board_health = health.get_board_health()
        self.assertEqual(board_health["percentage"], 0)
        self.assertEqual(board_health["state"]["key"], "dead")


class TerrariumStateTests(TestCase):
    def setUp(self) -> None:
        self.user = factories.UserFactory()

    def test_thriving_when_votes_are_fresh(self) -> None:
        feature = factories.FeatureFactory(
            title="Dynamic canopy",
            description="Make the plant react to votes.",
            creator=self.user,
        )
        now = datetime(2024, 5, 1, 12, 0, tzinfo=dt_timezone.utc)
        voters = [factories.UserFactory() for _ in range(3)]
        for offset, voter in enumerate(voters):
            vote = factories.VoteFactory(user=voter, feature=feature)
            models.Vote.objects.filter(pk=vote.pk).update(
                created_at=now - timedelta(hours=1, minutes=offset)
            )

        state = terrarium.build_terrarium_state(reference=now)

        self.assertEqual(state["key"], "thriving")
        self.assertEqual(state["label"], feature.title)
        self.assertIn("Misted", state["water"])

    def test_dormant_when_no_votes_or_backlog(self) -> None:
        now = datetime(2024, 5, 1, 12, 0, tzinfo=dt_timezone.utc)
        state = terrarium.build_terrarium_state(reference=now)

        self.assertEqual(state["key"], "dormant")
        self.assertIn("Dormant", state["label"])
        self.assertIn("no votes", state["water"].lower())
