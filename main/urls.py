"""The main application's URLs."""

from django.urls import path

from . import views

app_name = "main"
urlpatterns = [
    path("", views.index, name="index"),
    path("about/", views.about, name="about"),
    path(
        "fortunes/suggest/",
        views.submit_quote_suggestion,
        name="fortune-suggest",
    ),
    path("profile/", views.profile_detail, name="profile"),
    path("profiles/<str:username>/", views.profile_detail, name="profile-detail"),
]
