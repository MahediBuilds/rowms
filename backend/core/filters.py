import django_filters as df
from django.db.models import Exists, OuterRef, Q

from .models import (
    Agreement, Asset, AssetMilestone, AuditLog, Compensation, CropAssessment, Document, Farmer,
    LandOwnership, LandParcel, Payment,
)


class FarmerFilter(df.FilterSet):
    project = df.UUIDFilter(field_name="projects")
    village = df.CharFilter(lookup_expr="iexact")
    taluk = df.CharFilter(lookup_expr="iexact")
    district = df.CharFilter(lookup_expr="iexact")

    class Meta:
        model = Farmer
        fields = ["project", "kyc_status", "status", "village", "hobli", "taluk", "district"]


class LandFilter(df.FilterSet):
    project = df.UUIDFilter(field_name="projects")
    farmer = df.UUIDFilter(field_name="ownerships__farmer")
    village = df.CharFilter(lookup_expr="iexact")

    class Meta:
        model = LandParcel
        fields = ["project", "farmer", "village", "hobli", "taluk", "district", "land_type", "ownership_type"]


class OwnershipFilter(df.FilterSet):
    class Meta:
        model = LandOwnership
        fields = ["land", "farmer", "is_primary_payee"]


class AssetFilter(df.FilterSet):
    farmer = df.UUIDFilter(field_name="land_parcel__ownerships__farmer")
    stage = df.CharFilter(method="filter_stage", help_text="Stage code, combine with stage_done=true|false")
    has_gps = df.BooleanFilter(method="filter_has_gps")

    class Meta:
        model = Asset
        fields = ["project", "asset_type", "land_parcel", "line_name"]

    def filter_stage(self, qs, name, value):
        done = str(self.data.get("stage_done", "true")).lower() in ("1", "true", "yes")
        if value == "KYC":
            from .models import KYCStatus
            pending_owner = LandOwnership.objects.filter(
                land=OuterRef("land_parcel"), farmer__is_deleted=False
            ).exclude(farmer__kyc_status__in=[KYCStatus.COLLECTED, KYCStatus.VERIFIED])
            any_owner = LandOwnership.objects.filter(land=OuterRef("land_parcel"), farmer__is_deleted=False)
            complete = Q(Exists(any_owner)) & ~Q(Exists(pending_owner))
            return qs.filter(complete) if done else qs.exclude(complete)
        sub = AssetMilestone.objects.filter(asset=OuterRef("pk"), stage_code=value, completed=True)
        return qs.filter(Exists(sub)) if done else qs.exclude(Exists(sub))

    def filter_has_gps(self, qs, name, value):
        return qs.filter(latitude__isnull=not value)


class MilestoneFilter(df.FilterSet):
    project = df.UUIDFilter(field_name="asset__project")

    class Meta:
        model = AssetMilestone
        fields = ["asset", "stage_code", "completed", "project"]


class AgreementFilter(df.FilterSet):
    farmer = df.UUIDFilter(field_name="farmers")
    asset = df.UUIDFilter(field_name="assets")
    pending = df.BooleanFilter(method="filter_pending")

    class Meta:
        model = Agreement
        fields = ["project", "status", "agreement_type", "land_parcel", "farmer", "asset"]

    def filter_pending(self, qs, name, value):
        q = Q(status__in=["DRAFT", "NEGOTIATION"])
        return qs.filter(q) if value else qs.exclude(q)


class CompensationFilter(df.FilterSet):
    payment_status = df.CharFilter(method="filter_payment_status")

    class Meta:
        model = Compensation
        fields = ["project", "asset", "land_parcel", "payee", "category", "status", "crop_assessment"]

    def filter_payment_status(self, qs, name, value):
        from django.db.models import F, Sum, Value
        from django.db.models.functions import Coalesce
        qs = qs.annotate(_p=Coalesce(Sum("payments__amount", filter=Q(payments__is_deleted=False)), Value(0), output_field=qs.model._meta.get_field("approved_amount")))
        if value == "UNPAID":
            return qs.filter(_p__lte=0)
        if value == "PARTIAL":
            return qs.filter(_p__gt=0, _p__lt=F("approved_amount"))
        if value == "PAID":
            return qs.filter(_p__gte=F("approved_amount"), _p__gt=0)
        if value == "PENDING":  # anything with balance
            return qs.filter(_p__lt=F("approved_amount"))
        return qs


class PaymentFilter(df.FilterSet):
    project = df.UUIDFilter(field_name="compensation__project")
    farmer = df.UUIDFilter(field_name="compensation__payee")
    date_from = df.DateFilter(field_name="payment_date", lookup_expr="gte")
    date_to = df.DateFilter(field_name="payment_date", lookup_expr="lte")

    class Meta:
        model = Payment
        fields = ["compensation", "mode", "project", "farmer"]


class CropFilter(df.FilterSet):
    class Meta:
        model = CropAssessment
        fields = ["project", "farmer", "land_parcel", "asset", "season", "crop_stage"]


class DocumentFilter(df.FilterSet):
    class Meta:
        model = Document
        fields = ["category", "project", "farmer", "land_parcel", "asset", "milestone", "agreement",
                  "compensation", "payment", "crop_assessment", "captured_live"]


class AuditFilter(df.FilterSet):
    date_from = df.DateFilter(field_name="timestamp", lookup_expr="date__gte")
    date_to = df.DateFilter(field_name="timestamp", lookup_expr="date__lte")

    class Meta:
        model = AuditLog
        fields = ["user", "action", "model_name", "object_id", "source"]
