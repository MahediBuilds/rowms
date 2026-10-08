from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from . import models as m


@admin.register(m.User)
class UserAdmin(BaseUserAdmin):
    fieldsets = BaseUserAdmin.fieldsets + (("ROW system", {"fields": ("role", "phone", "company", "projects")}),)
    list_display = ("username", "first_name", "last_name", "role", "is_active")
    list_filter = ("role", "is_active")
    filter_horizontal = ("projects", "groups", "user_permissions")


for model in (m.Company, m.Project, m.Farmer, m.LandParcel, m.LandOwnership, m.Asset, m.StageDefinition,
              m.AssetMilestone, m.Agreement, m.CropAssessment, m.Compensation, m.Payment, m.Document, m.AppSetting):
    admin.site.register(model)


@admin.register(m.AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("timestamp", "user", "action", "model_name", "object_repr", "source")
    list_filter = ("action", "model_name", "source")
    readonly_fields = [f.name for f in m.AuditLog._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
