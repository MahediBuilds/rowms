"""File import/export endpoints: KML/KMZ and Excel reports."""
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from . import access, kml, reports, services
from .models import Asset, AssetType, AuditLog, Farmer, LandParcel

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _visible_project(user, project_id):
    if not project_id:
        raise ValidationError({"project": "Select a project."})
    return get_object_or_404(access.visible_projects(user), pk=project_id)


class KMLImportView(APIView):
    parser_classes = [MultiPartParser]

    def post(self, request):
        user = request.user
        if not access.can(user, "asset", "write"):
            raise PermissionDenied("Your role cannot import locations.")
        project = _visible_project(user, request.data.get("project"))
        upload = request.FILES.get("file")
        if not upload:
            raise ValidationError({"file": "Choose a KML or KMZ file."})
        default_type = request.data.get("asset_type") or AssetType.POLE
        if default_type not in AssetType.values:
            raise ValidationError({"asset_type": "Invalid asset type."})
        try:
            raw = kml.read_kml_bytes(upload)
            report = kml.import_kml(project, raw, user, default_type, request.data.get("line_name", ""))
        except ValueError as e:
            raise ValidationError({"file": str(e)})
        except Exception as e:  # malformed XML etc.
            raise ValidationError({"file": f"Could not read this file as KML ({e.__class__.__name__})."})
        services.audit(user, AuditLog.Action.IMPORT, project, {"file": upload.name, **{k: v for k, v in report.items() if k != "skipped"}}, request=request)
        return Response(report)


class KMLExportView(APIView):
    def get(self, request):
        user = request.user
        project = _visible_project(user, request.query_params.get("project"))
        stages = services.active_stages()
        assets = services.assets_with_progress_prefetch(Asset.objects.filter(project=project))
        pairs = [(a, services.asset_progress(a, stages)) for a in assets]
        lands = LandParcel.objects.filter(projects=project)
        body = kml.export_kml(f"{project.code} - {project.name}", pairs, lands, project.route_geojson)
        services.audit(user, AuditLog.Action.EXPORT, project, {"format": "KML"}, request=request)
        resp = HttpResponse(body, content_type="application/vnd.google-earth.kml+xml")
        resp["Content-Disposition"] = f'attachment; filename="{project.code}-locations.kml"'
        return resp


class ReportListView(APIView):
    def get(self, request):
        if not access.can(request.user, "report"):
            raise PermissionDenied()
        can_money = access.can(request.user, "compensation")
        return Response([{"key": k, "title": t} for k, (t, _) in reports.REPORTS.items()
                         if can_money or k not in reports.MONEY_REPORTS])


class ReportView(APIView):
    def get(self, request, name):
        user = request.user
        if name not in reports.REPORTS or not access.can(user, "report"):
            raise PermissionDenied("Report not available for your role.")
        if name in reports.MONEY_REPORTS and not access.can(user, "compensation"):
            raise PermissionDenied("Report not available for your role.")
        project_id = request.query_params.get("project") or None
        if project_id:
            _visible_project(user, project_id)
        data = reports.build_report(name, user, project_id)
        services.audit(user, AuditLog.Action.EXPORT, None, {"report": name, "project": project_id}, request=request,
                       model_name="Report", repr_=reports.REPORTS[name][0])
        resp = HttpResponse(data, content_type=XLSX)
        resp["Content-Disposition"] = f'attachment; filename="{name}-{timezone.localdate():%Y%m%d}.xlsx"'
        return resp


class FarmerStatementView(APIView):
    def get(self, request, pk):
        user = request.user
        if not access.can(user, "report") or not access.can(user, "compensation"):
            raise PermissionDenied("Report not available for your role.")
        farmer = get_object_or_404(access.scope_queryset(user, Farmer.objects.all()), pk=pk)
        data = reports.build_farmer_statement(user, farmer)
        services.audit(user, AuditLog.Action.EXPORT, farmer, {"report": "farmer_statement"}, request=request)
        resp = HttpResponse(data, content_type=XLSX)
        resp["Content-Disposition"] = f'attachment; filename="{farmer.farmer_code}-statement.xlsx"'
        return resp
