from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from . import access
from .models import (
    Agreement, AppSetting, Asset, AssetMilestone, AuditLog, Compensation, CompensationStatus,
    CropAssessment, Document, Farmer, KYCStatus, LandOwnership, LandParcel, Payment, Project,
    StageDefinition, StageScope, User,
)
from .services import asset_farmers, asset_progress, inr


def _user(serializer):
    request = serializer.context.get("request")
    return getattr(request, "user", None) or serializer.context.get("user")


class UUIDListField(serializers.ListField):
    child = serializers.UUIDField()


class BaseSerializer(serializers.ModelSerializer):
    """Common fields. ``id`` may be supplied by the client (offline-created records)."""

    id = serializers.UUIDField(required=False)
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    BASE_READONLY = ["created_at", "updated_at", "created_by", "updated_by", "is_deleted"]

    def get_created_by_name(self, obj):
        return obj.created_by.display_name if getattr(obj, "created_by", None) else None

    def get_updated_by_name(self, obj):
        return obj.updated_by.display_name if getattr(obj, "updated_by", None) else None

    def validate_id(self, value):
        if self.instance is None and self.Meta.model.all_objects.filter(pk=value).exists():
            raise serializers.ValidationError("A record with this id already exists.")
        return value

    def update(self, instance, validated_data):
        validated_data.pop("id", None)
        return super().update(instance, validated_data)


def _project_brief(p):
    return {"id": str(p.id), "code": p.code, "name": p.name}


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

class ProjectSerializer(BaseSerializer):
    asset_count = serializers.IntegerField(read_only=True, required=False)
    farmer_count = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = Project
        exclude = ["is_deleted"]
        read_only_fields = BaseSerializer.BASE_READONLY + ["company"]


# ---------------------------------------------------------------------------
# Farmers
# ---------------------------------------------------------------------------

BANK_FIELDS = ["bank_account_holder", "bank_name", "bank_branch", "bank_account_number", "bank_ifsc"]


class FarmerSerializer(BaseSerializer):
    project_ids = UUIDListField(write_only=True, required=False)
    projects = serializers.SerializerMethodField()
    kyc_done = serializers.BooleanField(read_only=True)
    bank_account_masked = serializers.CharField(read_only=True)
    land_count = serializers.SerializerMethodField()
    kyc_document_count = serializers.SerializerMethodField()

    class Meta:
        model = Farmer
        exclude = ["is_deleted"]
        read_only_fields = BaseSerializer.BASE_READONLY + [
            "farmer_code", "kyc_collected_by", "kyc_verified_by",
        ]

    def get_projects(self, obj):
        return [_project_brief(p) for p in obj.projects.all()]

    def get_land_count(self, obj):
        return len(obj.ownerships.all())

    def get_kyc_document_count(self, obj):
        return sum(1 for d in obj.documents.all() if d.category in ("KYC_AADHAAR", "KYC_OTHER"))

    def to_representation(self, obj):
        data = super().to_representation(obj)
        user = _user(self)
        data["can_view_bank"] = access.has_role(user, access.BANK_DETAIL_READERS)
        if not data["can_view_bank"]:
            for f in BANK_FIELDS:
                data.pop(f, None)
        return data

    def validate_aadhaar_last4(self, value):
        value = (value or "").strip()
        if len(value) > 4:
            raise serializers.ValidationError("Store only the last 4 digits of Aadhaar - never the full number.")
        return value

    def validate(self, attrs):
        user = _user(self)
        if any(f in attrs for f in BANK_FIELDS) and not access.has_role(user, access.BANK_DETAIL_WRITERS):
            for f in BANK_FIELDS:
                attrs.pop(f, None)
        new_kyc = attrs.get("kyc_status")
        if new_kyc == KYCStatus.VERIFIED and (self.instance is None or self.instance.kyc_status != KYCStatus.VERIFIED):
            if not access.has_role(user, access.KYC_VERIFIERS):
                raise serializers.ValidationError({"kyc_status": "Only Admin, Project Manager or ROW Officer can mark KYC as verified."})
        if "project_ids" in attrs:
            allowed = set(access.visible_projects(user).values_list("id", flat=True))
            bad = [p for p in attrs["project_ids"] if p not in allowed]
            if bad:
                raise serializers.ValidationError({"project_ids": "You are not assigned to one or more of these projects."})
        return attrs

    def _apply_kyc(self, instance, old_status):
        user = _user(self)
        today = timezone.localdate()
        changed = False
        if instance.kyc_status in (KYCStatus.COLLECTED, KYCStatus.VERIFIED) and not instance.kyc_collected_on:
            instance.kyc_collected_on, instance.kyc_collected_by = today, user
            changed = True
        if instance.kyc_status == KYCStatus.VERIFIED and old_status != KYCStatus.VERIFIED:
            instance.kyc_verified_on, instance.kyc_verified_by = today, user
            changed = True
        if instance.kyc_status == KYCStatus.NOT_COLLECTED and old_status != KYCStatus.NOT_COLLECTED:
            instance.kyc_collected_on = instance.kyc_verified_on = None
            instance.kyc_collected_by = instance.kyc_verified_by = None
            changed = True
        if changed:
            instance.save()

    @transaction.atomic
    def create(self, validated_data):
        project_ids = validated_data.pop("project_ids", None)
        instance = super().create(validated_data)
        if project_ids is not None:
            instance.projects.set(project_ids)
        self._apply_kyc(instance, KYCStatus.NOT_COLLECTED)
        return instance

    @transaction.atomic
    def update(self, instance, validated_data):
        old = instance.kyc_status
        project_ids = validated_data.pop("project_ids", None)
        instance = super().update(instance, validated_data)
        if project_ids is not None:
            # keep links to projects the user cannot see
            hidden = instance.projects.exclude(id__in=access.visible_projects(_user(self)).values("id"))
            instance.projects.set(list(project_ids) + list(hidden.values_list("id", flat=True)))
        self._apply_kyc(instance, old)
        return instance


class FarmerBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Farmer
        fields = ["id", "farmer_code", "name", "relation_type", "relation_name", "mobile", "village", "kyc_status"]


# ---------------------------------------------------------------------------
# Land
# ---------------------------------------------------------------------------

class LandOwnershipSerializer(BaseSerializer):
    farmer_code = serializers.CharField(source="farmer.farmer_code", read_only=True)
    farmer_name = serializers.CharField(source="farmer.name", read_only=True)
    farmer_kyc_status = serializers.CharField(source="farmer.kyc_status", read_only=True)
    land_label = serializers.SerializerMethodField()

    class Meta:
        model = LandOwnership
        exclude = ["is_deleted"]
        read_only_fields = BaseSerializer.BASE_READONLY
        validators = []  # uniqueness handled in the view (upsert)

    def get_land_label(self, obj):
        return f"{obj.land.survey_label}, {obj.land.village}"

    def save(self, **kwargs):
        instance = super().save(**kwargs)
        if instance.is_primary_payee:
            LandOwnership.objects.filter(land=instance.land, is_primary_payee=True).exclude(pk=instance.pk).update(
                is_primary_payee=False, updated_at=timezone.now()
            )
        return instance


class LandParcelSerializer(BaseSerializer):
    project_ids = UUIDListField(write_only=True, required=False)
    projects = serializers.SerializerMethodField()
    owners = serializers.SerializerMethodField()
    survey_label = serializers.CharField(read_only=True)
    total_acres = serializers.DecimalField(max_digits=12, decimal_places=3, read_only=True)
    asset_count = serializers.SerializerMethodField()

    class Meta:
        model = LandParcel
        exclude = ["is_deleted"]
        read_only_fields = BaseSerializer.BASE_READONLY

    def get_projects(self, obj):
        return [_project_brief(p) for p in obj.projects.all()]

    def get_owners(self, obj):
        return [
            {
                "ownership_id": str(o.id), "farmer_id": str(o.farmer_id), "farmer_code": o.farmer.farmer_code,
                "name": o.farmer.name, "is_primary_payee": o.is_primary_payee, "kyc_status": o.farmer.kyc_status,
                "share_percent": o.share_percent,
            }
            for o in obj.ownerships.all()
        ]

    def get_asset_count(self, obj):
        return len(obj.assets.all())

    def validate(self, attrs):
        if "project_ids" in attrs:
            allowed = set(access.visible_projects(_user(self)).values_list("id", flat=True))
            if any(p not in allowed for p in attrs["project_ids"]):
                raise serializers.ValidationError({"project_ids": "You are not assigned to one or more of these projects."})
        return attrs

    def create(self, validated_data):
        project_ids = validated_data.pop("project_ids", None)
        instance = super().create(validated_data)
        if project_ids is not None:
            instance.projects.set(project_ids)
        return instance

    def update(self, instance, validated_data):
        project_ids = validated_data.pop("project_ids", None)
        instance = super().update(instance, validated_data)
        if project_ids is not None:
            hidden = instance.projects.exclude(id__in=access.visible_projects(_user(self)).values("id"))
            instance.projects.set(list(project_ids) + list(hidden.values_list("id", flat=True)))
        return instance


# ---------------------------------------------------------------------------
# Assets and progress
# ---------------------------------------------------------------------------

class AssetSerializer(BaseSerializer):
    project_code = serializers.CharField(source="project.code", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)
    land_label = serializers.SerializerMethodField()
    farmers = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()
    gps_warning = serializers.SerializerMethodField()

    class Meta:
        model = Asset
        exclude = ["is_deleted"]
        read_only_fields = BaseSerializer.BASE_READONLY + ["gps_captured_by"]

    def get_land_label(self, obj):
        lp = obj.land_parcel
        return f"Sy.No. {lp.survey_label}, {lp.village}" if lp and not lp.is_deleted else None

    def get_farmers(self, obj):
        return [
            {"id": str(f.id), "farmer_code": f.farmer_code, "name": f.name, "kyc_status": f.kyc_status, "mobile": f.mobile}
            for f in asset_farmers(obj)
        ]

    def get_progress(self, obj):
        return asset_progress(obj, self.context.get("stages"))

    def get_gps_warning(self, obj):
        limit = self.context.get("gps_limit")
        if limit is None:
            limit = AppSetting.get("GPS_ACCURACY_WARNING_METERS")
            self.context["gps_limit"] = limit
        return bool(obj.gps_accuracy_m is not None and limit and float(obj.gps_accuracy_m) > float(limit))

    def validate_project(self, project):
        if not access.visible_projects(_user(self)).filter(pk=project.pk).exists():
            raise serializers.ValidationError("You are not assigned to this project.")
        return project

    def save(self, **kwargs):
        user = _user(self)
        if "latitude" in self.validated_data and self.validated_data.get("latitude") is not None:
            if self.instance is None or self.instance.latitude != self.validated_data["latitude"]:
                kwargs.setdefault("gps_captured_by", user)
                if not self.validated_data.get("gps_captured_at"):
                    kwargs.setdefault("gps_captured_at", timezone.now())
        return super().save(**kwargs)


class StageDefinitionSerializer(serializers.ModelSerializer):
    class Meta:
        model = StageDefinition
        fields = "__all__"


class AssetMilestoneSerializer(BaseSerializer):
    stage_name = serializers.SerializerMethodField()

    class Meta:
        model = AssetMilestone
        exclude = ["is_deleted"]
        read_only_fields = BaseSerializer.BASE_READONLY + ["source"]
        validators = []  # (asset, stage_code) handled as upsert in the view

    def get_stage_name(self, obj):
        stages = self.context.setdefault("_stage_names", dict(StageDefinition.objects.values_list("code", "name")))
        return stages.get(obj.stage_code, obj.stage_code)

    def validate(self, attrs):
        code = attrs.get("stage_code") or (self.instance.stage_code if self.instance else None)
        stage = StageDefinition.objects.filter(code=code).first()
        if not stage:
            raise serializers.ValidationError({"stage_code": f"Unknown stage '{code}'."})
        if stage.scope == StageScope.FARMER:
            raise serializers.ValidationError({"stage_code": "KYC is tracked on the farmer record - update the farmer's KYC status instead."})
        if not access.can_edit_stage(_user(self), stage):
            raise serializers.ValidationError({"stage_code": f"Your role cannot update '{stage.name}'."})
        asset = attrs.get("asset") or (self.instance.asset if self.instance else None)
        if asset and not access.visible_projects(_user(self)).filter(pk=asset.project_id).exists():
            raise serializers.ValidationError({"asset": "You are not assigned to this project."})
        if "completed" in attrs:
            if attrs["completed"] and not attrs.get("completed_on"):
                attrs["completed_on"] = (self.instance.completed_on if self.instance and self.instance.completed else None) or timezone.localdate()
            if not attrs["completed"]:
                attrs["completed_on"] = None
        attrs["source"] = AssetMilestone.Source.MANUAL
        return attrs


# ---------------------------------------------------------------------------
# Agreements
# ---------------------------------------------------------------------------

class AgreementSerializer(BaseSerializer):
    agreement_number = serializers.CharField(required=False, allow_blank=True)
    farmer_ids = UUIDListField(write_only=True, required=False)
    asset_ids = UUIDListField(write_only=True, required=False)
    farmer_list = serializers.SerializerMethodField()
    asset_list = serializers.SerializerMethodField()
    project_code = serializers.CharField(source="project.code", read_only=True)
    land_label = serializers.SerializerMethodField()
    document_count = serializers.SerializerMethodField()

    class Meta:
        model = Agreement
        exclude = ["is_deleted", "farmers", "assets"]
        read_only_fields = BaseSerializer.BASE_READONLY

    def get_farmer_list(self, obj):
        return [{"id": str(f.id), "farmer_code": f.farmer_code, "name": f.name} for f in obj.farmers.all()]

    def get_asset_list(self, obj):
        return [{"id": str(a.id), "asset_number": a.asset_number, "asset_type": a.asset_type} for a in obj.assets.all()]

    def get_land_label(self, obj):
        lp = obj.land_parcel
        return f"Sy.No. {lp.survey_label}, {lp.village}" if lp else None

    def get_document_count(self, obj):
        return len(obj.documents.all())

    def validate_project(self, project):
        if not access.visible_projects(_user(self)).filter(pk=project.pk).exists():
            raise serializers.ValidationError("You are not assigned to this project.")
        return project

    def validate_agreement_number(self, value):
        value = (value or "").strip()
        if value and Agreement.all_objects.filter(agreement_number=value).exclude(pk=getattr(self.instance, "pk", None)).exists():
            raise serializers.ValidationError("This agreement number is already used.")
        return value

    def _set_links(self, instance, farmer_ids, asset_ids):
        if farmer_ids is not None:
            instance.farmers.set(Farmer.objects.filter(id__in=farmer_ids))
        if asset_ids is not None:
            instance.assets.set(Asset.objects.filter(id__in=asset_ids, project=instance.project))

    @transaction.atomic
    def create(self, validated_data):
        f, a = validated_data.pop("farmer_ids", None), validated_data.pop("asset_ids", None)
        instance = super().create(validated_data)
        self._set_links(instance, f, a)
        return instance

    @transaction.atomic
    def update(self, instance, validated_data):
        f, a = validated_data.pop("farmer_ids", None), validated_data.pop("asset_ids", None)
        instance = super().update(instance, validated_data)
        self._set_links(instance, f, a)
        return instance


# ---------------------------------------------------------------------------
# Crop assessments
# ---------------------------------------------------------------------------

class CropAssessmentSerializer(BaseSerializer):
    project_code = serializers.CharField(source="project.code", read_only=True)
    farmer_code = serializers.CharField(source="farmer.farmer_code", read_only=True)
    farmer_name = serializers.CharField(source="farmer.name", read_only=True)
    land_label = serializers.SerializerMethodField()
    asset_number = serializers.CharField(source="asset.asset_number", read_only=True, default=None)
    compensation_summary = serializers.SerializerMethodField()
    photo_count = serializers.SerializerMethodField()

    class Meta:
        model = CropAssessment
        exclude = ["is_deleted"]
        read_only_fields = BaseSerializer.BASE_READONLY

    def get_land_label(self, obj):
        lp = obj.land_parcel
        return f"Sy.No. {lp.survey_label}, {lp.village}" if lp else None

    def get_compensation_summary(self, obj):
        if not access.can(_user(self), "compensation", "read"):
            return None
        approved = paid = Decimal("0")
        for c in obj.compensations.all():
            if c.status == CompensationStatus.APPROVED:
                approved += c.approved_amount
                paid += c.paid_amount
        return {"approved": approved, "paid": paid, "balance": approved - paid}

    def get_photo_count(self, obj):
        return len(obj.documents.all())

    def validate_project(self, project):
        if not access.visible_projects(_user(self)).filter(pk=project.pk).exists():
            raise serializers.ValidationError("You are not assigned to this project.")
        return project


# ---------------------------------------------------------------------------
# Compensation and payments
# ---------------------------------------------------------------------------

class CompensationSerializer(BaseSerializer):
    paid_amount = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    balance_amount = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    payment_status = serializers.CharField(read_only=True)
    project_code = serializers.CharField(source="project.code", read_only=True)
    payee_code = serializers.CharField(source="payee.farmer_code", read_only=True)
    payee_name = serializers.CharField(source="payee.name", read_only=True)
    asset_number = serializers.CharField(source="asset.asset_number", read_only=True, default=None)
    land_label = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    payment_count = serializers.SerializerMethodField()

    class Meta:
        model = Compensation
        exclude = ["is_deleted"]
        read_only_fields = BaseSerializer.BASE_READONLY + ["approved_by", "approved_on"]

    def get_land_label(self, obj):
        lp = obj.land_parcel
        return f"Sy.No. {lp.survey_label}, {lp.village}" if lp else None

    def get_approved_by_name(self, obj):
        return obj.approved_by.display_name if obj.approved_by else None

    def get_payment_count(self, obj):
        return len(obj.payments.all())

    def validate_project(self, project):
        if not access.visible_projects(_user(self)).filter(pk=project.pk).exists():
            raise serializers.ValidationError("You are not assigned to this project.")
        return project

    def validate(self, attrs):
        user = _user(self)
        new_status = attrs.get("status")
        old_status = self.instance.status if self.instance else None
        if new_status == CompensationStatus.APPROVED and old_status != CompensationStatus.APPROVED:
            if not access.has_role(user, access.COMPENSATION_APPROVERS):
                raise serializers.ValidationError({"status": "Only Admin or Project Manager can approve compensation."})
        if self.instance and old_status == CompensationStatus.APPROVED and not access.has_role(user, access.COMPENSATION_APPROVERS):
            if any(k in attrs and attrs[k] != getattr(self.instance, k) for k in ("approved_amount", "status")):
                raise serializers.ValidationError("Approved compensation can only be changed by Admin or Project Manager.")
        if self.instance and "approved_amount" in attrs and attrs["approved_amount"] < self.instance.paid_amount:
            raise serializers.ValidationError({"approved_amount": f"Cannot be less than the amount already paid ({inr(self.instance.paid_amount)})."})
        if new_status == CompensationStatus.CANCELLED and self.instance and self.instance.paid_amount > 0:
            raise serializers.ValidationError({"status": "Cannot cancel - payments have already been recorded."})
        return attrs

    def save(self, **kwargs):
        if self.validated_data.get("status") == CompensationStatus.APPROVED and (
            self.instance is None or self.instance.status != CompensationStatus.APPROVED
        ):
            kwargs["approved_by"] = _user(self)
            kwargs["approved_on"] = timezone.localdate()
        return super().save(**kwargs)


class PaymentSerializer(BaseSerializer):
    compensation_category = serializers.CharField(source="compensation.get_category_display", read_only=True)
    project_code = serializers.CharField(source="compensation.project.code", read_only=True)
    payee_name = serializers.CharField(source="compensation.payee.name", read_only=True)
    payee_code = serializers.CharField(source="compensation.payee.farmer_code", read_only=True)
    paid_to_name = serializers.CharField(source="paid_to.name", read_only=True, default=None)
    asset_number = serializers.CharField(source="compensation.asset.asset_number", read_only=True, default=None)
    receipt_count = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        exclude = ["is_deleted"]
        read_only_fields = BaseSerializer.BASE_READONLY

    def get_receipt_count(self, obj):
        return len(obj.documents.all())

    def validate(self, attrs):
        comp = attrs.get("compensation") or self.instance.compensation
        if not access.visible_projects(_user(self)).filter(pk=comp.project_id).exists():
            raise serializers.ValidationError({"compensation": "You are not assigned to this project."})
        if comp.status != CompensationStatus.APPROVED:
            raise serializers.ValidationError({"compensation": "Payments can only be recorded against approved compensation."})
        amount = attrs.get("amount", self.instance.amount if self.instance else Decimal("0"))
        already = comp.paid_amount - (self.instance.amount if self.instance else Decimal("0"))
        if already + amount > comp.approved_amount:
            raise serializers.ValidationError(
                {"amount": f"Exceeds the balance. Approved {inr(comp.approved_amount)}, already paid {inr(already)}, balance {inr(comp.approved_amount - already)}."}
            )
        if attrs.get("payment_date") and attrs["payment_date"] > timezone.localdate():
            raise serializers.ValidationError({"payment_date": "Payment date cannot be in the future."})
        if not attrs.get("paid_to") and not (self.instance and self.instance.paid_to_id):
            attrs["paid_to"] = comp.payee
        return attrs


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

class DocumentSerializer(BaseSerializer):
    download_url = serializers.SerializerMethodField()
    can_view = serializers.SerializerMethodField()
    category_label = serializers.CharField(source="get_category_display", read_only=True)

    class Meta:
        model = Document
        exclude = ["is_deleted", "file"]
        read_only_fields = BaseSerializer.BASE_READONLY + [
            "original_name", "content_type", "size_bytes", "is_sensitive", "is_encrypted",
        ]

    def get_can_view(self, obj):
        return access.can_view_document_file(_user(self), obj)

    def get_download_url(self, obj):
        user = _user(self)
        if not user or not self.get_can_view(obj):
            return None
        from .documents import signed_download_url
        return signed_download_url(obj, user)


# ---------------------------------------------------------------------------
# Users, audit, settings
# ---------------------------------------------------------------------------

class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    project_ids = UUIDListField(write_only=True, required=False)
    projects = serializers.SerializerMethodField()
    role_label = serializers.CharField(source="get_role_display", read_only=True)
    display_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = [
            "id", "username", "first_name", "last_name", "email", "phone", "role", "role_label", "is_active",
            "password", "project_ids", "projects", "display_name", "last_login", "date_joined",
        ]
        read_only_fields = ["last_login", "date_joined"]

    def get_projects(self, obj):
        return [_project_brief(p) for p in obj.projects.all()]

    def validate_password(self, value):
        if value:
            from django.contrib.auth.password_validation import validate_password
            validate_password(value)
        return value

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        project_ids = validated_data.pop("project_ids", None)
        if not password:
            raise serializers.ValidationError({"password": "Password is required for a new user."})
        user = User(**validated_data)
        req_user = _user(self)
        user.company = getattr(req_user, "company", None)
        user.set_password(password)
        user.save()
        if project_ids is not None:
            user.projects.set(project_ids)
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        project_ids = validated_data.pop("project_ids", None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        if password:
            instance.set_password(password)
        instance.save()
        if project_ids is not None:
            instance.projects.set(project_ids)
        return instance


class MeSerializer(serializers.ModelSerializer):
    role_label = serializers.CharField(source="get_role_display", read_only=True)
    display_name = serializers.CharField(read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True, default=None)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "email", "phone", "role", "role_label",
                  "display_name", "company_name", "permissions"]

    def get_permissions(self, obj):
        perms = {}
        for res in access.MATRIX:
            perms[res] = {a: access.can(obj, res, a) for a in ("read", "write", "delete")}
        perms["compensation"]["approve"] = access.has_role(obj, access.COMPENSATION_APPROVERS)
        perms["bank"] = {"read": access.has_role(obj, access.BANK_DETAIL_READERS), "write": access.has_role(obj, access.BANK_DETAIL_WRITERS)}
        perms["kyc"] = {"verify": access.has_role(obj, access.KYC_VERIFIERS)}
        perms["stages"] = {
            s.code: access.can_edit_stage(obj, s) for s in StageDefinition.objects.filter(is_active=True)
        }
        return perms


class AuditLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = "__all__"

    def get_user_name(self, obj):
        return obj.user.display_name if obj.user else "system"


class AppSettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = AppSetting
        fields = "__all__"
