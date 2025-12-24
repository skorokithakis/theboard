from __future__ import annotations

import factory
from faker import Faker
from django.utils import timezone

from . import models

fake = Faker()

DEFAULT_USER_PASSWORD = "Test-pass-123"


class UserFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = models.User
        django_get_or_create = ("username",)

    username = factory.Sequence(lambda n: f"{fake.user_name()}_{n}")
    first_name = factory.LazyFunction(fake.first_name)
    last_name = factory.LazyFunction(fake.last_name)
    status = factory.LazyFunction(lambda: fake.sentence(nb_words=4).rstrip("."))

    @factory.post_generation
    def password(self, create, extracted, **kwargs):
        password = extracted or DEFAULT_USER_PASSWORD
        self.set_password(password)
        if create:
            self.save(update_fields=["password"])


class FeatureFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = models.Feature

    title = factory.Sequence(lambda n: f"{fake.catch_phrase()} #{n}")
    description = factory.LazyFunction(lambda: fake.paragraph(nb_sentences=3))
    creator = factory.SubFactory(UserFactory)
    parent = None

    class Params:
        implemented = factory.Trait(implemented_at=factory.LazyFunction(timezone.now))
        expired = factory.Trait(expired_at=factory.LazyFunction(timezone.now))


class VoteFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = models.Vote

    user = factory.SubFactory(UserFactory)
    feature = factory.SubFactory(FeatureFactory)


class QuoteSuggestionFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = models.QuoteSuggestion

    text = factory.LazyFunction(lambda: fake.sentence(nb_words=8))
    attribution = factory.LazyFunction(fake.name)
    submitted_by = factory.SubFactory(UserFactory)
    is_approved = False

    class Params:
        approved = factory.Trait(
            is_approved=True,
            approved_at=factory.LazyFunction(timezone.now),
        )


class WebFiveInvestmentFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = models.WebFiveInvestment

    user = factory.SubFactory(UserFactory)
    amount = factory.LazyFunction(lambda: fake.random_int(min=1, max=120))
