"""The main application's URLs."""

from django.urls import path

from . import views

app_name = "main"
urlpatterns = [
    path("", views.index, name="index"),
    path("the-board/", views.board_self, name="board-self"),
    path("features/", views.feature_board, name="feature-board"),
    path(
        "features/implemented/",
        views.implemented_features,
        name="implemented-features",
    ),
    path("invest/web5/", views.web5_invest, name="web5-invest"),
    path("web5/", views.web5, name="web5"),
    path("arcade/", views.arcade, name="arcade"),
    path("arcade/penguins/", views.penguin_view, name="penguin-view"),
    path(
        "arcade/performance/",
        views.arcade_performance,
        name="arcade-performance",
    ),
    path("arcade/glitch/", views.arcade_glitch, name="arcade-glitch"),
    path("arcade/ishmael/", views.arcade_ishmael, name="arcade-ishmael"),
    path("arcade/terrarium/", views.arcade_terrarium, name="arcade-terrarium"),
    path("arcade/quotes/", views.arcade_quotes, name="arcade-quotes"),
    path("arcade/buddy/", views.arcade_buddy, name="arcade-buddy"),
    path(
        "features/<int:pk>/vote/",
        views.feature_vote_toggle,
        name="feature-vote-toggle",
    ),
    path("about/", views.about, name="about"),
    path(
        "journal/2025-retrospective/",
        views.retrospective_2025,
        name="retrospective-2025",
    ),
    path("sitemap/", views.sitemap, name="sitemap"),
    path("sitemap/plaintext/", views.plaintext_sitemap, name="plaintext-sitemap"),
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
    path(
        "navigation/preferences/",
        views.update_navigation_preferences,
        name="navigation-preferences",
    ),
    path("profile/", views.profile_detail, name="profile"),
    path("profiles/<str:username>/", views.profile_detail, name="profile-detail"),
]
