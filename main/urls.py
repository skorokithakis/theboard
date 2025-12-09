"""The main application's URLs."""

from django.urls import path

from . import views

app_name = "main"
urlpatterns = [
    path("", views.index, name="index"),
    path("invest/web5/", views.web5_invest, name="web5-invest"),
    path(
        "features/<int:pk>/vote/",
        views.feature_vote_toggle,
        name="feature-vote-toggle",
    ),
    path("about/", views.about, name="about"),
    path("graveyard/", views.graveyard, name="graveyard"),
    path(
        "plaintext-submission/",
        views.plaintext_submission,
        name="plaintext-submission",
    ),
    path(
        "plaintext-submission/features/<int:pk>/vote/",
        views.plaintext_vote_toggle,
        name="plaintext-vote-toggle",
    ),
    path("archive/", views.archive_index, name="archive-index"),
    path("archive/about/", views.archive_about, name="archive-about"),
    path("archive/scoreboard/", views.archive_scoreboard, name="archive-scoreboard"),
    path("scoreboard/", views.scoreboard, name="scoreboard"),
    path(
        "fortunes/suggest/",
        views.submit_quote_suggestion,
        name="fortune-suggest",
    ),
    path("profile/", views.profile_detail, name="profile"),
    path("profiles/<str:username>/", views.profile_detail, name="profile-detail"),
]
