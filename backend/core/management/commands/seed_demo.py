"""Load demonstration data: two projects, farmers, land, poles/towers at different
stages, agreements, compensation and partial payments, plus one user per role.

    python manage.py seed_demo            # add demo data (skips if already loaded)
    python manage.py seed_demo --reset    # wipe business data first
"""
import io
import math
import random
from datetime import date, timedelta
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from core import services
from core.documents import store_document
from core.models import (
    Agreement, Asset, AssetMilestone, AuditLog, Company, Compensation, Counter, CropAssessment, Document,
    Farmer, LandOwnership, LandParcel, Payment, Project, Role, SyncOperation, User,
)

DEMO_PASSWORD = "Demo@1234"

USERS = [
    ("admin", "Ravi", "Kulkarni", Role.ADMIN),
    ("pm", "Suresh", "Patil", Role.PROJECT_MANAGER),
    ("rowofficer", "Manjunath", "Hegde", Role.ROW_OFFICER),
    ("surveyor1", "Prakash", "Naik", Role.SURVEYOR),
    ("surveyor2", "Anil", "Gowda", Role.SURVEYOR),
    ("finance", "Lakshmi", "Rao", Role.FINANCE),
    ("management", "Vinay", "Shetty", Role.MANAGEMENT),
]

FARMERS_A = [
    ("Basavaraj Hiremath", "S/O", "Shivappa Hiremath", "Hirebommanal"),
    ("Mallappa Kuri", "S/O", "Hanumappa Kuri", "Hirebommanal"),
    ("Gangamma Hadapad", "W/O", "Yamanappa Hadapad", "Hirebommanal"),
    ("Shivaraj Patil", "S/O", "Veerabhadrappa Patil", "Talakal"),
    ("Ningappa Talawar", "S/O", "Durgappa Talawar", "Talakal"),
    ("Savitri Kadadi", "D/O", "Kallappa Kadadi", "Talakal"),
    ("Hanumantappa Bovi", "S/O", "Ramappa Bovi", "Bannikoppa"),
    ("Yallappa Madar", "S/O", "Fakirappa Madar", "Bannikoppa"),
    ("Sharanappa Angadi", "S/O", "Chandrashekhar Angadi", "Bannikoppa"),
    ("Kamalamma Pujar", "W/O", "Basappa Pujar", "Mangalur"),
    ("Devendrappa Gouda", "S/O", "Siddanagouda", "Mangalur"),
    ("Ramesh Hosamani", "S/O", "Lakshmappa Hosamani", "Mangalur"),
    ("Parvati Hosamani", "W/O", "Ramesh Hosamani", "Mangalur"),
]
FARMERS_B = [
    ("Fakirappa Lamani", "S/O", "Tippanna Lamani", "Mulgund"),
    ("Iranna Kumbar", "S/O", "Mahadevappa Kumbar", "Mulgund"),
    ("Neelamma Hugar", "W/O", "Shankrappa Hugar", "Hulkoti"),
    ("Mahantesh Biradar", "S/O", "Gurappa Biradar", "Hulkoti"),
    ("Siddappa Bhajantri", "S/O", "Kenchappa Bhajantri", "Hulkoti"),
]
CROPS = ["Maize", "Groundnut", "Jowar", "Bengal gram", "Sunflower", "Cotton", "Tur dal"]

TALUK_A = {"Hirebommanal": ("Kuknoor", "Yelburga"), "Talakal": ("Kuknoor", "Yelburga"),
           "Bannikoppa": ("Mangalur", "Yelburga"), "Mangalur": ("Mangalur", "Yelburga")}
TALUK_B = {"Mulgund": ("Mulgund", "Gadag"), "Hulkoti": ("Hulkoti", "Gadag")}


def placeholder_image(text, color):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (640, 480), color)
    d = ImageDraw.Draw(img)
    d.rectangle([20, 20, 620, 460], outline=(255, 255, 255), width=3)
    for i, line in enumerate(text.split("\n")):
        d.text((40, 40 + i * 28), line, fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80)
    return buf.getvalue()


def square(lat, lng, size=0.0012):
    pts = [[lng - size, lat - size], [lng + size, lat - size], [lng + size, lat + size], [lng - size, lat + size]]
    pts.append(pts[0])
    return {"type": "Polygon", "coordinates": [[[round(x, 7), round(y, 7)] for x, y in pts]]}


class Command(BaseCommand):
    help = "Load demo data for the prototype"

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Delete existing business data first")

    def handle(self, *args, **opts):
        if opts["reset"]:
            self.reset()
        elif Project.all_objects.exists():
            self.stdout.write(self.style.WARNING("Data already exists - skipping (use --reset to reload)."))
            return
        random.seed(42)
        with transaction.atomic():
            self.load()
        self.stdout.write(self.style.SUCCESS("Demo data loaded."))
        self.stdout.write("Users (password for all: %s):" % DEMO_PASSWORD)
        for u, f, l, r in USERS:
            self.stdout.write(f"  {u:<12} {Role(r).label}")

    def reset(self):
        for model in (Document, Payment, Compensation, CropAssessment, AssetMilestone):
            model.all_objects.all().delete()
        Agreement.all_objects.all().delete()
        Asset.all_objects.all().delete()
        LandOwnership.all_objects.all().delete()
        LandParcel.all_objects.all().delete()
        Farmer.all_objects.all().delete()
        Project.all_objects.all().delete()
        AuditLog.objects.all().delete()
        SyncOperation.objects.all().delete()
        Counter.objects.all().delete()
        User.objects.filter(username__in=[u[0] for u in USERS]).delete()

    def load(self):
        company, _ = Company.objects.get_or_create(code="IPOWER", defaults={"name": "Ipower Engineering Services LLP"})
        services.ensure_default_stages()
        users = {}
        for username, first, last, role in USERS:
            u = User.objects.create_user(username=username, password=DEMO_PASSWORD, first_name=first, last_name=last,
                                         role=role, company=company, phone="98450%05d" % random.randint(0, 99999),
                                         is_staff=(role == Role.ADMIN), is_superuser=(role == Role.ADMIN))
            users[username] = u
        admin, pm, row, sv1, sv2, fin = (users[k] for k in ("admin", "pm", "rowofficer", "surveyor1", "surveyor2", "finance"))
        today = timezone.localdate()

        pa = Project.objects.create(
            company=company, code="KPL-SOL-33KV", name="Yelburga 20 MW Solar - 33 kV Evacuation Line",
            developer="Sunrise Renewables Pvt Ltd", project_type="DISTRIBUTION", voltage_level="33KV",
            corridor="Solar plant to Mangalur 110/33 kV substation", district="Koppal", taluk="Yelburga",
            start_date=today - timedelta(days=150), created_by=admin)
        pb = Project.objects.create(
            company=company, code="GDG-WND-110KV", name="Gadag Wind Farm - 110 kV Transmission Line",
            developer="Western Ghats Wind Energy Ltd", project_type="TRANSMISSION", voltage_level="110KV",
            corridor="Wind pooling station to Hulkoti 220/110 kV substation", district="Gadag", taluk="Gadag",
            start_date=today - timedelta(days=90), created_by=admin)
        for u in (pm, row, sv1):
            u.projects.add(pa, pb)
        sv2.projects.add(pb)

        def mk_farmers(rows, taluks, district, project, creator):
            out = []
            for name, rel, relname, village in rows:
                hobli, taluk = taluks[village]
                f = Farmer.objects.create(
                    name=name, relation_type=rel, relation_name=relname, village=village, hobli=hobli, taluk=taluk,
                    district=district, mobile="9%09d" % random.randint(100000000, 999999999),
                    address=f"At post {village}, Tq. {taluk}, Dist. {district}", created_by=creator)
                f.projects.add(project)
                out.append(f)
            return out

        fa = mk_farmers(FARMERS_A, TALUK_A, "Koppal", pa, sv1)
        fb = mk_farmers(FARMERS_B, TALUK_B, "Gadag", pb, sv1)
        # One farmer involved in both projects (lifetime history example)
        shared = fa[3]
        shared.projects.add(pb)

        def route(start, end, n, wiggle):
            pts = []
            for i in range(n):
                t = i / (n - 1)
                lat = start[0] + (end[0] - start[0]) * t + math.sin(t * 6) * wiggle
                lng = start[1] + (end[1] - start[1]) * t + math.cos(t * 5) * wiggle * 0.5
                pts.append((round(lat, 7), round(lng, 7)))
            return pts

        pts_a = route((15.6420, 76.0320), (15.6010, 76.1080), 24, 0.0025)
        pts_b = route((15.4080, 75.5650), (15.4620, 75.6470), 10, 0.004)
        pa.route_geojson = {"type": "LineString", "coordinates": [[lng, lat] for lat, lng in pts_a]}
        pa.save()
        pb.route_geojson = {"type": "LineString", "coordinates": [[lng, lat] for lat, lng in pts_b]}
        pb.save()

        # Land parcels: groups of poles fall on the same survey number
        def mk_lands(project, farmers, pts, per_land, base_sy, taluks, district, joint_pairs):
            lands = []
            fi = 0
            for i in range(0, len(pts), per_land):
                lat, lng = pts[i]
                f = farmers[fi % len(farmers)]
                hobli, taluk = taluks[f.village]
                lp = LandParcel.objects.create(
                    survey_number=str(base_sy + i * 3), hissa=random.choice(["", "1", "2", "1A", "2B"]),
                    village=f.village, hobli=hobli, taluk=taluk, district=district,
                    extent_acres=Decimal(random.randint(1, 9)), extent_guntas=Decimal(random.choice([0, 10, 20, 30])),
                    ownership_type="INDIVIDUAL", land_type=random.choice(["DRY", "DRY", "WET", "GARDEN"]),
                    rtc_reference=f"RTC/{taluk[:3].upper()}/{base_sy + i * 3}/{today.year}", latitude=Decimal(str(lat)),
                    longitude=Decimal(str(lng)), boundary_geojson=square(lat, lng), created_by=sv1)
                lp.projects.add(project)
                LandOwnership.objects.create(land=lp, farmer=f, is_primary_payee=True, created_by=sv1)
                if fi in joint_pairs and fi + 1 < len(farmers):
                    other = farmers[(fi + 1) % len(farmers)]
                    lp.ownership_type = "JOINT"
                    lp.save()
                    LandOwnership.objects.create(land=lp, farmer=other, is_primary_payee=False, created_by=sv1)
                    other.status = "JOINT_OWNER"
                    other.save()
                lands.append(lp)
                fi += 1 if fi not in joint_pairs else 2
            return lands

        lands_a = mk_lands(pa, fa, pts_a, 2, 41, TALUK_A, "Koppal", joint_pairs={1, 11})
        lands_b = mk_lands(pb, fb + [shared], pts_b, 2, 112, {**TALUK_B, **TALUK_A}, "Gadag", joint_pairs=set())
        # shared farmer's land in project B is in Gadag district village - fix display village
        for lp in lands_b:
            if lp.ownerships.filter(farmer=shared).exists():
                lp.village, lp.hobli, lp.taluk = "Hulkoti", "Hulkoti", "Gadag"
                lp.save()

        # KYC: most collected, some verified
        for i, f in enumerate(fa + fb):
            if i % 5 == 4:
                continue
            f.kyc_status = "VERIFIED" if i % 3 == 0 else "COLLECTED"
            f.kyc_collected_on = today - timedelta(days=100 - i * 3)
            f.kyc_collected_by = sv1
            f.aadhaar_last4 = "%04d" % random.randint(0, 9999)
            if f.kyc_status == "VERIFIED":
                f.kyc_verified_on = f.kyc_collected_on + timedelta(days=4)
                f.kyc_verified_by = row
            f.bank_account_holder = f.name
            f.bank_name = random.choice(["State Bank of India", "Canara Bank", "Karnataka Gramin Bank", "Union Bank of India"])
            f.bank_branch = f.village if i % 2 else f.taluk
            f.bank_account_number = "%011d" % random.randint(10**10, 10**11 - 1)
            f.bank_ifsc = random.choice(["SBIN0040123", "CNRB0001234", "PKGB0011045", "UBIN0912345"])
            f.save()

        def mk_assets(project, pts, lands, prefix, atype, per_land, line):
            assets = []
            for i, (lat, lng) in enumerate(pts):
                acc = Decimal(str(round(random.uniform(3, 12), 1))) if i != 5 else Decimal("22.0")
                a = Asset.objects.create(
                    project=project, asset_type=atype, asset_number=f"{prefix}-{i + 1:02d}", line_name=line,
                    land_parcel=lands[min(i // per_land, len(lands) - 1)], latitude=Decimal(str(lat)), longitude=Decimal(str(lng)),
                    gps_accuracy_m=acc, gps_captured_at=timezone.now() - timedelta(days=120 - i), gps_captured_by=sv1,
                    created_by=sv1)
                assets.append(a)
            return assets

        assets_a = mk_assets(pa, pts_a, lands_a, "P", "POLE", 2, "33 kV Yelburga Solar Evacuation")
        assets_b = mk_assets(pb, pts_b, lands_b, "T", "TOWER", 2, "110 kV Gadag Wind Line")
        # a substation and access road in project A
        sub = Asset.objects.create(project=pa, asset_type="SUBSTATION", asset_number="SS-MANGALUR", line_name="Mangalur 110/33 kV",
                                   land_parcel=lands_a[-1], latitude=Decimal("15.6002"), longitude=Decimal("76.1101"),
                                   gps_accuracy_m=Decimal("4.5"), gps_captured_at=timezone.now(), created_by=sv1)
        road = Asset.objects.create(project=pa, asset_type="ACCESS_ROAD", asset_number="AR-01", line_name="Approach road to P-01",
                                    land_parcel=lands_a[0], latitude=Decimal("15.6431"), longitude=Decimal("76.0301"),
                                    gps_accuracy_m=Decimal("6.0"), created_by=sv1)

        def progress(assets, lands, project, farmers_done_ratio):
            n = len(assets)
            for i, a in enumerate(assets):
                frac = 1 - i / n  # earlier assets are further along
                when = today - timedelta(days=int(100 * frac) + 5)
                services.set_milestone(a, "SURVEYED", True, user=sv1, completed_on=when - timedelta(days=30),
                                       lat=a.latitude, lng=a.longitude, accuracy=a.gps_accuracy_m)
                if frac > 0.45:
                    services.set_milestone(a, "ERECTION", True, user=sv1, completed_on=when)
                if frac > 0.6:
                    services.set_milestone(a, "STRINGING", True, user=sv1, completed_on=when + timedelta(days=10))
                if frac > 0.75:
                    services.set_milestone(a, "STAYWIRE", True, user=sv1, completed_on=when + timedelta(days=14))

        progress(assets_a + [sub, road], lands_a, pa, 0.8)
        progress(assets_b, lands_b, pb, 0.6)

        # Agreements, compensation, payments per land parcel
        def money_flow(project, lands, assets, executed_ratio, ratio_paid):
            n = len(lands)
            for i, lp in enumerate(lands):
                owners = [o.farmer for o in lp.ownerships.all()]
                payee = next(o.farmer for o in lp.ownerships.all() if o.is_primary_payee)
                land_assets = [a for a in assets if a.land_parcel_id == lp.id]
                frac = 1 - i / n
                if frac < 1 - executed_ratio - 0.15:
                    continue  # not yet negotiated
                executed = frac >= 1 - executed_ratio
                ag_date = today - timedelta(days=int(90 * frac) + 3)
                ag = Agreement.objects.create(
                    project=project, land_parcel=lp, agreement_type="ROW", status="REGISTERED" if executed and i % 3 == 0 else ("EXECUTED" if executed else "NEGOTIATION"),
                    purpose=f"Right of way for {project.get_voltage_level_display()} line and erection of {', '.join(a.asset_number for a in land_assets)}",
                    land_extent=f"{lp.extent_acres} A {lp.extent_guntas} G", agreement_date=ag_date if executed else None,
                    period_months=360 if project.voltage_level == "110KV" else 300, start_date=ag_date if executed else None,
                    compensation_rate="As per KPTCL / company rate", stamp_duty=Decimal("500.00") if executed else None,
                    registration_details=f"Sub-Registrar {lp.taluk}, Doc No. {lp.taluk[:3].upper()}-{1200 + i}" if executed and i % 3 == 0 else "",
                    witness_details="1. Gram Panchayat member\n2. Village accountant", created_by=row)
                ag.farmers.set(owners)
                ag.assets.set(land_assets)
                if not executed:
                    continue
                base = Decimal(random.choice([45000, 60000, 75000, 90000, 120000])) * (2 if project.voltage_level == "110KV" else 1)
                comp_rows = [("POLE_TOWER", base, "Pole/tower footprint & corridor")]
                if i % 2 == 0:
                    comp_rows.append(("CROP", Decimal(random.choice([8000, 12500, 18000, 22000])), f"Standing {random.choice(CROPS).lower()} damage"))
                if i % 4 == 1:
                    comp_rows.append(("TREE", Decimal(random.choice([6000, 9000, 15000])), f"{random.randint(2, 6)} trees (neem/tamarind)"))
                total = Decimal(0)
                for cat, amt, desc in comp_rows:
                    total += amt
                    crop = None
                    if cat == "CROP":
                        crop = CropAssessment.objects.create(
                            project=project, farmer=payee, land_parcel=lp, asset=land_assets[0] if land_assets else None,
                            season=random.choice(["KHARIF", "RABI"]), crop_type=desc.split()[1].title(),
                            crop_area_acres=Decimal(str(round(random.uniform(0.2, 1.2), 2))), crop_stage=random.choice(["VEGETATIVE", "FLOWERING", "MATURE"]),
                            assessment_date=ag_date - timedelta(days=5), field_inspection_notes="Joint inspection with village accountant.",
                            revenue_assessment=amt * Decimal("0.9"), company_assessment=amt, latitude=lp.latitude, longitude=lp.longitude,
                            gps_accuracy_m=Decimal("6.5"), created_by=sv1)
                    c = Compensation.objects.create(
                        project=project, asset=land_assets[0] if land_assets else None, land_parcel=lp, payee=payee,
                        crop_assessment=crop, category=cat, description=desc, approved_amount=amt,
                        quantity=Decimal(desc.split()[0]) if cat == "TREE" else None, unit="trees" if cat == "TREE" else "",
                        status="APPROVED", approved_on=ag_date + timedelta(days=2), approved_by=pm, created_by=row)
                    # Payments: fully paid, partial or unpaid depending on position
                    if frac > 1 - ratio_paid:
                        Payment.objects.create(compensation=c, amount=amt, payment_date=min(today, ag_date + timedelta(days=12)),
                                               mode="NEFT", reference_number="UTR%012d" % random.randint(10**11, 10**12 - 1),
                                               paid_to=payee, created_by=fin)
                    elif frac > 1 - ratio_paid - 0.25:
                        part = (amt * Decimal("0.6")).quantize(Decimal("1"))
                        Payment.objects.create(compensation=c, amount=part, payment_date=min(today, ag_date + timedelta(days=15)),
                                               mode=random.choice(["NEFT", "CHEQUE"]), reference_number="%06d" % random.randint(100000, 999999),
                                               paid_to=payee, remarks="First instalment", created_by=fin)
                ag.total_consideration = total
                ag.save()
                services.refresh_agreement_milestones(ag, row)
                for a in land_assets:
                    services.refresh_payment_milestone(a, fin)

        money_flow(pa, lands_a, assets_a + [sub, road], 0.7, 0.45)
        money_flow(pb, lands_b, assets_b, 0.6, 0.3)
        # proposed (awaiting approval) compensation example
        lp = lands_a[-2]
        Compensation.objects.create(project=pa, land_parcel=lp, payee=lp.ownerships.first().farmer, category="CROP",
                                    description="Groundnut damage during stringing", approved_amount=Decimal("14500"),
                                    status="PROPOSED", created_by=row)

        # Sample photos & KYC documents (placeholders)
        for a in assets_a[:6] + assets_b[:3]:
            m = AssetMilestone.objects.filter(asset=a, stage_code="ERECTION", completed=True).first()
            img = placeholder_image(f"DEMO SITE PHOTO\n{a.project.code}\n{a.get_asset_type_display()} {a.asset_number}\n{a.latitude}, {a.longitude}", (46, 94, 70))
            d = Document(category="SITE_PHOTO", title=f"{a.asset_number} erection", asset=a, milestone=m,
                         latitude=a.latitude, longitude=a.longitude, gps_accuracy_m=a.gps_accuracy_m, captured_live=True,
                         captured_at=timezone.now() - timedelta(days=20), created_by=sv1)
            store_document(d, SimpleUploadedFile(f"{a.asset_number}.jpg", img, content_type="image/jpeg"))
        for f in (fa + fb)[:4]:
            img = placeholder_image(f"SAMPLE KYC DOCUMENT (DEMO)\n{f.name}\nAadhaar: XXXX XXXX {f.aadhaar_last4 or '----'}", (90, 70, 40))
            d = Document(category="KYC_AADHAAR", title=f"Masked Aadhaar - {f.name}", farmer=f, created_by=sv1, captured_live=False)
            store_document(d, SimpleUploadedFile("aadhaar.jpg", img, content_type="image/jpeg"))
