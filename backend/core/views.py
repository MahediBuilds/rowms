from collections import Counter as PyCounter
from collections import defaultdict
from decimal import Decimal

from django.contrib.auth import authenticate
from django.db import transaction
from django.db.models import Count, Prefetch, Q, Sum
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import access, filters, serializers as s, services
from .documents import read_document_bytes, store_document, verify_download_token
from .models import (
    Agreement, ApiToken, AppSetting, Asset, AssetMilestone, AuditLog, Compensation, CompensationStatus,
    CropAssessment, Document, Farmer, LandOwnership, LandParcel, Payment, Project, StageDefinition,
    User,
)


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------

@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    username = (request.data.get("username") or "").strip()
    password = request.data.get("password") or ""
    user = authenticate(request, username=username, password=password)
    if not user or not user.is_active:
        return Response({"detail": "Invalid username or password."}, status=400)
    if user.role == "FARMER":
        return Response({"detail": "Farmer login is not available in this version."}, status=403)
    token = ApiToken.issue(user, request.data.get("client", "WEB"))
    user.last_login = timezone.now()
    user.save(update_fields=["last_login"])
    services.audit(user, AuditLog.Action.LOGIN, user, request=request,
                   source=request.data.get("client", "WEB")[:20], model_name="User")
    return Response({"token": token.key, "user": s.MeSerializer(user).data})


@api_view(["POST"])
def logout_view(request):
    if isinstance(request.auth, ApiToken):
        request.auth.delete()  # only this device
    return Response({"ok": True})


@api_view(["GET"])
def me_view(request):
    return Response(s.MeSerializer(request.user).data)


@api_view(["POST"])
def change_password_view(request):
    user = request.user
    if not user.check_password(request.data.get("old_password") or ""):
        raise ValidationError({"old_password": "Current password is incorrect."})
    new = request.data.get("new_password") or ""
    from django.contrib.auth.password_validation import validate_password
    try:
        validate_password(new, user)
    except Exception as e:  # noqa: BLE001
        raise ValidationError({"new_password": list(getattr(e, "messages", [str(e)]))})
    user.set_password(new)
    user.save()
    ApiToken.objects.filter(user=user).exclude(pk=getattr(request.auth, "pk", None)).delete()
    return Response({"ok": True})


# ---------------------------------------------------------------------------
# Base viewset with scoping, audit trail and soft delete
# ---------------------------------------------------------------------------

class BaseViewSet(viewsets.ModelViewSet):
    resource = None
    permission_classes = [IsAuthenticated, access.ResourcePermission]

    def base_queryset(self):
        return self.queryset.all()

    def get_queryset(self):
        return access.scope_queryset(self.request.user, self.base_queryset())

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["user"] = self.request.user
        return ctx

    def perform_create(self, serializer):
        instance = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        services.audit(self.request.user, AuditLog.Action.CREATE, instance, services.snapshot(instance), request=self.request)
        self.after_save(instance, created=True)

    def perform_update(self, serializer):
        before = services.snapshot(serializer.instance)
        instance = serializer.save(updated_by=self.request.user)
        changes = services.diff(before, services.snapshot(instance))
        if changes:
            action = AuditLog.Action.APPROVE if changes.get("status", [None, None])[1] == "APPROVED" else AuditLog.Action.UPDATE
            services.audit(self.request.user, action, instance, changes, request=self.request)
        self.after_save(instance, created=False)

    def perform_destroy(self, instance):
        self.before_delete(instance)
        instance.is_deleted = True
        instance.updated_by = self.request.user
        instance.save()
        services.audit(self.request.user, AuditLog.Action.DELETE, instance, request=self.request)
        self.after_delete(instance)

    def after_save(self, instance, created):
        pass

    def before_delete(self, instance):
        pass

    def after_delete(self, instance):
        pass


class ProjectViewSet(BaseViewSet):
    resource = "project"
    queryset = Project.objects.all()
    serializer_class = s.ProjectSerializer
    search_fields = ["code", "name", "developer", "district", "taluk", "corridor"]
    filterset_fields = ["project_type", "status", "voltage_level", "district"]
    ordering_fields = ["code", "name", "created_at", "start_date"]

    def base_queryset(self):
        return Project.objects.annotate(
            asset_count=Count("assets", filter=Q(assets__is_deleted=False), distinct=True),
            farmer_count=Count("farmers", filter=Q(farmers__is_deleted=False), distinct=True),
        ).order_by("code")

    def perform_create(self, serializer):
        serializer.validated_data["company"] = self.request.user.company
        super().perform_create(serializer)
        if self.request.user.role not in access.ALL_PROJECT_ROLES:
            self.request.user.projects.add(serializer.instance)

    def before_delete(self, instance):
        if instance.assets.exists() or instance.agreements.exists() or instance.compensations.exists():
            raise ValidationError("This project has locations, agreements or compensation records. Remove those first or mark the project Completed.")

    @action(detail=True, methods=["get"])
    def summary(self, request, pk=None):
        project = self.get_object()
        return Response(dashboard_data(request.user, project_ids=[project.id]))


class FarmerViewSet(BaseViewSet):
    resource = "farmer"
    queryset = Farmer.objects.all()
    serializer_class = s.FarmerSerializer
    filterset_class = filters.FarmerFilter
    search_fields = ["farmer_code", "name", "relation_name", "mobile", "village", "aadhaar_last4",
                     "ownerships__land__survey_number"]
    ordering_fields = ["farmer_code", "name", "village", "created_at", "updated_at"]

    def base_queryset(self):
        return Farmer.objects.prefetch_related(
            "projects",
            Prefetch("ownerships", queryset=LandOwnership.objects.all()),
            Prefetch("documents", queryset=Document.objects.only("id", "category", "farmer_id")),
        ).distinct()

    def before_delete(self, instance):
        if instance.compensations.exists() or instance.agreements.exists():
            raise ValidationError("This farmer has agreements or compensation records and cannot be deleted. Mark them Inactive instead.")

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        """Farmer lifetime history: everything linked to this Farmer ID across projects."""
        farmer = self.get_object()
        user = request.user
        ctx = self.get_serializer_context()
        lands = LandParcel.objects.filter(ownerships__farmer=farmer, ownerships__is_deleted=False).distinct().prefetch_related(
            "projects", Prefetch("ownerships", queryset=LandOwnership.objects.select_related("farmer")), "assets")
        assets = services.assets_with_progress_prefetch(
            access.scope_queryset(user, Asset.objects.filter(land_parcel__in=lands))
        )
        ctx["stages"] = services.active_stages()
        data = {
            "farmer": s.FarmerSerializer(farmer, context=ctx).data,
            "lands": s.LandParcelSerializer(lands, many=True, context=ctx).data,
            "assets": s.AssetSerializer(assets, many=True, context=ctx).data,
            "agreements": s.AgreementSerializer(
                access.scope_queryset(user, farmer.agreements.select_related("project", "land_parcel").prefetch_related("farmers", "assets", "documents")),
                many=True, context=ctx).data,
            "crop_assessments": s.CropAssessmentSerializer(
                access.scope_queryset(user, farmer.crop_assessments.select_related("project", "farmer", "land_parcel", "asset").prefetch_related("compensations", "documents")),
                many=True, context=ctx).data,
            "documents": s.DocumentSerializer(
                Document.objects.filter(Q(farmer=farmer) | Q(land_parcel__in=lands)).distinct(), many=True, context=ctx).data,
            "timeline": services.farmer_history(farmer),
        }
        if access.can(user, "compensation"):
            comps = access.scope_queryset(user, farmer.compensations.select_related("project", "payee", "asset", "land_parcel", "approved_by").prefetch_related("payments"))
            data["compensations"] = s.CompensationSerializer(comps, many=True, context=ctx).data
            data["payments"] = s.PaymentSerializer(
                access.scope_queryset(user, Payment.objects.filter(compensation__payee=farmer).select_related(
                    "compensation__project", "compensation__payee", "compensation__asset", "paid_to").prefetch_related("documents")),
                many=True, context=ctx).data
            data["totals"] = services.compensation_totals(comps)
        return Response(data)


class LandParcelViewSet(BaseViewSet):
    resource = "land"
    queryset = LandParcel.objects.all()
    serializer_class = s.LandParcelSerializer
    filterset_class = filters.LandFilter
    search_fields = ["survey_number", "hissa", "village", "rtc_reference", "ownerships__farmer__name", "ownerships__farmer__farmer_code"]
    ordering_fields = ["survey_number", "village", "created_at", "updated_at"]

    def base_queryset(self):
        return LandParcel.objects.prefetch_related(
            "projects", Prefetch("ownerships", queryset=LandOwnership.objects.select_related("farmer")), "assets"
        ).distinct()

    def before_delete(self, instance):
        if instance.assets.exists() or instance.agreements.exists():
            raise ValidationError("Locations or agreements are linked to this land record.")


class LandOwnershipViewSet(BaseViewSet):
    resource = "ownership"
    queryset = LandOwnership.objects.all()
    serializer_class = s.LandOwnershipSerializer
    filterset_class = filters.OwnershipFilter

    def base_queryset(self):
        return LandOwnership.objects.select_related("farmer", "land")

    def create(self, request, *args, **kwargs):
        # Upsert on (land, farmer) - re-linking a removed owner revives the record.
        existing = LandOwnership.all_objects.filter(land=request.data.get("land"), farmer=request.data.get("farmer")).first()
        if existing:
            existing.is_deleted = False
            ser = self.get_serializer(existing, data=request.data, partial=True)
            ser.is_valid(raise_exception=True)
            self.perform_update(ser)
            return Response(ser.data, status=200)
        return super().create(request, *args, **kwargs)


class AssetViewSet(BaseViewSet):
    resource = "asset"
    queryset = Asset.objects.all()
    serializer_class = s.AssetSerializer
    filterset_class = filters.AssetFilter
    search_fields = ["asset_number", "line_name", "land_parcel__survey_number", "land_parcel__village",
                     "land_parcel__ownerships__farmer__name", "land_parcel__ownerships__farmer__farmer_code"]
    ordering_fields = ["asset_number", "asset_type", "created_at", "updated_at"]

    def base_queryset(self):
        return services.assets_with_progress_prefetch(Asset.objects.all()).distinct()

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["stages"] = services.active_stages()
        return ctx

    def perform_create(self, serializer):
        self._check_duplicate(serializer)
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._check_duplicate(serializer)
        super().perform_update(serializer)

    def _check_duplicate(self, serializer):
        project = serializer.validated_data.get("project") or serializer.instance.project
        number = serializer.validated_data.get("asset_number") or serializer.instance.asset_number
        dup = Asset.objects.filter(project=project, asset_number__iexact=number)
        if serializer.instance:
            dup = dup.exclude(pk=serializer.instance.pk)
        if dup.exists():
            raise ValidationError({"asset_number": f"{number} already exists in this project."})

    def before_delete(self, instance):
        if instance.compensations.exists():
            raise ValidationError("Compensation records are linked to this location.")

    @action(detail=True, methods=["post"], url_path="set-stage")
    def set_stage(self, request, pk=None):
        """Mark one progress stage complete / not complete for this location."""
        asset = self.get_object()
        code = request.data.get("stage_code")
        existing = AssetMilestone.all_objects.filter(asset=asset, stage_code=code).first()
        data = {**request.data, "asset": str(asset.id)}
        ser = s.AssetMilestoneSerializer(existing, data=data, partial=existing is not None, context=self.get_serializer_context())
        ser.is_valid(raise_exception=True)
        before = services.snapshot(existing)
        if existing:
            existing.is_deleted = False
            m = ser.save(updated_by=request.user)
        else:
            m = ser.save(created_by=request.user, updated_by=request.user)
        services.audit(request.user, AuditLog.Action.UPDATE if existing else AuditLog.Action.CREATE, m,
                       services.diff(before, services.snapshot(m)), request=request)
        asset = self.get_queryset().get(pk=asset.pk)
        return Response(s.AssetSerializer(asset, context=self.get_serializer_context()).data)


class StageDefinitionViewSet(viewsets.ModelViewSet):
    queryset = StageDefinition.objects.all()
    serializer_class = s.StageDefinitionSerializer
    pagination_class = None
    resource = "settings"
    permission_classes = [IsAuthenticated, access.ResourcePermission]


class AssetMilestoneViewSet(BaseViewSet):
    resource = "milestone"
    queryset = AssetMilestone.objects.all()
    serializer_class = s.AssetMilestoneSerializer
    filterset_class = filters.MilestoneFilter

    def base_queryset(self):
        return AssetMilestone.objects.select_related("asset", "updated_by", "created_by")

    def create(self, request, *args, **kwargs):
        existing = AssetMilestone.all_objects.filter(asset=request.data.get("asset"), stage_code=request.data.get("stage_code")).first()
        if existing:
            existing.is_deleted = False
            ser = self.get_serializer(existing, data=request.data, partial=True)
            ser.is_valid(raise_exception=True)
            self.perform_update(ser)
            return Response(ser.data)
        return super().create(request, *args, **kwargs)


class AgreementViewSet(BaseViewSet):
    resource = "agreement"
    queryset = Agreement.objects.all()
    serializer_class = s.AgreementSerializer
    filterset_class = filters.AgreementFilter
    search_fields = ["agreement_number", "farmers__name", "farmers__farmer_code", "land_parcel__survey_number",
                     "assets__asset_number", "registration_details"]
    ordering_fields = ["agreement_number", "agreement_date", "created_at", "total_consideration"]

    def base_queryset(self):
        return Agreement.objects.select_related("project", "land_parcel", "created_by", "updated_by").prefetch_related(
            "farmers", "assets", "documents").distinct()

    def after_save(self, instance, created):
        services.refresh_agreement_milestones(instance, self.request.user)

    def after_delete(self, instance):
        instance.status = "CANCELLED"
        services.refresh_agreement_milestones(instance, self.request.user)


class CropAssessmentViewSet(BaseViewSet):
    resource = "crop"
    queryset = CropAssessment.objects.all()
    serializer_class = s.CropAssessmentSerializer
    filterset_class = filters.CropFilter
    search_fields = ["crop_type", "farmer__name", "farmer__farmer_code", "land_parcel__survey_number", "asset__asset_number"]
    ordering_fields = ["assessment_date", "created_at", "crop_type"]

    def base_queryset(self):
        return CropAssessment.objects.select_related("project", "farmer", "land_parcel", "asset", "created_by", "updated_by").prefetch_related(
            Prefetch("compensations", queryset=services.annotate_paid(Compensation.objects.all())), "documents")


class CompensationViewSet(BaseViewSet):
    resource = "compensation"
    queryset = Compensation.objects.all()
    serializer_class = s.CompensationSerializer
    filterset_class = filters.CompensationFilter
    search_fields = ["payee__name", "payee__farmer_code", "asset__asset_number", "land_parcel__survey_number", "description"]
    ordering_fields = ["created_at", "approved_amount", "approved_on", "category"]

    def base_queryset(self):
        return services.annotate_paid(
            Compensation.objects.select_related("project", "payee", "asset", "land_parcel", "approved_by", "created_by", "updated_by")
        ).prefetch_related("payments")

    def after_save(self, instance, created):
        services.refresh_payment_milestone(instance.asset, self.request.user)

    def before_delete(self, instance):
        if instance.payments.exists():
            raise ValidationError("Payments have been recorded against this compensation; it cannot be deleted.")

    def after_delete(self, instance):
        services.refresh_payment_milestone(instance.asset, self.request.user)

    @action(detail=False, methods=["get"])
    def totals(self, request):
        qs = self.filter_queryset(self.get_queryset())
        return Response(services.compensation_totals(Compensation.objects.filter(pk__in=qs.values("pk"))))


class PaymentViewSet(BaseViewSet):
    resource = "payment"
    queryset = Payment.objects.all()
    serializer_class = s.PaymentSerializer
    filterset_class = filters.PaymentFilter
    search_fields = ["reference_number", "receipt_number", "compensation__payee__name", "compensation__payee__farmer_code"]
    ordering_fields = ["payment_date", "amount", "created_at"]

    def base_queryset(self):
        return Payment.objects.select_related(
            "compensation__project", "compensation__payee", "compensation__asset", "paid_to", "created_by", "updated_by"
        ).prefetch_related("documents")

    def after_save(self, instance, created):
        services.refresh_payment_milestone(instance.compensation.asset, self.request.user)

    def after_delete(self, instance):
        services.refresh_payment_milestone(instance.compensation.asset, self.request.user)


class DocumentViewSet(BaseViewSet):
    resource = "document"
    queryset = Document.objects.all()
    serializer_class = s.DocumentSerializer
    filterset_class = filters.DocumentFilter
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    search_fields = ["title", "original_name", "notes"]

    def base_queryset(self):
        return Document.objects.select_related("created_by", "updated_by")

    def create(self, request, *args, **kwargs):
        doc_id = request.data.get("id")
        if doc_id and Document.all_objects.filter(pk=doc_id).exists():
            # Idempotent re-upload from a device that did not receive the first response.
            doc = Document.all_objects.get(pk=doc_id)
            return Response(self.get_serializer(doc).data, status=200)
        meta = {k: v for k, v in request.data.items() if k != "file"}
        ser = self.get_serializer(data=meta)
        ser.is_valid(raise_exception=True)
        self._check_links(ser.validated_data)
        doc = Document(**ser.validated_data, created_by=request.user, updated_by=request.user)
        with transaction.atomic():
            store_document(doc, request.FILES.get("file"))
        services.audit(request.user, AuditLog.Action.CREATE, doc, {"category": doc.category, "file": doc.original_name}, request=request)
        return Response(self.get_serializer(doc).data, status=201)

    def _check_links(self, data):
        user = self.request.user
        for field, model in (("project", Project), ("farmer", Farmer), ("land_parcel", LandParcel), ("asset", Asset),
                             ("agreement", Agreement), ("compensation", Compensation), ("payment", Payment),
                             ("crop_assessment", CropAssessment), ("milestone", AssetMilestone)):
            obj = data.get(field)
            if obj is not None and not access.scope_queryset(user, model.objects.filter(pk=obj.pk)).exists():
                raise PermissionDenied(f"You do not have access to the linked {field.replace('_', ' ')}.")
        if data.get("category") == "PAYMENT_RECEIPT" and not access.can(user, "payment", "write"):
            raise PermissionDenied("Only Finance users can upload payment receipts.")

    @action(detail=True, methods=["get"], permission_classes=[AllowAny], authentication_classes=[])
    def download(self, request, pk=None):
        """Serve a file. Accepts a signed link (?t=...) so images can be shown in the browser."""
        from .auth import ApiTokenAuthentication
        user = None
        token = request.query_params.get("t")
        if token:
            uid = verify_download_token(token, pk)
            user = User.objects.filter(pk=uid, is_active=True).first() if uid else None
        else:
            auth = ApiTokenAuthentication().authenticate(request)
            user = auth[0] if auth else None
        if user is None:
            return Response({"detail": "Link expired or not authorised."}, status=401)
        doc = get_object_or_404(access.scope_queryset(user, Document.objects.all()), pk=pk)
        if not access.can_view_document_file(user, doc):
            return Response({"detail": "You do not have permission to view this document."}, status=403)
        if doc.is_sensitive:
            services.audit(user, AuditLog.Action.VIEW_SENSITIVE, doc, request=request)
        resp = HttpResponse(read_document_bytes(doc), content_type=doc.content_type or "application/octet-stream")
        disp = "attachment" if request.query_params.get("download") else "inline"
        resp["Content-Disposition"] = f'{disp}; filename="{doc.original_name or doc.id}"'
        resp["Cache-Control"] = "private, max-age=600"
        resp["X-Content-Type-Options"] = "nosniff"
        return resp


class UserViewSet(viewsets.ModelViewSet):
    resource = "user"
    permission_classes = [IsAuthenticated, access.ResourcePermission]
    serializer_class = s.UserSerializer
    search_fields = ["username", "first_name", "last_name", "email", "phone"]
    filterset_fields = ["role", "is_active"]

    def get_queryset(self):
        qs = User.objects.prefetch_related("projects").order_by("username")
        if self.request.user.company_id:
            qs = qs.filter(company=self.request.user.company)
        return qs

    def perform_create(self, serializer):
        u = serializer.save()
        services.audit(self.request.user, AuditLog.Action.CREATE, u, {"role": u.role}, request=self.request)

    def perform_update(self, serializer):
        before = services.snapshot(serializer.instance)
        password_reset = bool(serializer.validated_data.get("password"))
        u = serializer.save()
        changes = services.diff(before, services.snapshot(u))
        changes.pop("last_login", None)
        if password_reset:
            changes["password"] = ["****", "reset"]
        if password_reset or not u.is_active:
            ApiToken.objects.filter(user=u).delete()  # sign out everywhere
        if changes:
            services.audit(self.request.user, AuditLog.Action.UPDATE, u, changes, request=self.request)

    def perform_destroy(self, instance):
        if instance == self.request.user:
            raise ValidationError("You cannot deactivate your own account.")
        instance.is_active = False
        instance.save()
        ApiToken.objects.filter(user=instance).delete()
        services.audit(self.request.user, AuditLog.Action.DELETE, instance, request=self.request)


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    resource = "audit"
    permission_classes = [IsAuthenticated, access.ResourcePermission]
    serializer_class = s.AuditLogSerializer
    filterset_class = filters.AuditFilter
    search_fields = ["object_repr", "model_name", "user__username"]

    def get_queryset(self):
        return AuditLog.objects.select_related("user")


class AppSettingViewSet(viewsets.ModelViewSet):
    resource = "settings"
    permission_classes = [IsAuthenticated, access.ResourcePermission]
    serializer_class = s.AppSettingSerializer
    queryset = AppSetting.objects.all()
    pagination_class = None


# ---------------------------------------------------------------------------
# Dashboard / MIS
# ---------------------------------------------------------------------------

def dashboard_data(user, project_ids=None):
    projects = access.visible_projects(user)
    if project_ids:
        projects = projects.filter(id__in=project_ids)
    pids = list(projects.values_list("id", flat=True))

    farmers = Farmer.objects.filter(projects__in=pids).distinct()
    lands = LandParcel.objects.filter(projects__in=pids).distinct()
    assets_qs = Asset.objects.filter(project__in=pids)
    agreements = Agreement.objects.filter(project__in=pids)
    crop = CropAssessment.objects.filter(project__in=pids)

    stages = services.active_stages()
    assets = list(services.assets_with_progress_prefetch(assets_qs))
    stage_counts = {st.code: 0 for st in stages}
    partial_kyc = 0
    row_cleared = 0
    per_project = defaultdict(lambda: {"assets": 0, "stage_counts": defaultdict(int), "cleared": 0})
    for a in assets:
        prog = services.asset_progress(a, stages)
        done = {i["code"] for i in prog["stages"] if i["completed"]}
        for c in done:
            stage_counts[c] = stage_counts.get(c, 0) + 1
        if any(i["partial"] for i in prog["stages"]):
            partial_kyc += 1
        cleared = {"AGREEMENT", "PAYMENT"} <= done
        row_cleared += cleared
        pp = per_project[a.project_id]
        pp["assets"] += 1
        pp["cleared"] += cleared
        for c in done:
            pp["stage_counts"][c] += 1

    asset_types = PyCounter(a.asset_type for a in assets)
    agr_status = PyCounter(agreements.values_list("status", flat=True))
    executed = agr_status.get("EXECUTED", 0) + agr_status.get("REGISTERED", 0)
    pending = agr_status.get("DRAFT", 0) + agr_status.get("NEGOTIATION", 0)

    data = {
        "generated_at": timezone.now().isoformat(),
        "project_count": len(pids),
        "farmers": farmers.count(),
        "farmers_kyc_done": farmers.filter(kyc_status__in=["COLLECTED", "VERIFIED"]).count(),
        "survey_numbers": lands.count(),
        "assets": len(assets),
        "assets_by_type": dict(asset_types),
        "assets_with_gps": sum(1 for a in assets if a.latitude is not None),
        "agreements_executed": executed,
        "agreements_pending": pending,
        "crop_claims": crop.count(),
        "stages": [{"code": st.code, "name": st.name, "completed": stage_counts.get(st.code, 0), "total": len(assets)} for st in stages],
        "row_cleared": row_cleared,
        "row_cleared_percent": round(100 * row_cleared / len(assets)) if assets else 0,
    }
    if access.can(user, "compensation"):
        comps = Compensation.objects.filter(project__in=pids)
        data["compensation"] = services.compensation_totals(comps)
        data["compensation_by_category"] = [
            {"category": r["category"], "approved": r["approved"] or 0}
            for r in comps.filter(status=CompensationStatus.APPROVED).values("category").annotate(approved=Sum("approved_amount")).order_by("category")
        ]
        recent = Payment.objects.filter(compensation__project__in=pids).select_related("compensation__payee", "compensation__project")[:8]
        data["recent_payments"] = [
            {"id": str(p.id), "date": p.payment_date, "amount": p.amount, "farmer": p.compensation.payee.name,
             "farmer_code": p.compensation.payee.farmer_code, "project": p.compensation.project.code, "mode": p.mode,
             "reference": p.reference_number}
            for p in recent
        ]
    project_rows = []
    for p in projects:
        pp = per_project.get(p.id, {"assets": 0, "stage_counts": {}, "cleared": 0})
        row = {"id": str(p.id), "code": p.code, "name": p.name, "project_type": p.project_type,
               "voltage_level": p.voltage_level, "assets": pp["assets"], "row_cleared": pp["cleared"],
               "stage_counts": dict(pp["stage_counts"])}
        if access.can(user, "compensation"):
            row["compensation"] = services.compensation_totals(Compensation.objects.filter(project=p))
        project_rows.append(row)
    data["projects"] = project_rows
    return data


class DashboardView(APIView):
    def get(self, request):
        pid = request.query_params.get("project")
        return Response(dashboard_data(request.user, project_ids=[pid] if pid else None))


# ---------------------------------------------------------------------------
# Map data (GeoJSON)
# ---------------------------------------------------------------------------

class MapView(APIView):
    def get(self, request):
        user = request.user
        assets = access.scope_queryset(user, Asset.objects.filter(latitude__isnull=False))
        flt = filters.AssetFilter(request.query_params, queryset=assets, request=request)
        assets = services.assets_with_progress_prefetch(flt.qs).distinct()
        stages = services.active_stages()
        features = []
        for a in assets:
            prog = services.asset_progress(a, stages)
            farmers = services.asset_farmers(a)
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [float(a.longitude), float(a.latitude)]},
                "properties": {
                    "kind": "asset", "id": str(a.id), "asset_number": a.asset_number, "asset_type": a.asset_type,
                    "project_id": str(a.project_id), "project_code": a.project.code, "line_name": a.line_name,
                    "land_id": str(a.land_parcel_id) if a.land_parcel_id else None,
                    "survey": a.land_parcel.survey_label if a.land_parcel_id else None,
                    "village": a.land_parcel.village if a.land_parcel_id else None,
                    "farmers": [{"id": str(f.id), "code": f.farmer_code, "name": f.name} for f in farmers],
                    "completed": [i["code"] for i in prog["stages"] if i["completed"]],
                    "percent": prog["percent"], "latest": prog["latest_completed"],
                    "gps_accuracy_m": float(a.gps_accuracy_m) if a.gps_accuracy_m is not None else None,
                },
            })
        project_id = request.query_params.get("project")
        lands = access.scope_queryset(user, LandParcel.objects.all())
        projects = access.visible_projects(user)
        if project_id:
            lands = lands.filter(projects=project_id)
            projects = projects.filter(id=project_id)
        for lp in lands.prefetch_related(Prefetch("ownerships", queryset=LandOwnership.objects.select_related("farmer"))):
            geom = lp.boundary_geojson
            if not geom and lp.latitude is not None:
                geom = {"type": "Point", "coordinates": [float(lp.longitude), float(lp.latitude)]}
            if not geom:
                continue
            features.append({
                "type": "Feature", "geometry": geom,
                "properties": {"kind": "land", "id": str(lp.id), "survey": lp.survey_label, "village": lp.village,
                               "owners": [o.farmer.name for o in lp.ownerships.all()]},
            })
        for p in projects:
            if p.route_geojson:
                features.append({"type": "Feature", "geometry": p.route_geojson,
                                 "properties": {"kind": "route", "id": str(p.id), "project_code": p.code, "name": p.name}})
        return Response({"type": "FeatureCollection", "features": features,
                         "stages": [{"code": st.code, "name": st.name} for st in stages]})


def choice_lists():
    from . import models as m

    def choices(cls):
        return [{"value": v, "label": l} for v, l in cls.choices]

    return {
        "roles": choices(m.Role),
        "project_types": choices(m.ProjectType),
        "voltage_levels": choices(m.VoltageLevel),
        "project_statuses": choices(m.ProjectStatus),
        "farmer_statuses": choices(m.FarmerStatus),
        "kyc_statuses": choices(m.KYCStatus),
        "relations": choices(m.Relation),
        "ownership_types": choices(m.OwnershipType),
        "land_types": choices(m.LandType),
        "asset_types": choices(m.AssetType),
        "agreement_types": choices(m.AgreementType),
        "agreement_statuses": choices(m.AgreementStatus),
        "crop_seasons": choices(m.CropSeason),
        "crop_stages": choices(m.CropStage),
        "compensation_categories": choices(m.CompensationCategory),
        "compensation_statuses": choices(m.CompensationStatus),
        "payment_modes": choices(m.PaymentMode),
        "document_categories": choices(m.DocumentCategory),
    }


class MetaView(APIView):
    """Choice lists for forms (single source of truth for web and mobile)."""

    def get(self, request):
        return Response({
            **choice_lists(),
            "stages": s.StageDefinitionSerializer(services.active_stages(), many=True).data,
            "settings": {k: AppSetting.get(k) for k in AppSetting.DEFAULTS},
        })
