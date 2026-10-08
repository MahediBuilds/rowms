"""
Data model for the Farmer ROW & Land Compensation Management System (prototype).

Design notes
------------
* Every business record uses a UUID primary key so the Android app can create
  records offline and sync them later without ID clashes.
* Records are soft-deleted (``is_deleted``) so deletions can be synchronised
  to field devices.
* ``Company`` exists so the system can become multi-company later; the
  prototype runs with a single company (Ipower Engineering Services LLP).
* Coordinates are stored as plain decimal latitude/longitude plus optional
  GeoJSON boundaries. This keeps local setup simple; PostGIS geometry columns
  can be added later when spatial queries are needed.
"""
import uuid
from decimal import Decimal

from django.contrib.auth.models import AbstractUser
from django.core.validators import MinValueValidator, RegexValidator
from django.db import models, transaction
from django.db.models import Sum

from .crypto import EncryptedTextField


# ---------------------------------------------------------------------------
# Base classes
# ---------------------------------------------------------------------------

class ActiveManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False)


class BaseModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)
    created_by = models.ForeignKey(
        "core.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    updated_by = models.ForeignKey(
        "core.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    is_deleted = models.BooleanField(default=False, db_index=True)

    objects = ActiveManager()
    all_objects = models.Manager()

    class Meta:
        abstract = True


class Counter(models.Model):
    """Simple named counters used for human-readable IDs (FRM-000001 etc.)."""

    name = models.CharField(max_length=50, primary_key=True)
    value = models.PositiveIntegerField(default=0)

    @classmethod
    def next(cls, name):
        with transaction.atomic():
            counter, _ = cls.objects.select_for_update().get_or_create(name=name)
            counter.value += 1
            counter.save(update_fields=["value"])
            return counter.value


LOCATION_FIELDS_HELP = "Decimal degrees (WGS84)"


class GPSMixin(models.Model):
    latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True, help_text=LOCATION_FIELDS_HELP)
    longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True, help_text=LOCATION_FIELDS_HELP)
    gps_accuracy_m = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True, help_text="Reported GPS accuracy in metres")
    gps_captured_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        abstract = True


class AddressMixin(models.Model):
    village = models.CharField(max_length=120, blank=True)
    hobli = models.CharField(max_length=120, blank=True)
    taluk = models.CharField(max_length=120, blank=True)
    district = models.CharField(max_length=120, blank=True)
    state = models.CharField(max_length=120, blank=True, default="Karnataka")

    class Meta:
        abstract = True


# ---------------------------------------------------------------------------
# Company, users and roles
# ---------------------------------------------------------------------------

class Company(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=20, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = "companies"

    def __str__(self):
        return self.name


class Role(models.TextChoices):
    ADMIN = "ADMIN", "Company Administrator"
    PROJECT_MANAGER = "PROJECT_MANAGER", "Project Manager"
    ROW_OFFICER = "ROW_OFFICER", "Land / ROW Officer"
    SURVEYOR = "SURVEYOR", "Field Surveyor"
    FINANCE = "FINANCE", "Finance User"
    MANAGEMENT = "MANAGEMENT", "Management"
    FARMER = "FARMER", "Farmer User"


class User(AbstractUser):
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.SURVEYOR)
    phone = models.CharField(max_length=15, blank=True)
    company = models.ForeignKey(Company, null=True, blank=True, on_delete=models.SET_NULL, related_name="users")
    projects = models.ManyToManyField("core.Project", blank=True, related_name="assigned_users",
                                      help_text="Projects this user is assigned to")
    farmer = models.OneToOneField("core.Farmer", null=True, blank=True, on_delete=models.SET_NULL,
                                  related_name="user_account", help_text="For future Farmer User logins")

    @property
    def display_name(self):
        return self.get_full_name() or self.username


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

class ProjectType(models.TextChoices):
    SOLAR = "SOLAR", "Solar"
    WIND = "WIND", "Wind"
    TRANSMISSION = "TRANSMISSION", "Transmission Line"
    DISTRIBUTION = "DISTRIBUTION", "Distribution / Evacuation Line"
    SUBSTATION = "SUBSTATION", "Substation"
    ROAD = "ROAD", "Access / Approach Road"
    OTHER = "OTHER", "Other"


class VoltageLevel(models.TextChoices):
    NA = "", "Not applicable"
    KV11 = "11KV", "11 kV"
    KV33 = "33KV", "33 kV"
    KV66 = "66KV", "66 kV"
    KV110 = "110KV", "110 kV"
    KV220 = "220KV", "220 kV"
    KV400 = "400KV", "400 kV"


class ProjectStatus(models.TextChoices):
    PLANNING = "PLANNING", "Planning"
    ACTIVE = "ACTIVE", "Active"
    ON_HOLD = "ON_HOLD", "On hold"
    COMPLETED = "COMPLETED", "Completed"


class Project(BaseModel, AddressMixin):
    company = models.ForeignKey(Company, null=True, blank=True, on_delete=models.PROTECT, related_name="projects")
    code = models.CharField(max_length=40, unique=True)
    name = models.CharField(max_length=200)
    developer = models.CharField("Developer / Client", max_length=200, blank=True)
    project_type = models.CharField(max_length=20, choices=ProjectType.choices, default=ProjectType.TRANSMISSION)
    voltage_level = models.CharField(max_length=10, choices=VoltageLevel.choices, blank=True, default="")
    corridor = models.CharField("Corridor / Route", max_length=200, blank=True)
    status = models.CharField(max_length=20, choices=ProjectStatus.choices, default=ProjectStatus.ACTIVE)
    start_date = models.DateField(null=True, blank=True)
    description = models.TextField(blank=True)
    route_geojson = models.JSONField(null=True, blank=True, help_text="Corridor / route line(s) as GeoJSON geometry (e.g. from KML import)")

    class Meta:
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} - {self.name}"


# ---------------------------------------------------------------------------
# Farmers and KYC
# ---------------------------------------------------------------------------

class FarmerStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    INACTIVE = "INACTIVE", "Inactive"
    JOINT_OWNER = "JOINT_OWNER", "Joint owner"
    CLAIMANT = "CLAIMANT", "Claimant"
    DECEASED = "DECEASED", "Deceased (legal heirs)"


class KYCStatus(models.TextChoices):
    NOT_COLLECTED = "NOT_COLLECTED", "Not collected"
    COLLECTED = "COLLECTED", "Collected"
    VERIFIED = "VERIFIED", "Verified"


class Relation(models.TextChoices):
    SON_OF = "S/O", "Son of"
    DAUGHTER_OF = "D/O", "Daughter of"
    WIFE_OF = "W/O", "Wife of"
    HUSBAND_OF = "H/O", "Husband of"
    OTHER = "C/O", "Care of"


mobile_validator = RegexValidator(r"^[0-9+\- ]{6,15}$", "Enter a valid phone number")
last4_validator = RegexValidator(r"^[0-9]{4}$", "Enter only the last 4 digits of Aadhaar")
ifsc_validator = RegexValidator(r"^[A-Za-z]{4}0[A-Za-z0-9]{6}$", "Enter a valid 11-character IFSC")


class Farmer(BaseModel, AddressMixin):
    farmer_code = models.CharField("Farmer ID", max_length=20, unique=True, null=True, blank=True, editable=False)
    name = models.CharField("Farmer name", max_length=200)
    relation_type = models.CharField(max_length=4, choices=Relation.choices, blank=True)
    relation_name = models.CharField("Father / Husband name", max_length=200, blank=True)
    mobile = models.CharField(max_length=15, blank=True, validators=[mobile_validator])
    alt_mobile = models.CharField("Alternate mobile", max_length=15, blank=True, validators=[mobile_validator])
    address = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=FarmerStatus.choices, default=FarmerStatus.ACTIVE)

    # KYC (farmer-level; applies to every project/location the farmer is linked to)
    aadhaar_last4 = models.CharField("Aadhaar (last 4 digits)", max_length=4, blank=True, validators=[last4_validator])
    kyc_status = models.CharField(max_length=20, choices=KYCStatus.choices, default=KYCStatus.NOT_COLLECTED)
    kyc_collected_on = models.DateField(null=True, blank=True)
    kyc_collected_by = models.ForeignKey("core.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    kyc_verified_on = models.DateField(null=True, blank=True)
    kyc_verified_by = models.ForeignKey("core.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    # Bank details - restricted to authorised roles; account number encrypted at rest
    bank_account_holder = models.CharField(max_length=200, blank=True)
    bank_name = models.CharField(max_length=200, blank=True)
    bank_branch = models.CharField(max_length=200, blank=True)
    bank_account_number = EncryptedTextField(blank=True)
    bank_ifsc = models.CharField("IFSC", max_length=11, blank=True, validators=[ifsc_validator])

    projects = models.ManyToManyField(Project, blank=True, related_name="farmers")
    remarks = models.TextField(blank=True)

    class Meta:
        ordering = ["farmer_code", "name"]

    def save(self, *args, **kwargs):
        if not self.farmer_code:
            self.farmer_code = f"FRM-{Counter.next('farmer'):06d}"
        super().save(*args, **kwargs)

    @property
    def kyc_done(self):
        return self.kyc_status in (KYCStatus.COLLECTED, KYCStatus.VERIFIED)

    @property
    def bank_account_masked(self):
        n = self.bank_account_number or ""
        return ("XXXX" + n[-4:]) if len(n) > 4 else ("XXXX" if n else "")

    def __str__(self):
        return f"{self.farmer_code or 'NEW'} - {self.name}"


# ---------------------------------------------------------------------------
# Land / survey records
# ---------------------------------------------------------------------------

class OwnershipType(models.TextChoices):
    INDIVIDUAL = "INDIVIDUAL", "Individual"
    JOINT = "JOINT", "Joint"
    GOVERNMENT = "GOVERNMENT", "Government"
    LEASED = "LEASED", "Leased / Tenant"
    OTHER = "OTHER", "Other"


class LandType(models.TextChoices):
    DRY = "DRY", "Dry land"
    WET = "WET", "Wet / Irrigated"
    GARDEN = "GARDEN", "Garden / Plantation"
    NON_AGRI = "NON_AGRI", "Non-agricultural (NA)"
    GOVERNMENT = "GOVERNMENT", "Government land"
    OTHER = "OTHER", "Other"


class LandParcel(BaseModel, AddressMixin, GPSMixin):
    survey_number = models.CharField(max_length=40)
    hissa = models.CharField("Sub-division / Hissa", max_length=40, blank=True)
    extent_acres = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"), validators=[MinValueValidator(0)])
    extent_guntas = models.DecimalField(max_digits=6, decimal_places=2, default=Decimal("0"), validators=[MinValueValidator(0)])
    ownership_type = models.CharField(max_length=20, choices=OwnershipType.choices, default=OwnershipType.INDIVIDUAL)
    land_type = models.CharField(max_length=20, choices=LandType.choices, default=LandType.DRY)
    rtc_reference = models.CharField("RTC / Pahani reference", max_length=120, blank=True)
    mutation_details = models.TextField(blank=True)
    boundary_geojson = models.JSONField(null=True, blank=True, help_text="Polygon boundary as GeoJSON geometry")
    projects = models.ManyToManyField(Project, blank=True, related_name="land_parcels")
    owners = models.ManyToManyField(Farmer, through="LandOwnership", related_name="land_parcels")
    remarks = models.TextField(blank=True)

    class Meta:
        ordering = ["village", "survey_number", "hissa"]

    @property
    def survey_label(self):
        return f"{self.survey_number}/{self.hissa}" if self.hissa else self.survey_number

    @property
    def total_acres(self):
        # 1 acre = 40 guntas (Karnataka)
        return (self.extent_acres or 0) + (self.extent_guntas or 0) / Decimal(40)

    def __str__(self):
        return f"Sy.No. {self.survey_label}, {self.village}"


class LandOwnership(BaseModel):
    """Links farmers to land. Several farmers can own one survey number (joint owners)."""

    land = models.ForeignKey(LandParcel, on_delete=models.CASCADE, related_name="ownerships")
    farmer = models.ForeignKey(Farmer, on_delete=models.CASCADE, related_name="ownerships")
    is_primary_payee = models.BooleanField("Primary / representative payee", default=False)
    share_percent = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True,
                                        help_text="Reserved for future split compensation")
    remarks = models.CharField(max_length=200, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["land", "farmer"], name="unique_land_farmer")]

    def __str__(self):
        return f"{self.farmer} -> {self.land}"


# ---------------------------------------------------------------------------
# Infrastructure assets (pole / tower / substation / road ...) = field locations
# ---------------------------------------------------------------------------

class AssetType(models.TextChoices):
    POLE = "POLE", "Pole"
    TOWER = "TOWER", "Tower"
    SUBSTATION = "SUBSTATION", "Substation"
    ACCESS_ROAD = "ACCESS_ROAD", "Access Road"
    LINE = "LINE", "Line"
    OTHER = "OTHER", "Other"


class Asset(BaseModel, GPSMixin):
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="assets")
    asset_type = models.CharField(max_length=20, choices=AssetType.choices, default=AssetType.POLE)
    asset_number = models.CharField("Pole / Tower / Asset No.", max_length=60)
    line_name = models.CharField("Line / Corridor", max_length=200, blank=True)
    land_parcel = models.ForeignKey(LandParcel, null=True, blank=True, on_delete=models.SET_NULL, related_name="assets")
    gps_captured_by = models.ForeignKey("core.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    remarks = models.TextField(blank=True)

    class Meta:
        ordering = ["project", "asset_number"]

    def __str__(self):
        return f"{self.get_asset_type_display()} {self.asset_number}"


class StageScope(models.TextChoices):
    ASSET = "ASSET", "Per location / asset"
    FARMER = "FARMER", "Per farmer (derived)"


class StageDefinition(models.Model):
    """Configurable list of progress stages. Same list for all asset types in the
    prototype; ``asset_types`` allows asset-specific stages later."""

    code = models.CharField(max_length=30, primary_key=True)
    name = models.CharField(max_length=100)
    order = models.PositiveIntegerField(default=0)
    scope = models.CharField(max_length=10, choices=StageScope.choices, default=StageScope.ASSET)
    asset_types = models.JSONField(default=list, blank=True, help_text="Empty = applies to all asset types")
    edit_roles = models.JSONField(default=list, blank=True, help_text="Roles allowed to update; empty = default")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return self.name


class AssetMilestone(BaseModel, GPSMixin):
    """Status of one progress stage for one asset/location. Stages are independent:
    any stage can be completed regardless of the others."""

    class Source(models.TextChoices):
        MANUAL = "MANUAL", "Manual"
        AUTO = "AUTO", "Automatic"

    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="milestones")
    stage_code = models.CharField(max_length=30)
    completed = models.BooleanField(default=False)
    completed_on = models.DateField(null=True, blank=True)
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.MANUAL)
    remarks = models.TextField(blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["asset", "stage_code"], name="unique_asset_stage")]

    def __str__(self):
        return f"{self.asset} / {self.stage_code}"


# ---------------------------------------------------------------------------
# Agreements
# ---------------------------------------------------------------------------

class AgreementType(models.TextChoices):
    LEASE = "LEASE", "Lease"
    ROW = "ROW", "Right of Way"
    EASEMENT = "EASEMENT", "Easement"
    CONSENT = "CONSENT", "Consent"
    OTHER = "OTHER", "Other"


class AgreementStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    NEGOTIATION = "NEGOTIATION", "Under negotiation"
    EXECUTED = "EXECUTED", "Executed"
    REGISTERED = "REGISTERED", "Executed & registered"
    CANCELLED = "CANCELLED", "Cancelled"


EXECUTED_STATUSES = (AgreementStatus.EXECUTED, AgreementStatus.REGISTERED)


class Agreement(BaseModel):
    agreement_number = models.CharField(max_length=40, unique=True, blank=True)
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="agreements")
    land_parcel = models.ForeignKey(LandParcel, null=True, blank=True, on_delete=models.SET_NULL, related_name="agreements")
    assets = models.ManyToManyField(Asset, blank=True, related_name="agreements")
    farmers = models.ManyToManyField(Farmer, blank=True, related_name="agreements")
    agreement_type = models.CharField(max_length=20, choices=AgreementType.choices, default=AgreementType.ROW)
    status = models.CharField(max_length=20, choices=AgreementStatus.choices, default=AgreementStatus.DRAFT)
    purpose = models.CharField(max_length=300, blank=True)
    land_extent = models.CharField(max_length=100, blank=True)
    agreement_date = models.DateField(null=True, blank=True)
    period_months = models.PositiveIntegerField("Agreement period (months)", null=True, blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    renewal_date = models.DateField(null=True, blank=True)
    compensation_rate = models.CharField(max_length=120, blank=True)
    total_consideration = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    registration_details = models.CharField(max_length=300, blank=True)
    stamp_duty = models.DecimalField("Stamp duty / charges", max_digits=12, decimal_places=2, null=True, blank=True)
    witness_details = models.TextField(blank=True)
    remarks = models.TextField(blank=True)

    class Meta:
        ordering = ["-agreement_date", "agreement_number"]

    def save(self, *args, **kwargs):
        if not self.agreement_number:
            self.agreement_number = f"AGR-{Counter.next('agreement'):06d}"
        super().save(*args, **kwargs)

    @property
    def is_executed(self):
        return self.status in EXECUTED_STATUSES

    def __str__(self):
        return self.agreement_number


# ---------------------------------------------------------------------------
# Crop assessment
# ---------------------------------------------------------------------------

class CropSeason(models.TextChoices):
    KHARIF = "KHARIF", "Kharif"
    RABI = "RABI", "Rabi"
    SUMMER = "SUMMER", "Summer / Zaid"
    PERENNIAL = "PERENNIAL", "Perennial"


class CropStage(models.TextChoices):
    SOWN = "SOWN", "Sown / Germination"
    VEGETATIVE = "VEGETATIVE", "Vegetative"
    FLOWERING = "FLOWERING", "Flowering"
    MATURE = "MATURE", "Mature / Ready to harvest"
    HARVESTED = "HARVESTED", "Harvested"
    STANDING = "STANDING", "Standing (perennial)"


class CropAssessment(BaseModel, GPSMixin):
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="crop_assessments")
    farmer = models.ForeignKey(Farmer, on_delete=models.PROTECT, related_name="crop_assessments")
    land_parcel = models.ForeignKey(LandParcel, null=True, blank=True, on_delete=models.SET_NULL, related_name="crop_assessments")
    asset = models.ForeignKey(Asset, null=True, blank=True, on_delete=models.SET_NULL, related_name="crop_assessments")
    season = models.CharField(max_length=20, choices=CropSeason.choices, blank=True)
    crop_type = models.CharField(max_length=100)
    crop_area_acres = models.DecimalField("Crop area (acres)", max_digits=10, decimal_places=3, null=True, blank=True)
    crop_stage = models.CharField(max_length=20, choices=CropStage.choices, blank=True)
    assessment_date = models.DateField(null=True, blank=True)
    field_inspection_notes = models.TextField(blank=True)
    revenue_assessment = models.DecimalField("Revenue dept. assessment (Rs)", max_digits=12, decimal_places=2, null=True, blank=True)
    company_assessment = models.DecimalField("Company assessment (Rs)", max_digits=12, decimal_places=2, null=True, blank=True)

    class Meta:
        ordering = ["-assessment_date"]

    def __str__(self):
        return f"{self.crop_type} - {self.farmer}"


# ---------------------------------------------------------------------------
# Compensation and payment tracking (no money moves through the system)
# ---------------------------------------------------------------------------

class CompensationCategory(models.TextChoices):
    CROP = "CROP", "Crop compensation"
    TREE = "TREE", "Tree compensation"
    POLE_TOWER = "POLE_TOWER", "Pole / Tower compensation"
    LAND = "LAND", "Land compensation"
    ACCESS_ROAD = "ACCESS_ROAD", "Access road compensation"
    OTHER = "OTHER", "Other compensation"


class CompensationStatus(models.TextChoices):
    PROPOSED = "PROPOSED", "Proposed"
    APPROVED = "APPROVED", "Approved"
    CANCELLED = "CANCELLED", "Cancelled"


class Compensation(BaseModel):
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="compensations")
    asset = models.ForeignKey(Asset, null=True, blank=True, on_delete=models.SET_NULL, related_name="compensations")
    land_parcel = models.ForeignKey(LandParcel, null=True, blank=True, on_delete=models.SET_NULL, related_name="compensations")
    payee = models.ForeignKey(Farmer, on_delete=models.PROTECT, related_name="compensations",
                              help_text="Primary / representative payee")
    crop_assessment = models.ForeignKey(CropAssessment, null=True, blank=True, on_delete=models.SET_NULL, related_name="compensations")
    category = models.CharField(max_length=20, choices=CompensationCategory.choices)
    description = models.CharField(max_length=300, blank=True)
    quantity = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True, help_text="e.g. number of trees or area")
    unit = models.CharField(max_length=30, blank=True)
    approved_amount = models.DecimalField(max_digits=14, decimal_places=2, validators=[MinValueValidator(0)])
    status = models.CharField(max_length=20, choices=CompensationStatus.choices, default=CompensationStatus.PROPOSED)
    approved_on = models.DateField(null=True, blank=True)
    approved_by = models.ForeignKey("core.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    remarks = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def paid_amount(self):
        if hasattr(self, "_paid_amount"):
            return self._paid_amount or Decimal("0")
        return self.payments.aggregate(s=Sum("amount"))["s"] or Decimal("0")

    @property
    def balance_amount(self):
        return (self.approved_amount or Decimal("0")) - self.paid_amount

    @property
    def payment_status(self):
        paid = self.paid_amount
        if paid <= 0:
            return "UNPAID"
        if paid >= (self.approved_amount or 0):
            return "PAID"
        return "PARTIAL"

    def __str__(self):
        return f"{self.get_category_display()} - {self.payee} - \u20b9{self.approved_amount}"


class PaymentMode(models.TextChoices):
    NEFT = "NEFT", "NEFT"
    RTGS = "RTGS", "RTGS"
    IMPS = "IMPS", "IMPS"
    UPI = "UPI", "UPI"
    CHEQUE = "CHEQUE", "Cheque"
    DD = "DD", "Demand draft"
    CASH = "CASH", "Cash"
    OTHER = "OTHER", "Other"


class Payment(BaseModel):
    """A manually recorded payment instalment against a compensation record."""

    compensation = models.ForeignKey(Compensation, on_delete=models.PROTECT, related_name="payments")
    amount = models.DecimalField(max_digits=14, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))])
    payment_date = models.DateField()
    mode = models.CharField(max_length=10, choices=PaymentMode.choices, default=PaymentMode.NEFT)
    reference_number = models.CharField("UTR / Cheque / Reference No.", max_length=60, blank=True)
    receipt_number = models.CharField(max_length=60, blank=True)
    paid_to = models.ForeignKey(Farmer, null=True, blank=True, on_delete=models.SET_NULL, related_name="payments_received")
    remarks = models.TextField(blank=True)

    class Meta:
        ordering = ["-payment_date", "-created_at"]

    def __str__(self):
        return f"\u20b9{self.amount} on {self.payment_date}"


# ---------------------------------------------------------------------------
# Documents and photos
# ---------------------------------------------------------------------------

class DocumentCategory(models.TextChoices):
    KYC_AADHAAR = "KYC_AADHAAR", "KYC - Aadhaar card"
    KYC_OTHER = "KYC_OTHER", "KYC - Other ID"
    BANK_PROOF = "BANK_PROOF", "Bank passbook / cheque"
    LAND_RTC = "LAND_RTC", "RTC / Pahani"
    LAND_OTHER = "LAND_OTHER", "Other land document"
    AGREEMENT = "AGREEMENT", "Signed agreement"
    SITE_PHOTO = "SITE_PHOTO", "Site photo"
    CROP_PHOTO = "CROP_PHOTO", "Crop photo"
    PAYMENT_RECEIPT = "PAYMENT_RECEIPT", "Payment receipt"
    OTHER = "OTHER", "Other"


SENSITIVE_CATEGORIES = {DocumentCategory.KYC_AADHAAR, DocumentCategory.KYC_OTHER, DocumentCategory.BANK_PROOF}


def document_upload_path(instance, filename):
    folder = "private" if instance.is_sensitive else "files"
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "bin").lower()[:8]
    return f"{folder}/{instance.category.lower()}/{instance.id}.{ext}"


class Document(BaseModel, GPSMixin):
    category = models.CharField(max_length=20, choices=DocumentCategory.choices)
    title = models.CharField(max_length=200, blank=True)
    file = models.FileField(upload_to=document_upload_path, max_length=300)
    original_name = models.CharField(max_length=255, blank=True)
    content_type = models.CharField(max_length=100, blank=True)
    size_bytes = models.PositiveIntegerField(default=0)
    is_sensitive = models.BooleanField(default=False)
    is_encrypted = models.BooleanField(default=False)
    captured_live = models.BooleanField(default=False, help_text="Taken with the in-app camera (vs uploaded from gallery/files)")
    captured_at = models.DateTimeField(null=True, blank=True)

    project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.SET_NULL, related_name="documents")
    farmer = models.ForeignKey(Farmer, null=True, blank=True, on_delete=models.SET_NULL, related_name="documents")
    land_parcel = models.ForeignKey(LandParcel, null=True, blank=True, on_delete=models.SET_NULL, related_name="documents")
    asset = models.ForeignKey(Asset, null=True, blank=True, on_delete=models.SET_NULL, related_name="documents")
    milestone = models.ForeignKey(AssetMilestone, null=True, blank=True, on_delete=models.SET_NULL, related_name="documents")
    agreement = models.ForeignKey(Agreement, null=True, blank=True, on_delete=models.SET_NULL, related_name="documents")
    compensation = models.ForeignKey(Compensation, null=True, blank=True, on_delete=models.SET_NULL, related_name="documents")
    payment = models.ForeignKey(Payment, null=True, blank=True, on_delete=models.SET_NULL, related_name="documents")
    crop_assessment = models.ForeignKey(CropAssessment, null=True, blank=True, on_delete=models.SET_NULL, related_name="documents")
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title or self.original_name or str(self.id)


# ---------------------------------------------------------------------------
# Settings, audit and sync bookkeeping
# ---------------------------------------------------------------------------

class AppSetting(models.Model):
    key = models.CharField(max_length=60, primary_key=True)
    value = models.JSONField()
    description = models.CharField(max_length=300, blank=True)

    DEFAULTS = {
        "GPS_ACCURACY_WARNING_METERS": (15, "Show a warning on the field app when GPS accuracy is worse than this (metres)"),
    }

    @classmethod
    def get(cls, key):
        try:
            return cls.objects.get(key=key).value
        except cls.DoesNotExist:
            return cls.DEFAULTS.get(key, (None,))[0]

    def __str__(self):
        return self.key


class AuditLog(models.Model):
    class Action(models.TextChoices):
        CREATE = "CREATE", "Create"
        UPDATE = "UPDATE", "Update"
        DELETE = "DELETE", "Delete"
        APPROVE = "APPROVE", "Approve"
        VIEW_SENSITIVE = "VIEW_SENSITIVE", "Viewed sensitive document"
        EXPORT = "EXPORT", "Export"
        IMPORT = "IMPORT", "Import"
        LOGIN = "LOGIN", "Login"

    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="audit_logs")
    action = models.CharField(max_length=20, choices=Action.choices)
    model_name = models.CharField(max_length=60, blank=True)
    object_id = models.CharField(max_length=60, blank=True)
    object_repr = models.CharField(max_length=300, blank=True)
    changes = models.JSONField(null=True, blank=True)
    source = models.CharField(max_length=20, default="WEB")
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-timestamp"]


class ApiToken(models.Model):
    """One sign-in token per device/browser, so signing out on the web does not
    sign the user out of their phone (and vice versa)."""

    key = models.CharField(max_length=40, primary_key=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="api_tokens")
    client = models.CharField(max_length=20, default="WEB")
    created = models.DateTimeField(auto_now_add=True)
    last_used = models.DateTimeField(null=True, blank=True)

    @classmethod
    def issue(cls, user, client="WEB"):
        import secrets
        return cls.objects.create(key=secrets.token_hex(20), user=user, client=(client or "WEB")[:20])

    def __str__(self):
        return f"{self.user} ({self.client})"


class SyncOperation(models.Model):
    """Remembers processed offline operations so a retried upload is never applied twice."""

    op_id = models.UUIDField(primary_key=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    entity = models.CharField(max_length=40)
    object_id = models.CharField(max_length=60)
    ok = models.BooleanField(default=True)
    response = models.JSONField(null=True, blank=True)
    received_at = models.DateTimeField(auto_now_add=True)
