"""Offline sync API for the Android field app.

Protocol (deliberately simple, last-write-wins):

* ``GET /api/sync/pull?since=<server_time>&scope=<scope_hash>``
  Returns every record the user can see that changed since ``since`` (including
  soft-deleted ones so the device can remove them). If the user's project
  assignments changed (``scope`` differs) a full snapshot is returned with
  ``full: true``.

* ``POST /api/sync/push``  ``{"ops": [{"op_id", "entity", "action", "data"}]}``
  Applies queued offline changes in order. ``action`` is ``create`` (full record),
  ``update`` (changed fields only - refused if the record does not exist),
  ``upsert`` or ``delete``. Each ``op_id`` is processed at most
  once, so a device can safely retry after a dropped connection. Records are
  matched by UUID, except milestones (asset + stage) and land ownerships
  (land + farmer) which are matched by their natural key; the response returns
  the server id so the device can re-map its local id.

* Photos/documents are uploaded separately to ``POST /api/documents/`` with a
  client-generated ``id`` (idempotent).
"""
import hashlib
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import serializers as drf_serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from . import access, services
from . import serializers as s
from .models import (
    AppSetting, Asset, AssetMilestone, AuditLog, CropAssessment, Farmer, LandOwnership, LandParcel,
    Project, SyncOperation,
)

CURSOR_OVERLAP_MINUTES = 5

ENTITIES = {
    # entity: (model, serializer, resource, flat fields)
    "farmer": (Farmer, s.FarmerSerializer, "farmer", [
        "id", "farmer_code", "name", "relation_type", "relation_name", "mobile", "alt_mobile", "address",
        "village", "hobli", "taluk", "district", "state", "status", "aadhaar_last4", "kyc_status",
        "kyc_collected_on", "remarks", "updated_at", "is_deleted",
    ]),
    "land": (LandParcel, s.LandParcelSerializer, "land", [
        "id", "survey_number", "hissa", "village", "hobli", "taluk", "district", "state", "extent_acres",
        "extent_guntas", "ownership_type", "land_type", "rtc_reference", "latitude", "longitude",
        "gps_accuracy_m", "gps_captured_at", "remarks", "updated_at", "is_deleted",
    ]),
    "ownership": (LandOwnership, s.LandOwnershipSerializer, "ownership", [
        "id", "land_id", "farmer_id", "is_primary_payee", "updated_at", "is_deleted",
    ]),
    "asset": (Asset, s.AssetSerializer, "asset", [
        "id", "project_id", "asset_type", "asset_number", "line_name", "land_parcel_id", "latitude", "longitude",
        "gps_accuracy_m", "gps_captured_at", "remarks", "updated_at", "is_deleted",
    ]),
    "milestone": (AssetMilestone, s.AssetMilestoneSerializer, "milestone", [
        "id", "asset_id", "stage_code", "completed", "completed_on", "source", "remarks", "latitude",
        "longitude", "gps_accuracy_m", "updated_at", "is_deleted",
    ]),
    "crop": (CropAssessment, s.CropAssessmentSerializer, "crop", [
        "id", "project_id", "farmer_id", "land_parcel_id", "asset_id", "season", "crop_type", "crop_area_acres",
        "crop_stage", "assessment_date", "field_inspection_notes", "revenue_assessment", "company_assessment",
        "latitude", "longitude", "gps_accuracy_m", "gps_captured_at", "updated_at", "is_deleted",
    ]),
}
M2M_FLAT = {"farmer": "projects", "land": "projects"}


def _plain(v):
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v) if not hasattr(v, "as_tuple") else float(v)


def flat(entity, obj):
    _, _, _, fields = ENTITIES[entity]
    row = {f: _plain(getattr(obj, f)) for f in fields}
    if entity in M2M_FLAT:
        row["project_ids"] = [str(p) for p in getattr(obj, M2M_FLAT[entity]).values_list("id", flat=True)]
    return row


def scope_hash(user):
    ids = sorted(str(i) for i in access.visible_projects(user).values_list("id", flat=True))
    return hashlib.sha1((user.role + "|" + ",".join(ids)).encode()).hexdigest()[:16]


class SyncPullView(APIView):
    def get(self, request):
        user = request.user
        started = timezone.now()
        current_scope = scope_hash(user)
        raw_since = (request.query_params.get("since") or "").replace(" ", "+")  # tolerate an unencoded "+"
        since = parse_datetime(raw_since) if raw_since else None
        full = since is None or request.query_params.get("scope") != current_scope

        # The cursor handed back overlaps by a few minutes so rows committed by a slow
        # transaction that started before this request are not missed. Receiving a row twice is harmless.
        data = {"server_time": (started - timedelta(minutes=CURSOR_OVERLAP_MINUTES)).isoformat(), "scope": current_scope, "full": full}
        projects = access.visible_projects(user)
        data["projects"] = [
            {"id": str(p.id), "code": p.code, "name": p.name, "project_type": p.project_type,
             "voltage_level": p.voltage_level, "district": p.district, "taluk": p.taluk, "status": p.status}
            for p in projects
        ]
        for entity, (model, _, resource, _) in ENTITIES.items():
            if not access.can(user, resource, "read"):
                data[entity] = []
                continue
            qs = access.scope_queryset(user, model.all_objects.all())
            if full:
                qs = qs.filter(is_deleted=False)
            else:
                qs = qs.filter(updated_at__gte=since)
            if entity in M2M_FLAT:
                qs = qs.prefetch_related(M2M_FLAT[entity])
            data[entity] = [flat(entity, o) for o in qs]
        data["stages"] = s.StageDefinitionSerializer(services.active_stages(), many=True).data
        data["settings"] = {k: AppSetting.get(k) for k in AppSetting.DEFAULTS}
        data["me"] = s.MeSerializer(user).data
        from .views import choice_lists
        data["choices"] = choice_lists()
        return Response(data)


def _first_error(detail):
    if isinstance(detail, dict):
        for k, v in detail.items():
            msg = _first_error(v)
            return msg if k in ("non_field_errors", "detail") else f"{k}: {msg}"
    if isinstance(detail, list) and detail:
        return _first_error(detail[0])
    return str(detail)


class SyncPushView(APIView):
    def post(self, request):
        ops = request.data.get("ops") or []
        if not isinstance(ops, list) or len(ops) > 500:
            raise ValidationError("ops must be a list of at most 500 operations")
        results = [self.apply(request, op) for op in ops]
        return Response({"server_time": timezone.now().isoformat(), "results": results})

    def apply(self, request, op):
        user = request.user
        op_id = op.get("op_id")
        entity = op.get("entity")
        action = op.get("action", "upsert")
        data = dict(op.get("data") or {})
        base = {"op_id": op_id, "entity": entity}
        if not op_id or entity not in ENTITIES:
            return {**base, "ok": False, "error": "Invalid operation"}
        done = SyncOperation.objects.filter(op_id=op_id).first()
        if done:
            return {**(done.response or base), "duplicate": True}

        if action not in ("create", "update", "upsert", "delete"):
            return {**base, "ok": False, "error": f"Unknown action '{action}'"}
        model, serializer_cls, resource, _ = ENTITIES[entity]
        # Accept "asset_id" style keys (as sent in pull) as well as "asset".
        fk_names = {f.name for f in model._meta.fields if f.is_relation}
        for key in list(data):
            if key.endswith("_id") and key[:-3] in fk_names:
                data[key[:-3]] = data.pop(key)
        for key in ("updated_at", "is_deleted", "farmer_code", "source", "created_at"):
            data.pop(key, None)
        try:
            with transaction.atomic():
                if action == "delete":
                    if not access.can(user, resource, "delete"):
                        raise PermissionDenied("Your role cannot delete this record.")
                    obj = access.scope_queryset(user, model.objects.filter(pk=data.get("id"))).first()
                    if obj:
                        obj.is_deleted = True
                        obj.updated_by = user
                        obj.save()
                        services.audit(user, AuditLog.Action.DELETE, obj, request=request, source="MOBILE")
                    result = {**base, "ok": True, "id": data.get("id"), "record": None}
                else:
                    if not access.can(user, resource, "write"):
                        raise PermissionDenied("Your role cannot change this record.")
                    obj = self.find_existing(user, entity, model, data)
                    if obj is None and action == "update":
                        # never turn a partial edit into a new, incomplete record
                        raise drf_serializers.ValidationError(
                            "This record is not on the server (it may have been deleted in the office). Discard this change and re-download."
                        )
                    ctx = {"request": request, "user": user}
                    if entity == "asset":
                        ctx["stages"] = services.active_stages()
                    before = services.snapshot(obj)
                    if obj is not None:
                        data.pop("id", None)
                        obj.is_deleted = False
                        ser = serializer_cls(obj, data=data, partial=True, context=ctx)
                        ser.is_valid(raise_exception=True)
                        obj = ser.save(updated_by=user)
                        act = AuditLog.Action.UPDATE
                    else:
                        ser = serializer_cls(data=data, context=ctx)
                        ser.is_valid(raise_exception=True)
                        obj = ser.save(created_by=user, updated_by=user)
                        act = AuditLog.Action.CREATE
                    services.audit(user, act, obj, services.diff(before, services.snapshot(obj)), request=request, source="MOBILE")
                    obj.refresh_from_db()
                    result = {**base, "ok": True, "id": str(obj.pk), "record": flat(entity, obj)}
                SyncOperation.objects.create(op_id=op_id, user=user, entity=entity, object_id=str(result.get("id") or ""),
                                             ok=True, response=result)
                return result
        except (ValidationError, drf_serializers.ValidationError) as e:
            return {**base, "ok": False, "error": _first_error(e.detail), "errors": e.detail}
        except PermissionDenied as e:
            return {**base, "ok": False, "error": str(e.detail)}
        except IntegrityError as e:
            return {**base, "ok": False, "error": f"Conflict with existing data ({e.__class__.__name__})"}

    @staticmethod
    def find_existing(user, entity, model, data):
        obj = None
        if data.get("id"):
            obj = model.all_objects.filter(pk=data["id"]).first()
            if obj is not None and not access.scope_queryset(user, model.all_objects.filter(pk=obj.pk)).exists():
                raise PermissionDenied("You do not have access to this record.")
        if obj is None and entity == "milestone" and data.get("asset") and data.get("stage_code"):
            obj = model.all_objects.filter(asset_id=data["asset"], stage_code=data["stage_code"]).first()
        if obj is None and entity == "ownership" and data.get("land") and data.get("farmer"):
            obj = model.all_objects.filter(land_id=data["land"], farmer_id=data["farmer"]).first()
        return obj
