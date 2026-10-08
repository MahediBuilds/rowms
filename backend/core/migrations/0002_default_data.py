from django.db import migrations

STAGES = [
    ("SURVEYED", "Farmer Location Surveyed", 1, "ASSET"),
    ("KYC", "KYC Collected", 2, "FARMER"),
    ("AGREEMENT", "Agreement Executed", 3, "ASSET"),
    ("PAYMENT", "Payment Made", 4, "ASSET"),
    ("ERECTION", "Pole Erection Completed", 5, "ASSET"),
    ("STRINGING", "Stringing Completed", 6, "ASSET"),
    ("STAYWIRE", "Staywire & Accessories Completed", 7, "ASSET"),
]


def forwards(apps, schema_editor):
    Stage = apps.get_model("core", "StageDefinition")
    for code, name, order, scope in STAGES:
        Stage.objects.get_or_create(code=code, defaults={"name": name, "order": order, "scope": scope})
    Setting = apps.get_model("core", "AppSetting")
    Setting.objects.get_or_create(
        key="GPS_ACCURACY_WARNING_METERS",
        defaults={"value": 15, "description": "Show a warning on the field app when GPS accuracy is worse than this (metres)"},
    )
    Company = apps.get_model("core", "Company")
    Company.objects.get_or_create(code="IPOWER", defaults={"name": "Ipower Engineering Services LLP"})


class Migration(migrations.Migration):
    dependencies = [("core", "0001_initial")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
