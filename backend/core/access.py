"""Role-based access rules and project-level data scoping.

Everything about "who can see / change what" lives in this one file so the
rules are easy to review and adjust.
"""
from django.db.models import Q
from rest_framework.permissions import SAFE_METHODS, BasePermission

from .models import (
    Agreement, Asset, AssetMilestone, Compensation, CropAssessment, Document,
    DocumentCategory, Farmer, LandOwnership, LandParcel, Payment, Project, Role,
)

A, PM, ROW, SV, FIN, MGMT = (
    Role.ADMIN, Role.PROJECT_MANAGER, Role.ROW_OFFICER, Role.SURVEYOR, Role.FINANCE, Role.MANAGEMENT,
)
INTERNAL = {A, PM, ROW, SV, FIN, MGMT}

# resource -> (roles that can read, roles that can create/update, roles that can delete)
MATRIX = {
    "project":      (INTERNAL,              {A, PM},              {A}),
    "farmer":       (INTERNAL,              {A, PM, ROW, SV},     {A, PM}),
    "land":         (INTERNAL,              {A, PM, ROW, SV},     {A, PM}),
    "ownership":    (INTERNAL,              {A, PM, ROW, SV},     {A, PM, ROW, SV}),
    "asset":        (INTERNAL,              {A, PM, ROW, SV},     {A, PM}),
    "milestone":    (INTERNAL,              {A, PM, ROW, SV, FIN}, {A, PM}),
    "agreement":    (INTERNAL,              {A, PM, ROW},         {A, PM}),
    "crop":         (INTERNAL,              {A, PM, ROW, SV},     {A, PM}),
    "compensation": ({A, PM, ROW, FIN, MGMT}, {A, PM, ROW},       {A, PM}),
    "payment":      ({A, PM, ROW, FIN, MGMT}, {A, FIN},           {A, FIN}),
    "document":     (INTERNAL,              {A, PM, ROW, SV, FIN}, {A, PM, ROW}),
    "user":         ({A},                   {A},                  {A}),
    "audit":        ({A},                   set(),                set()),
    "settings":     (INTERNAL,              {A},                  set()),
    "report":       ({A, PM, ROW, FIN, MGMT}, set(),              set()),
}

# Finer-grained rules
COMPENSATION_APPROVERS = {A, PM}
BANK_DETAIL_READERS = {A, FIN, ROW}
BANK_DETAIL_WRITERS = {A, FIN, ROW}
KYC_VERIFIERS = {A, PM, ROW}
SENSITIVE_DOC_READERS = {
    DocumentCategory.KYC_AADHAAR: {A, PM, ROW},
    DocumentCategory.KYC_OTHER: {A, PM, ROW},
    DocumentCategory.BANK_PROOF: {A, PM, ROW, FIN},
}
# Default editors per progress stage (can be overridden by StageDefinition.edit_roles)
STAGE_EDITORS = {
    "AGREEMENT": {A, PM, ROW},
    "PAYMENT": {A, PM, FIN},
}
DEFAULT_STAGE_EDITORS = {A, PM, ROW, SV}
# Roles that see every project in the company; others only see assigned projects.
ALL_PROJECT_ROLES = {A, MGMT, FIN}


def can(user, resource, action="read"):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    read, write, delete = MATRIX[resource]
    roles = {"read": read, "write": write, "delete": delete}[action]
    return user.role in roles


def has_role(user, roles):
    return bool(user and user.is_authenticated and (user.is_superuser or user.role in roles))


def can_edit_stage(user, stage):
    roles = set(stage.edit_roles) if stage and stage.edit_roles else STAGE_EDITORS.get(stage.code if stage else "", DEFAULT_STAGE_EDITORS)
    return has_role(user, roles)


def can_view_document_file(user, document):
    if not document.is_sensitive:
        return can(user, "document", "read")
    return has_role(user, SENSITIVE_DOC_READERS.get(document.category, {A}))


class ResourcePermission(BasePermission):
    """DRF permission using the MATRIX above. Views set ``resource = '<name>'``."""

    def has_permission(self, request, view):
        resource = getattr(view, "resource", None)
        if resource is None:
            return request.user and request.user.is_authenticated
        if request.method in SAFE_METHODS:
            return can(request.user, resource, "read")
        if request.method == "DELETE":
            return can(request.user, resource, "delete")
        return can(request.user, resource, "write")


# ---------------------------------------------------------------------------
# Project scoping
# ---------------------------------------------------------------------------

def visible_projects(user):
    qs = Project.objects.all()
    if user.is_superuser or user.role in ALL_PROJECT_ROLES:
        if user.company_id and not user.is_superuser:
            qs = qs.filter(Q(company_id=user.company_id) | Q(company__isnull=True))
        return qs
    return qs.filter(id__in=user.projects.values("id"))


def scope_queryset(user, qs):
    """Restrict any business queryset to the projects the user can see."""
    model = qs.model
    if user.is_superuser or (user.role in ALL_PROJECT_ROLES and not user.company_id):
        return qs
    projects = visible_projects(user).values("id")
    if model is Project:
        return qs.filter(id__in=projects)
    if model is Farmer:
        return qs.filter(Q(projects__in=projects) | Q(created_by=user)).distinct()
    if model is LandParcel:
        return qs.filter(Q(projects__in=projects) | Q(created_by=user)).distinct()
    if model is LandOwnership:
        return qs.filter(Q(land__projects__in=projects) | Q(farmer__projects__in=projects) | Q(created_by=user)).distinct()
    if model in (Asset, Agreement, Compensation, CropAssessment):
        return qs.filter(project__in=projects)
    if model is AssetMilestone:
        return qs.filter(asset__project__in=projects)
    if model is Payment:
        return qs.filter(compensation__project__in=projects)
    if model is Document:
        return qs.filter(
            Q(project__in=projects) | Q(farmer__projects__in=projects) | Q(land_parcel__projects__in=projects) | Q(created_by=user)
        ).distinct()
    return qs
