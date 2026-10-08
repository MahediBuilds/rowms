"""Business logic shared by the web API, the sync API and reports."""
from collections import defaultdict
from datetime import date
from decimal import Decimal

from django.db.models import Max, Prefetch, Q, Sum
from django.forms.models import model_to_dict
from django.utils import timezone

from .models import (
    EXECUTED_STATUSES, Agreement, Asset, AssetMilestone, AuditLog, Compensation,
    CompensationStatus, Farmer, LandOwnership, Payment, StageDefinition, StageScope,
)

DEFAULT_STAGES = [
    # code, name, order, scope
    ("SURVEYED", "Farmer Location Surveyed", 1, StageScope.ASSET),
    ("KYC", "KYC Collected", 2, StageScope.FARMER),
    ("AGREEMENT", "Agreement Executed", 3, StageScope.ASSET),
    ("PAYMENT", "Payment Made", 4, StageScope.ASSET),
    ("ERECTION", "Pole Erection Completed", 5, StageScope.ASSET),
    ("STRINGING", "Stringing Completed", 6, StageScope.ASSET),
    ("STAYWIRE", "Staywire & Accessories Completed", 7, StageScope.ASSET),
]


def ensure_default_stages():
    for code, name, order, scope in DEFAULT_STAGES:
        StageDefinition.objects.get_or_create(code=code, defaults={"name": name, "order": order, "scope": scope})


def active_stages(asset_type=None):
    stages = list(StageDefinition.objects.filter(is_active=True).order_by("order"))
    if asset_type:
        stages = [s for s in stages if not s.asset_types or asset_type in s.asset_types]
    return stages


# ---------------------------------------------------------------------------
# Progress
# ---------------------------------------------------------------------------

def assets_with_progress_prefetch(qs):
    return qs.select_related("project", "land_parcel").prefetch_related(
        Prefetch("milestones", queryset=AssetMilestone.objects.all()),
        Prefetch(
            "land_parcel__ownerships",
            queryset=LandOwnership.objects.select_related("farmer"),
        ),
    )


def asset_farmers(asset):
    if not asset.land_parcel_id:
        return []
    return [o.farmer for o in asset.land_parcel.ownerships.all() if not o.farmer.is_deleted]


def asset_progress(asset, stages=None):
    """Return the per-stage progress for one asset/location."""
    stages = stages if stages is not None else active_stages(asset.asset_type)
    milestones = {m.stage_code: m for m in asset.milestones.all()}
    farmers = asset_farmers(asset)
    items = []
    for stage in stages:
        if stage.asset_types and asset.asset_type not in stage.asset_types:
            continue
        if stage.scope == StageScope.FARMER:
            done = sum(1 for f in farmers if f.kyc_done)
            total = len(farmers)
            items.append({
                "code": stage.code, "name": stage.name, "scope": stage.scope,
                "completed": total > 0 and done == total,
                "partial": 0 < done < total,
                "detail": f"{done}/{total} farmers" if total else "No farmer linked",
                "completed_on": None, "source": "DERIVED", "milestone_id": None,
            })
        else:
            m = milestones.get(stage.code)
            items.append({
                "code": stage.code, "name": stage.name, "scope": stage.scope,
                "completed": bool(m and m.completed),
                "partial": False,
                "detail": (m.remarks if m else "") or "",
                "completed_on": m.completed_on.isoformat() if m and m.completed and m.completed_on else None,
                "source": m.source if m else None,
                "milestone_id": str(m.id) if m else None,
            })
    done = sum(1 for i in items if i["completed"])
    latest = None
    for i in items:
        if i["completed"]:
            latest = i["name"]
    return {
        "stages": items,
        "completed_count": done,
        "total": len(items),
        "percent": round(100 * done / len(items)) if items else 0,
        "latest_completed": latest,
    }


def set_milestone(asset, stage_code, completed, *, user=None, completed_on=None, source="MANUAL", remarks=None,
                  lat=None, lng=None, accuracy=None):
    m, created = AssetMilestone.all_objects.get_or_create(
        asset=asset, stage_code=stage_code, defaults={"created_by": user}
    )
    m.is_deleted = False
    m.completed = completed
    m.completed_on = (completed_on or timezone.localdate()) if completed else None
    m.source = source
    if remarks is not None:
        m.remarks = remarks
    if lat is not None:
        m.latitude, m.longitude, m.gps_accuracy_m, m.gps_captured_at = lat, lng, accuracy, timezone.now()
    m.updated_by = user
    m.save()
    return m


def _auto_update(asset, stage_code, should_complete, completed_on, user):
    m = AssetMilestone.objects.filter(asset=asset, stage_code=stage_code).first()
    if should_complete:
        if not m or not m.completed:
            set_milestone(asset, stage_code, True, user=user, completed_on=completed_on, source="AUTO",
                          remarks="Updated automatically")
    else:
        # Only undo what the system set itself; never override a manual entry.
        if m and m.completed and m.source == "AUTO":
            set_milestone(asset, stage_code, False, user=user, source="AUTO", remarks="")


def refresh_agreement_milestones(agreement, user=None):
    assets = list(agreement.assets.all())
    if not assets and agreement.land_parcel_id:
        assets = list(Asset.objects.filter(project=agreement.project_id, land_parcel=agreement.land_parcel_id))
    for asset in assets:
        executed = Agreement.objects.filter(status__in=EXECUTED_STATUSES).filter(assets=asset)
        executed_land = Agreement.objects.filter(
            status__in=EXECUTED_STATUSES, project=asset.project_id, land_parcel=asset.land_parcel_id, assets__isnull=True
        ) if asset.land_parcel_id else Agreement.objects.none()
        first = executed.order_by("agreement_date").first() or executed_land.order_by("agreement_date").first()
        _auto_update(asset, "AGREEMENT", first is not None, first.agreement_date if first else None, user)


def refresh_payment_milestone(asset, user=None):
    if asset is None:
        return
    comps = Compensation.objects.filter(asset=asset, status=CompensationStatus.APPROVED)
    approved = comps.aggregate(s=Sum("approved_amount"))["s"] or Decimal("0")
    paid = Payment.objects.filter(compensation__in=comps).aggregate(s=Sum("amount"))["s"] or Decimal("0")
    last = Payment.objects.filter(compensation__in=comps).aggregate(d=Max("payment_date"))["d"]
    _auto_update(asset, "PAYMENT", approved > 0 and paid >= approved, last, user)


# ---------------------------------------------------------------------------
# Money helpers
# ---------------------------------------------------------------------------

def annotate_paid(qs):
    return qs.annotate(_paid_amount=Sum("payments__amount", filter=Q(payments__is_deleted=False)))


def compensation_totals(qs):
    approved = qs.filter(status=CompensationStatus.APPROVED).aggregate(s=Sum("approved_amount"))["s"] or Decimal("0")
    paid = Payment.objects.filter(
        compensation__in=qs.filter(status=CompensationStatus.APPROVED)
    ).aggregate(s=Sum("amount"))["s"] or Decimal("0")
    proposed = qs.filter(status=CompensationStatus.PROPOSED).aggregate(s=Sum("approved_amount"))["s"] or Decimal("0")
    return {"approved": approved, "paid": paid, "balance": approved - paid, "proposed": proposed}


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

SECRET_FIELDS = {"bank_account_number", "password"}


def snapshot(instance):
    if instance is None:
        return {}
    data = model_to_dict(instance)
    for k, v in list(data.items()):
        if k in SECRET_FIELDS:
            data[k] = "****" if v else ""
        elif hasattr(v, "pk"):
            data[k] = str(v.pk)
        elif isinstance(v, list):
            data[k] = sorted(str(getattr(x, "pk", x)) for x in v)
        elif isinstance(v, (date, Decimal)):
            data[k] = str(v)
        elif hasattr(v, "name") and hasattr(v, "url"):  # file field
            data[k] = v.name if v else ""
        elif not isinstance(v, (str, int, float, bool, type(None), dict)):
            data[k] = str(v)
    return data


def diff(before, after):
    changes = {}
    for k in set(before) | set(after):
        if before.get(k) != after.get(k):
            changes[k] = [before.get(k), after.get(k)]
    return changes


def client_ip(request):
    if request is None:
        return None
    fwd = request.META.get("HTTP_X_FORWARDED_FOR")
    return (fwd.split(",")[0].strip() if fwd else request.META.get("REMOTE_ADDR")) or None


def audit(user, action, instance=None, changes=None, *, request=None, source="WEB", model_name=None, object_id=None, repr_=None):
    AuditLog.objects.create(
        user=user if user and user.is_authenticated else None,
        action=action,
        model_name=model_name or (instance.__class__.__name__ if instance is not None else ""),
        object_id=object_id or (str(instance.pk) if instance is not None else ""),
        object_repr=(repr_ or (str(instance) if instance is not None else ""))[:300],
        changes=changes or None,
        source=source,
        ip_address=client_ip(request),
    )


# ---------------------------------------------------------------------------
# Farmer lifetime history
# ---------------------------------------------------------------------------

def inr(amount):
    """Format a rupee amount with Indian digit grouping, e.g. 1234567.5 -> Rs 12,34,567.50"""
    amount = Decimal(amount or 0).quantize(Decimal("0.01"))
    whole, frac = f"{abs(amount):.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    sign = "-" if amount < 0 else ""
    return f"{sign}\u20b9{whole}" + (f".{frac}" if frac != "00" else "")


def farmer_history(farmer):
    """Chronological events across all projects for one farmer."""
    events = []
    events.append({"date": farmer.created_at.date().isoformat(), "type": "REGISTERED", "title": f"Registered as {farmer.farmer_code}", "project": None})
    if farmer.kyc_collected_on:
        events.append({"date": farmer.kyc_collected_on.isoformat(), "type": "KYC", "title": "KYC collected", "project": None})
    if farmer.kyc_verified_on:
        events.append({"date": farmer.kyc_verified_on.isoformat(), "type": "KYC", "title": "KYC verified", "project": None})
    for o in farmer.ownerships.select_related("land").all():
        events.append({"date": o.created_at.date().isoformat(), "type": "LAND", "title": f"Linked to Sy.No. {o.land.survey_label}, {o.land.village}" + (" (primary payee)" if o.is_primary_payee else ""), "project": None})
        for a in o.land.assets.select_related("project").all():
            events.append({"date": a.created_at.date().isoformat(), "type": "ASSET", "title": f"{a.get_asset_type_display()} {a.asset_number} on Sy.No. {o.land.survey_label}", "project": a.project.code})
            for m in a.milestones.filter(completed=True):
                if m.stage_code in ("AGREEMENT", "PAYMENT"):
                    continue
                stage = StageDefinition.objects.filter(code=m.stage_code).first()
                events.append({"date": (m.completed_on or m.updated_at.date()).isoformat(), "type": "PROGRESS", "title": f"{a.asset_number}: {stage.name if stage else m.stage_code}", "project": a.project.code})
    for ag in farmer.agreements.select_related("project").all():
        events.append({"date": (ag.agreement_date or ag.created_at.date()).isoformat(), "type": "AGREEMENT", "title": f"{ag.get_agreement_type_display()} agreement {ag.agreement_number} - {ag.get_status_display()}", "project": ag.project.code})
    for c in farmer.crop_assessments.select_related("project").all():
        events.append({"date": (c.assessment_date or c.created_at.date()).isoformat(), "type": "CROP", "title": f"Crop assessment: {c.crop_type}", "project": c.project.code})
    for c in farmer.compensations.select_related("project").all():
        events.append({"date": (c.approved_on or c.created_at.date()).isoformat(), "type": "COMPENSATION", "title": f"{c.get_category_display()} {c.get_status_display().lower()}: {inr(c.approved_amount)}", "project": c.project.code})
        for p in c.payments.all():
            events.append({"date": p.payment_date.isoformat(), "type": "PAYMENT", "title": f"Payment {inr(p.amount)} ({p.get_mode_display()}{', ' + p.reference_number if p.reference_number else ''})", "project": c.project.code})
    events.sort(key=lambda e: e["date"])
    return events
