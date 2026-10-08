from django.conf import settings
from django.contrib import admin
from django.http import HttpResponse
from django.urls import include, path, re_path
from django.views.generic import TemplateView
from rest_framework.routers import DefaultRouter

from core import sync, views, views_io

router = DefaultRouter()
router.register("projects", views.ProjectViewSet, basename="project")
router.register("farmers", views.FarmerViewSet, basename="farmer")
router.register("lands", views.LandParcelViewSet, basename="land")
router.register("ownerships", views.LandOwnershipViewSet, basename="ownership")
router.register("assets", views.AssetViewSet, basename="asset")
router.register("milestones", views.AssetMilestoneViewSet, basename="milestone")
router.register("stages", views.StageDefinitionViewSet, basename="stage")
router.register("agreements", views.AgreementViewSet, basename="agreement")
router.register("crop-assessments", views.CropAssessmentViewSet, basename="crop")
router.register("compensations", views.CompensationViewSet, basename="compensation")
router.register("payments", views.PaymentViewSet, basename="payment")
router.register("documents", views.DocumentViewSet, basename="document")
router.register("users", views.UserViewSet, basename="user")
router.register("audit-logs", views.AuditLogViewSet, basename="audit")
router.register("settings", views.AppSettingViewSet, basename="setting")

api = [
    path("auth/login/", views.login_view),
    path("auth/logout/", views.logout_view),
    path("auth/me/", views.me_view),
    path("auth/change-password/", views.change_password_view),
    path("meta/", views.MetaView.as_view()),
    path("dashboard/", views.DashboardView.as_view()),
    path("map/", views.MapView.as_view()),
    path("kml/import/", views_io.KMLImportView.as_view()),
    path("kml/export/", views_io.KMLExportView.as_view()),
    path("reports/", views_io.ReportListView.as_view()),
    path("reports/<str:name>/", views_io.ReportView.as_view()),
    path("farmers/<uuid:pk>/statement/", views_io.FarmerStatementView.as_view()),
    path("sync/pull/", sync.SyncPullView.as_view()),
    path("sync/push/", sync.SyncPushView.as_view()),
    path("health/", lambda r: HttpResponse("ok")),
    path("", include(router.urls)),
]

urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("api/", include(api)),
]

# Serve the built web admin (single-page app) for every other URL.
if (settings.WEB_DIST_DIR / "index.html").exists():
    urlpatterns.append(re_path(r"^(?!api/|django-admin/|static/).*$", TemplateView.as_view(template_name="index.html")))
