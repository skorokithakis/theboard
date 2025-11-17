"""The main application's URLs."""

from django.urls import path

from . import views

app_name = "main"
urlpatterns = [
    path("", views.index, name="index"),
    path("reports/", views.report_index, name="reports"),
    path("reports/<slug:slug>/", views.report_detail, name="report-detail"),
    path(
        "fortunes/suggest/",
        views.submit_quote_suggestion,
        name="fortune-suggest",
    ),
]
