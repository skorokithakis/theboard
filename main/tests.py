from __future__ import annotations

from datetime import date, datetime, timedelta, timezone as dt_timezone
from unittest import mock

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.sites.models import Site
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from . import fortune, health, models, turnstile, utils

User = get_user_model()


class FeatureBoardTests(TestCase):
    def setUp(self) -> None:
        site = Site.objects.get_current()
        domain_slug = site.domain.replace(".", "_")
        self.owner = User.objects.create_user(
            username=f"owner_{domain_slug}",
            password="test-pass-1",
        )
        self.other = User.objects.create_user(
            username=f"other_{domain_slug}",
            password="test-pass-2",
        )

    def _submit_feature(self, **kwargs) -> models.Feature:
        data = {
            "title": kwargs.pop("title", "Sample Feature"),
            "description": kwargs.pop("description", "Detailed description."),
            "creator": kwargs.pop("creator", self.owner),
        }
        data.update(kwargs)
        return models.Feature.objects.create(**data)

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

        response = self.client.get("/api/features")
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data["features"], [])
        graveyard_titles = [item["title"] for item in data["graveyard_features"]]
        self.assertIn("Forgotten request", graveyard_titles)

        stale.refresh_from_db()
        self.assertIsNotNone(stale.expired_at)

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

    def test_feature_detail_includes_implemented_feature(self) -> None:
        feature = self._submit_feature(title="Already shipped")
        implemented_at = timezone.now()
        models.Feature.objects.filter(pk=feature.pk).update(
            implemented_at=implemented_at
        )

        self.client.login(username=self.owner.username, password="test-pass-1")

        response = self.client.get(f"/api/features/{feature.pk}")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsNotNone(data["feature"]["implemented_at"])
        self.assertFalse(data["can_submit_variation"])

    def test_feature_detail_marks_expired_feature(self) -> None:
        feature = self._submit_feature(title="Expired idea")
        models.Feature.objects.filter(pk=feature.pk).update(
            created_at=timezone.now() - timedelta(days=10)
        )

        self.client.login(username=self.owner.username, password="test-pass-1")
        response = self.client.get(f"/api/features/{feature.pk}")
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertIsNone(data["feature"]["implemented_at"])
        self.assertIsNotNone(data["feature"]["expired_at"])
        self.assertFalse(data["can_submit_variation"])

    @override_settings(TURNSTILE_ENABLED=True)
    def test_vote_toggle_adds_and_removes_vote(self) -> None:
        feature = self._submit_feature()
        self.client.login(username=self.owner.username, password="test-pass-1")

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
        self.client.login(username=self.owner.username, password="test-pass-1")

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
        self.client.login(username=self.owner.username, password="test-pass-1")

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
        self.client.login(username=self.owner.username, password="test-pass-1")

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
        self.client.login(username=self.owner.username, password="test-pass-1")
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
        self.client.login(username=self.owner.username, password="test-pass-1")

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
        self.client.login(username=self.owner.username, password="test-pass-1")

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

    def test_post_implementation_command_marks_timestamp_and_clears_all_votes(
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
        # ALL votes should be deleted (including for pending features)
        self.assertFalse(
            models.Vote.objects.filter(user=self.owner, feature=feature).exists()
        )
        self.assertFalse(
            models.Vote.objects.filter(user=self.other, feature=other_feature).exists()
        )
        self.assertEqual(models.Vote.objects.count(), 0)

    def test_post_implementation_command_marks_unsuccessful_state(self) -> None:
        feature = self._submit_feature()

        call_command("post_implementation", str(feature.pk), failed=True)

        feature.refresh_from_db()
        self.assertEqual(
            feature.implemented_state,
            models.Feature.ImplementationState.UNSUCCESSFUL,
        )
        self.assertIsNotNone(feature.implemented_at)

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
        self.client.login(username=self.owner.username, password="test-pass-1")

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
        self.client.login(username=self.owner.username, password="test-pass-1")

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
        self.client.login(username=self.owner.username, password="test-pass-1")

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

        self.client.login(username=self.owner.username, password="test-pass-1")
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

    def test_reports_list_renders_report_cards(self) -> None:
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
            response = self.client.get("/reports/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Implementation Report Blog")
        self.assertContains(response, "Read the report")

    def test_report_detail_displays_sections(self) -> None:
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
            response = self.client.get("/reports/implementation-report-blog/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Framing the requirement")
        self.assertContains(response, "Highlights")

    def test_report_detail_returns_404_for_unknown_slug(self) -> None:
        response = self.client.get("/reports/nope/")
        self.assertEqual(response.status_code, 404)


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
        self.assertIn(context_fortune, fortune.FORTUNE_COOKIES)


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
        self.user = User.objects.create_user(username="health", password="test-pass")

    def _create_failed_feature(self, title: str) -> models.Feature:
        feature = models.Feature.objects.create(
            title=title,
            description="Doomed idea",
            creator=self.user,
        )
        models.Feature.objects.filter(pk=feature.pk).update(
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
