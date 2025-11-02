from __future__ import annotations

from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.contrib.sites.models import Site
from django.test import TestCase, override_settings
from django.utils import timezone

from . import models, turnstile

User = get_user_model()


class FeatureBoardTests(TestCase):
    def setUp(self) -> None:
        site = Site.objects.get_current()
        self.owner = User.objects.create_user(
            email=f"owner@{site.domain}",
            password="test-pass-1",
        )
        self.other = User.objects.create_user(
            email=f"other@{site.domain}",
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

    def test_feature_list_orders_by_vote_total(self) -> None:
        low = self._submit_feature(title="Low votes")
        top = self._submit_feature(title="Top votes", description="More detail")
        models.Vote.objects.create(user=self.owner, feature=top)
        models.Vote.objects.create(user=self.other, feature=top)
        models.Vote.objects.create(user=self.other, feature=low)

        response = self.client.get("/api/features")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        features = data["features"]
        self.assertEqual(features[0]["title"], "Top votes")
        self.assertEqual(features[0]["vote_total"], 2)

    @override_settings(TURNSTILE_ENABLED=True)
    def test_vote_toggle_adds_and_removes_vote(self) -> None:
        feature = self._submit_feature()
        site = Site.objects.get_current()
        self.client.login(email=f"owner@{site.domain}", password="test-pass-1")

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
        site = Site.objects.get_current()
        self.client.login(email=f"owner@{site.domain}", password="test-pass-1")

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
        site = Site.objects.get_current()
        self.client.login(email=f"owner@{site.domain}", password="test-pass-1")

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

    def test_daily_limit_blocks_second_submission(self) -> None:
        site = Site.objects.get_current()
        self.client.login(email=f"owner@{site.domain}", password="test-pass-1")
        self._submit_feature()

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
        site = Site.objects.get_current()
        self.client.login(email=f"owner@{site.domain}", password="test-pass-1")

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
        site = Site.objects.get_current()
        self.client.login(email=f"owner@{site.domain}", password="test-pass-1")

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

    def test_delete_feature_clears_parent_for_children(self) -> None:
        parent = self._submit_feature()
        child = self._submit_feature(title="Variation", parent=parent)

        site = Site.objects.get_current()
        self.client.login(email=f"owner@{site.domain}", password="test-pass-1")
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
        superuser = User.objects.create_superuser(
            email=f"admin@{site.domain}", password="admin-pass"
        )
        self.client.login(email=superuser.email, password="admin-pass")

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

    def test_healthz_endpoint_reports_ok(self) -> None:
        response = self.client.get("/healthz/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("database"), "ok")
        self.assertIn("cache", payload)
