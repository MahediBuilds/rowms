import io
import uuid
from datetime import date
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from core import services
from core.models import (
    Asset, AssetMilestone, AuditLog, Company, Compensation, Document, Farmer, LandOwnership, LandParcel,
    Payment, Project, Role, User,
)


def jpeg():
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (10, 10), (200, 0, 0)).save(buf, "JPEG")
    return buf.getvalue()


class Base(TestCase):
    def setUp(self):
        services.ensure_default_stages()
        self.company = Company.objects.get_or_create(code="IPOWER", defaults={"name": "Ipower"})[0]
        self.p1 = Project.objects.create(code="P1", name="Project 1", company=self.company)
        self.p2 = Project.objects.create(code="P2", name="Project 2", company=self.company)
        self.users = {}
        for role in Role.values:
            u = User.objects.create_user(username=role.lower(), password="Passw0rd!x", role=role, company=self.company)
            self.users[role] = u
        for r in (Role.PROJECT_MANAGER, Role.ROW_OFFICER, Role.SURVEYOR):
            self.users[r].projects.add(self.p1)

    def client_for(self, role):
        c = APIClient()
        c.force_authenticate(self.users[role])
        return c

    def make_location(self, by=Role.SURVEYOR, project=None):
        c = self.client_for(by)
        project = project or self.p1
        f = c.post("/api/farmers/", {"name": "Test Farmer", "village": "V1", "project_ids": [str(project.id)]}, format="json")
        self.assertEqual(f.status_code, 201, f.content)
        land = c.post("/api/lands/", {"survey_number": "45", "hissa": "2", "village": "V1", "project_ids": [str(project.id)]}, format="json")
        self.assertEqual(land.status_code, 201, land.content)
        o = c.post("/api/ownerships/", {"land": land.json()["id"], "farmer": f.json()["id"], "is_primary_payee": True}, format="json")
        self.assertEqual(o.status_code, 201, o.content)
        a = c.post("/api/assets/", {"project": str(project.id), "asset_number": "P-01", "asset_type": "POLE",
                                    "land_parcel": land.json()["id"], "latitude": "15.6", "longitude": "76.0", "gps_accuracy_m": "25"}, format="json")
        self.assertEqual(a.status_code, 201, a.content)
        return f.json(), land.json(), a.json()


class AuthAndRolesTests(Base):
    def test_login_and_me(self):
        c = APIClient()
        r = c.post("/api/auth/login/", {"username": "surveyor", "password": "Passw0rd!x"}, format="json")
        self.assertEqual(r.status_code, 200)
        c.credentials(HTTP_AUTHORIZATION="Token " + r.json()["token"])
        me = c.get("/api/auth/me/").json()
        self.assertEqual(me["role"], "SURVEYOR")
        self.assertFalse(me["permissions"]["payment"]["read"])
        self.assertTrue(AuditLog.objects.filter(action="LOGIN").exists())

    def test_sign_out_on_web_keeps_phone_signed_in(self):
        web, phone = APIClient(), APIClient()
        t1 = web.post("/api/auth/login/", {"username": "surveyor", "password": "Passw0rd!x"}, format="json").json()["token"]
        t2 = phone.post("/api/auth/login/", {"username": "surveyor", "password": "Passw0rd!x", "client": "MOBILE"}, format="json").json()["token"]
        self.assertNotEqual(t1, t2)
        web.credentials(HTTP_AUTHORIZATION="Token " + t1)
        phone.credentials(HTTP_AUTHORIZATION="Token " + t2)
        self.assertEqual(web.post("/api/auth/logout/").status_code, 200)
        self.assertEqual(web.get("/api/auth/me/").status_code, 401)
        self.assertEqual(phone.get("/api/auth/me/").status_code, 200)
        # deactivating the user signs out every device
        admin = self.client_for(Role.ADMIN)
        admin.patch(f"/api/users/{self.users[Role.SURVEYOR].id}/", {"is_active": False}, format="json")
        self.assertEqual(phone.get("/api/auth/me/").status_code, 401)

    def test_wrong_password(self):
        r = APIClient().post("/api/auth/login/", {"username": "surveyor", "password": "nope"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_surveyor_sees_only_assigned_projects(self):
        r = self.client_for(Role.SURVEYOR).get("/api/projects/").json()
        self.assertEqual([p["code"] for p in r["results"]], ["P1"])
        r = self.client_for(Role.MANAGEMENT).get("/api/projects/").json()
        self.assertEqual(len(r["results"]), 2)

    def test_surveyor_cannot_see_payments_or_create_agreement(self):
        c = self.client_for(Role.SURVEYOR)
        self.assertEqual(c.get("/api/payments/").status_code, 403)
        self.assertEqual(c.get("/api/compensations/").status_code, 403)
        self.assertEqual(c.post("/api/agreements/", {"project": str(self.p1.id)}, format="json").status_code, 403)

    def test_management_is_read_only(self):
        c = self.client_for(Role.MANAGEMENT)
        self.assertEqual(c.get("/api/farmers/").status_code, 200)
        self.assertEqual(c.post("/api/farmers/", {"name": "X"}, format="json").status_code, 403)

    def test_surveyor_cannot_create_in_unassigned_project(self):
        c = self.client_for(Role.SURVEYOR)
        r = c.post("/api/assets/", {"project": str(self.p2.id), "asset_number": "X1"}, format="json")
        self.assertEqual(r.status_code, 400)


class FarmerTests(Base):
    def test_farmer_id_sequence_and_aadhaar_rule(self):
        c = self.client_for(Role.ROW_OFFICER)
        a = c.post("/api/farmers/", {"name": "A", "project_ids": [str(self.p1.id)]}, format="json").json()
        b = c.post("/api/farmers/", {"name": "B", "project_ids": [str(self.p1.id)]}, format="json").json()
        self.assertEqual(a["farmer_code"], "FRM-000001")
        self.assertEqual(b["farmer_code"], "FRM-000002")
        r = c.post("/api/farmers/", {"name": "C", "aadhaar_last4": "123456789012"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_bank_details_hidden_and_encrypted(self):
        c = self.client_for(Role.ROW_OFFICER)
        f = c.post("/api/farmers/", {"name": "A", "bank_account_number": "12345678901", "bank_ifsc": "SBIN0040123",
                                     "project_ids": [str(self.p1.id)]}, format="json").json()
        self.assertEqual(f["bank_account_number"], "12345678901")
        sv = self.client_for(Role.SURVEYOR).get(f"/api/farmers/{f['id']}/").json()
        self.assertNotIn("bank_account_number", sv)
        self.assertEqual(sv["bank_account_masked"], "XXXX8901")
        from django.db import connection
        with connection.cursor() as cur:
            cur.execute("SELECT bank_account_number FROM core_farmer WHERE bank_account_number <> ''")
            raw = cur.fetchone()[0]
        self.assertTrue(raw.startswith("enc$"))
        self.assertNotIn("12345678901", raw)

    def test_kyc_is_farmer_level_and_shows_on_every_location(self):
        f, land, a = self.make_location()
        c = self.client_for(Role.SURVEYOR)
        prog = {s["code"]: s for s in c.get(f"/api/assets/{a['id']}/").json()["progress"]["stages"]}
        self.assertFalse(prog["KYC"]["completed"])
        c.patch(f"/api/farmers/{f['id']}/", {"kyc_status": "COLLECTED"}, format="json")
        prog = {s["code"]: s for s in c.get(f"/api/assets/{a['id']}/").json()["progress"]["stages"]}
        self.assertTrue(prog["KYC"]["completed"])
        # Surveyor cannot verify
        r = c.patch(f"/api/farmers/{f['id']}/", {"kyc_status": "VERIFIED"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_history(self):
        f, land, a = self.make_location()
        r = self.client_for(Role.PROJECT_MANAGER).get(f"/api/farmers/{f['id']}/history/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()["assets"]), 1)
        self.assertTrue(any(e["type"] == "ASSET" for e in r.json()["timeline"]))


class ProgressTests(Base):
    def test_stages_independent_and_role_limited(self):
        f, land, a = self.make_location()
        sv = self.client_for(Role.SURVEYOR)
        r = sv.post(f"/api/assets/{a['id']}/set-stage/", {"stage_code": "STRINGING", "completed": True}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        prog = {s["code"]: s for s in r.json()["progress"]["stages"]}
        self.assertTrue(prog["STRINGING"]["completed"])
        self.assertFalse(prog["SURVEYED"]["completed"])
        r = sv.post(f"/api/assets/{a['id']}/set-stage/", {"stage_code": "PAYMENT", "completed": True}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_gps_warning_flag(self):
        f, land, a = self.make_location()
        self.assertTrue(a["gps_warning"])  # 25 m > 15 m threshold

    def test_agreement_and_payment_auto_milestones(self):
        f, land, a = self.make_location()
        row = self.client_for(Role.ROW_OFFICER)
        ag = row.post("/api/agreements/", {"project": str(self.p1.id), "land_parcel": land["id"], "farmer_ids": [f["id"]],
                                           "asset_ids": [a["id"]], "status": "EXECUTED", "agreement_date": "2026-09-01"}, format="json")
        self.assertEqual(ag.status_code, 201, ag.content)
        self.assertTrue(ag.json()["agreement_number"].startswith("AGR-"))
        m = AssetMilestone.objects.get(asset_id=a["id"], stage_code="AGREEMENT")
        self.assertTrue(m.completed)
        self.assertEqual(m.source, "AUTO")

        comp = row.post("/api/compensations/", {"project": str(self.p1.id), "asset": a["id"], "payee": f["id"],
                                                "category": "POLE_TOWER", "approved_amount": "100000"}, format="json")
        self.assertEqual(comp.status_code, 201, comp.content)
        cid = comp.json()["id"]
        # ROW officer cannot approve
        self.assertEqual(row.patch(f"/api/compensations/{cid}/", {"status": "APPROVED"}, format="json").status_code, 400)
        pm = self.client_for(Role.PROJECT_MANAGER)
        self.assertEqual(pm.patch(f"/api/compensations/{cid}/", {"status": "APPROVED"}, format="json").status_code, 200)
        self.users[Role.FINANCE].projects.add(self.p1)
        fin = self.client_for(Role.FINANCE)
        p1 = fin.post("/api/payments/", {"compensation": cid, "amount": "60000", "payment_date": "2026-09-10", "mode": "NEFT",
                                         "reference_number": "UTR1"}, format="json")
        self.assertEqual(p1.status_code, 201, p1.content)
        c = fin.get(f"/api/compensations/{cid}/").json()
        self.assertEqual((c["paid_amount"], c["balance_amount"], c["payment_status"]), (60000, 40000, "PARTIAL"))
        self.assertFalse(AssetMilestone.objects.get(asset_id=a["id"], stage_code="AGREEMENT").asset.milestones.filter(stage_code="PAYMENT", completed=True).exists())
        over = fin.post("/api/payments/", {"compensation": cid, "amount": "50000", "payment_date": "2026-09-11"}, format="json")
        self.assertEqual(over.status_code, 400)
        p2 = fin.post("/api/payments/", {"compensation": cid, "amount": "40000", "payment_date": "2026-09-12"}, format="json")
        self.assertEqual(p2.status_code, 201)
        self.assertTrue(AssetMilestone.objects.get(asset_id=a["id"], stage_code="PAYMENT").completed)
        # deleting a payment re-opens the auto milestone
        fin.delete(f"/api/payments/{p2.json()['id']}/")
        self.assertFalse(AssetMilestone.objects.get(asset_id=a["id"], stage_code="PAYMENT").completed)
        # ROW officer cannot record payments
        self.assertEqual(row.post("/api/payments/", {"compensation": cid, "amount": "1", "payment_date": "2026-09-12"}, format="json").status_code, 403)

    def test_dashboard_and_map(self):
        self.make_location()
        d = self.client_for(Role.MANAGEMENT).get("/api/dashboard/").json()
        self.assertEqual(d["assets"], 1)
        self.assertIn("compensation", d)
        d = self.client_for(Role.SURVEYOR).get("/api/dashboard/").json()
        self.assertNotIn("compensation", d)
        m = self.client_for(Role.SURVEYOR).get("/api/map/").json()
        self.assertTrue(any(f["properties"]["kind"] == "asset" for f in m["features"]))


class DocumentTests(Base):
    def test_kyc_document_encrypted_and_restricted(self):
        f, land, a = self.make_location()
        sv = self.client_for(Role.SURVEYOR)
        data = jpeg()
        r = sv.post("/api/documents/", {"category": "KYC_AADHAAR", "farmer": f["id"],
                                        "file": SimpleUploadedFile("a.jpg", data, content_type="image/jpeg")}, format="multipart")
        self.assertEqual(r.status_code, 201, r.content)
        doc = Document.objects.get(pk=r.json()["id"])
        self.assertTrue(doc.is_encrypted)
        with doc.file.open("rb") as fh:
            self.assertNotEqual(fh.read(), data)
        self.assertIsNone(r.json()["download_url"])  # surveyor can upload, not view
        row = self.client_for(Role.ROW_OFFICER)
        url = row.get(f"/api/documents/{doc.id}/").json()["download_url"]
        resp = APIClient().get(url)  # signed link works without auth header
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content, data)
        self.assertTrue(AuditLog.objects.filter(action="VIEW_SENSITIVE").exists())

    def test_site_photo_idempotent_upload(self):
        f, land, a = self.make_location()
        sv = self.client_for(Role.SURVEYOR)
        did = str(uuid.uuid4())
        payload = {"id": did, "category": "SITE_PHOTO", "asset": a["id"], "latitude": "15.6", "longitude": "76.0",
                   "captured_live": "true", "file": SimpleUploadedFile("p.jpg", jpeg(), content_type="image/jpeg")}
        self.assertEqual(sv.post("/api/documents/", payload, format="multipart").status_code, 201)
        payload["file"] = SimpleUploadedFile("p.jpg", jpeg(), content_type="image/jpeg")
        self.assertEqual(sv.post("/api/documents/", payload, format="multipart").status_code, 200)
        self.assertEqual(Document.objects.filter(pk=did).count(), 1)
        self.assertEqual(str(Document.objects.get(pk=did).project_id), str(self.p1.id))

    def test_rejects_other_file_types(self):
        r = self.client_for(Role.SURVEYOR).post("/api/documents/", {"category": "OTHER",
            "file": SimpleUploadedFile("x.exe", b"MZ", content_type="application/octet-stream")}, format="multipart")
        self.assertEqual(r.status_code, 400)


class SyncTests(Base):
    def test_offline_push_then_pull(self):
        sv = self.client_for(Role.SURVEYOR)
        fid, lid, oid, aid, mid = (str(uuid.uuid4()) for _ in range(5))
        ops = [
            {"op_id": str(uuid.uuid4()), "entity": "farmer", "data": {"id": fid, "name": "Offline Farmer", "village": "V", "project_ids": [str(self.p1.id)], "kyc_status": "COLLECTED"}},
            {"op_id": str(uuid.uuid4()), "entity": "land", "data": {"id": lid, "survey_number": "77", "village": "V", "project_ids": [str(self.p1.id)]}},
            {"op_id": str(uuid.uuid4()), "entity": "ownership", "data": {"id": oid, "land_id": lid, "farmer_id": fid, "is_primary_payee": True}},
            {"op_id": str(uuid.uuid4()), "entity": "asset", "data": {"id": aid, "project_id": str(self.p1.id), "asset_number": "P-77", "land_parcel_id": lid, "latitude": 15.1, "longitude": 76.1, "gps_accuracy_m": 8}},
            {"op_id": str(uuid.uuid4()), "entity": "milestone", "data": {"id": mid, "asset_id": aid, "stage_code": "SURVEYED", "completed": True}},
        ]
        r = sv.post("/api/sync/push/", {"ops": ops}, format="json")
        self.assertEqual(r.status_code, 200)
        res = r.json()["results"]
        self.assertTrue(all(x["ok"] for x in res), res)
        self.assertTrue(res[0]["record"]["farmer_code"].startswith("FRM-"))
        # Retrying the same ops (e.g. lost response) must not duplicate anything
        r2 = sv.post("/api/sync/push/", {"ops": ops}, format="json").json()["results"]
        self.assertTrue(all(x.get("duplicate") for x in r2))
        self.assertEqual(Farmer.objects.filter(name="Offline Farmer").count(), 1)
        # Second device marks same stage with a different id -> merged by (asset, stage)
        r3 = sv.post("/api/sync/push/", {"ops": [{"op_id": str(uuid.uuid4()), "entity": "milestone",
                    "data": {"id": str(uuid.uuid4()), "asset_id": aid, "stage_code": "SURVEYED", "completed": True}}]}, format="json").json()["results"][0]
        self.assertTrue(r3["ok"])
        self.assertEqual(r3["id"], mid)
        pull = sv.get("/api/sync/pull/").json()
        self.assertTrue(pull["full"])
        self.assertEqual(len(pull["asset"]), 1)
        inc = sv.get("/api/sync/pull/", {"since": pull["server_time"], "scope": pull["scope"]}).json()
        self.assertFalse(inc["full"])
        self.assertEqual(len(inc["asset"]), 1)  # cursor overlaps by a few minutes; repeats are harmless
        # a partial edit for a record the server does not have is refused, never created
        r4 = sv.post("/api/sync/push/", {"ops": [{"op_id": str(uuid.uuid4()), "entity": "farmer", "action": "update",
                     "data": {"id": str(uuid.uuid4()), "name": "Ghost"}}]}, format="json").json()["results"][0]
        self.assertFalse(r4["ok"])
        self.assertFalse(Farmer.objects.filter(name="Ghost").exists())

    def test_push_permission_errors_reported(self):
        sv = self.client_for(Role.SURVEYOR)
        r = sv.post("/api/sync/push/", {"ops": [{"op_id": str(uuid.uuid4()), "entity": "asset",
                    "data": {"id": str(uuid.uuid4()), "project_id": str(self.p2.id), "asset_number": "X"}}]}, format="json").json()
        self.assertFalse(r["results"][0]["ok"])
        self.assertIn("assigned", r["results"][0]["error"])


class IOTests(Base):
    KML = b"""<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
    <Placemark><name>P-10</name><Point><coordinates>76.01,15.61,0</coordinates></Point></Placemark>
    <Placemark><name>T-11</name><Point><coordinates>76.02,15.62,0</coordinates></Point></Placemark>
    <Placemark><name>Route</name><LineString><coordinates>76.0,15.6 76.1,15.7</coordinates></LineString></Placemark>
    <Placemark><name>45/2</name><Polygon><outerBoundaryIs><LinearRing><coordinates>76,15 76.01,15 76.01,15.01 76,15</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
    </Document></kml>"""

    def test_kml_import_export(self):
        self.make_location()
        c = self.client_for(Role.PROJECT_MANAGER)
        r = c.post("/api/kml/import/", {"project": str(self.p1.id), "file": SimpleUploadedFile("x.kml", self.KML)}, format="multipart")
        self.assertEqual(r.status_code, 200, r.content)
        rep = r.json()
        self.assertEqual((rep["assets_created"], rep["route_lines"], rep["land_boundaries"]), (2, 1, 1))
        self.assertEqual(Asset.objects.get(asset_number="T-11").asset_type, "TOWER")
        e = c.get("/api/kml/export/", {"project": str(self.p1.id)})
        self.assertEqual(e.status_code, 200)
        self.assertIn(b"<Placemark><name>P-10</name>", e.content)

    def test_reports(self):
        f, land, a = self.make_location()
        c = self.client_for(Role.MANAGEMENT)
        for name in ("farmers", "progress", "compensation", "payments", "agreements", "crop", "villages"):
            r = c.get(f"/api/reports/{name}/")
            self.assertEqual(r.status_code, 200, name)
            self.assertEqual(r.content[:2], b"PK")
        self.assertEqual(c.get(f"/api/farmers/{f['id']}/statement/").status_code, 200)
        self.assertEqual(self.client_for(Role.SURVEYOR).get("/api/reports/farmers/").status_code, 403)
