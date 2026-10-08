"""End-to-end check of the field app sync protocol against a running server.

Mirrors exactly the payloads the Android app sends (see mobile/src/store.ts and
mobile/src/sync.ts): offline-created records with client UUIDs, "_id" style
foreign keys, partial updates, a retried batch, a photo upload and a pull.

    python scripts/simulate_field_app.py http://127.0.0.1:8000 surveyor1 Demo@1234
"""
import io
import json
import sys
import urllib.parse
import urllib.request
import uuid

BASE, USER, PWD = (sys.argv[1:] + ["http://127.0.0.1:8000", "surveyor1", "Demo@1234"][len(sys.argv[1:]):])[:3]
TOKEN = None


def call(path, body=None, form=None, method=None):
    headers = {"Accept": "application/json"}
    if TOKEN:
        headers["Authorization"] = f"Token {TOKEN}"
    data = None
    if form is not None:
        boundary = uuid.uuid4().hex
        buf = io.BytesIO()
        for k, v in form.items():
            buf.write(f"--{boundary}\r\n".encode())
            if isinstance(v, tuple):
                name, content, ctype = v
                buf.write(f'Content-Disposition: form-data; name="{k}"; filename="{name}"\r\nContent-Type: {ctype}\r\n\r\n'.encode())
                buf.write(content)
            else:
                buf.write(f'Content-Disposition: form-data; name="{k}"\r\n\r\n{v}'.encode())
            buf.write(b"\r\n")
        buf.write(f"--{boundary}--\r\n".encode())
        data = buf.getvalue()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + "/api/" + path, data=data, headers=headers, method=method or ("POST" if data else "GET"))
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def ok(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        sys.exit(1)


st, res = call("auth/login/", {"username": USER, "password": PWD, "client": "MOBILE"})
ok(st == 200, f"login as {USER}")
TOKEN = res["token"]

st, pull = call("sync/pull/")
ok(st == 200 and pull["full"], "full pull")
for key in ("projects", "farmer", "land", "ownership", "asset", "milestone", "crop", "stages", "settings", "me", "choices"):
    ok(key in pull, f"pull contains {key}")
ok(pull["settings"]["GPS_ACCURACY_WARNING_METERS"] == 15, "GPS warning limit delivered to phone")
project = pull["projects"][0]["id"]

fid, lid, oid, aid, mid, cid = (str(uuid.uuid4()) for _ in range(6))
op = lambda entity, data, action="create": {"op_id": str(uuid.uuid4()), "entity": entity, "action": action, "data": data}
batch = [
    op("farmer", {"id": fid, "name": "Field Test Farmer", "relation_type": "S/O", "relation_name": "Test Father", "mobile": "9876543210",
                  "alt_mobile": "", "address": "", "village": "Testpura", "hobli": "", "taluk": "Yelburga", "district": "Koppal", "state": "Karnataka",
                  "status": "ACTIVE", "aadhaar_last4": "4321", "kyc_status": "COLLECTED", "remarks": "", "project_ids": [project]}),
    op("land", {"id": lid, "survey_number": "999", "hissa": "2A", "village": "Testpura", "hobli": "", "taluk": "Yelburga", "district": "Koppal",
                "state": "Karnataka", "extent_acres": 2, "extent_guntas": 20, "ownership_type": "INDIVIDUAL", "land_type": "DRY", "rtc_reference": "",
                "remarks": "", "project_ids": [project], "latitude": 15.6123456, "longitude": 76.0123456, "gps_accuracy_m": 6.5,
                "gps_captured_at": "2026-10-08T10:00:00.000Z"}),
    op("ownership", {"id": oid, "land_id": lid, "farmer_id": fid, "is_primary_payee": True}),
    op("asset", {"id": aid, "project_id": project, "asset_type": "POLE", "asset_number": "P-TEST-1", "line_name": "Test line",
                 "land_parcel_id": lid, "remarks": "", "latitude": 15.6124, "longitude": 76.0125, "gps_accuracy_m": 21.4,
                 "gps_captured_at": "2026-10-08T10:01:00.000Z"}),
    op("milestone", {"id": mid, "asset_id": aid, "stage_code": "SURVEYED", "completed": True, "completed_on": "2026-10-08", "remarks": "",
                     "latitude": 15.6124, "longitude": 76.0125, "gps_accuracy_m": 21.4}),
    op("milestone", {"id": str(uuid.uuid4()), "asset_id": aid, "stage_code": "PAYMENT", "completed": True, "completed_on": "2026-10-08", "remarks": ""}),
    op("crop", {"id": cid, "project_id": project, "farmer_id": fid, "land_parcel_id": lid, "asset_id": aid, "season": "KHARIF", "crop_type": "Maize",
                "crop_area_acres": 0.4, "crop_stage": "VEGETATIVE", "assessment_date": "2026-10-08", "field_inspection_notes": "Trampled during survey",
                "revenue_assessment": None, "company_assessment": 5000}),
    op("farmer", {"id": fid, "mobile": "9876500000"}, "update"),
    op("farmer", {"id": str(uuid.uuid4()), "name": "Ghost"}, "update"),
]
st, res = call("sync/push/", {"ops": batch})
ok(st == 200, "push batch accepted")
results = {r["op_id"]: r for r in res["results"]}
for o in batch:
    r = results[o["op_id"]]
    expect_fail = o["data"].get("stage_code") == "PAYMENT" or o["data"].get("name") == "Ghost"
    ok(r["ok"] != expect_fail, f"{o['entity']} {o['data'].get('stage_code') or ''} -> {'rejected' if expect_fail else 'saved'}"
       + (f" ({r.get('error')})" if not r["ok"] else ""))
farmer_rec = results[batch[0]["op_id"]]["record"]
ok(farmer_rec["farmer_code"].startswith("FRM-"), f"farmer got permanent ID {farmer_rec['farmer_code']}")
ok(results[batch[-2]["op_id"]]["record"]["mobile"] == "9876500000", "partial update applied")

st, res2 = call("sync/push/", {"ops": batch})
ok(all(r.get("duplicate") or not r["ok"] for r in res2["results"]), "retried batch is not applied twice")

# second device marks the same stage with a different id -> merged
other = op("milestone", {"id": str(uuid.uuid4()), "asset_id": aid, "stage_code": "SURVEYED", "completed": True, "completed_on": "2026-10-07"}, "create")
st, res3 = call("sync/push/", {"ops": [other]})
ok(res3["results"][0]["id"] == mid, "same pole+stage from another phone merges into one record (id re-mapped)")

png = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000" "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")
doc_id = str(uuid.uuid4())
form = {"id": doc_id, "category": "SITE_PHOTO", "title": "P-TEST-1 Farmer Location Surveyed", "asset": aid, "milestone": mid,
        "latitude": "15.6124", "longitude": "76.0125", "gps_accuracy_m": "21.4", "captured_live": "true",
        "captured_at": "2026-10-08T10:02:00.000Z", "file": (f"{doc_id}.jpg", png, "image/png")}
st, d = call("documents/", form=form)
ok(st == 201, "photo uploaded with GPS and links")
st, d = call("documents/", form=form)
ok(st == 200, "photo re-upload is idempotent")
st, d = call("documents/", form={"id": str(uuid.uuid4()), "category": "KYC_AADHAAR", "farmer": fid, "captured_live": "true", "file": ("a.jpg", png, "image/png")})
ok(st == 201 and d["download_url"] is None, "surveyor uploads KYC photo but cannot open it afterwards")

st, inc = call("sync/pull/?" + urllib.parse.urlencode({"since": pull["server_time"], "scope": pull["scope"]}))
ok(st == 200 and not inc["full"], "incremental pull")
ok(any(a["id"] == aid for a in inc["asset"]), "new pole comes back in incremental pull")

st, a = call(f"assets/{aid}/")
prog = {s["code"]: s for s in a["progress"]["stages"]}
ok(prog["SURVEYED"]["completed"] and prog["KYC"]["completed"] and not prog["PAYMENT"]["completed"], "web view shows Surveyed + KYC done, Payment pending")
ok(a["gps_warning"], "21.4 m accuracy flagged against the 15 m limit")

# cleanup so the demo stays tidy
TOKEN = call("auth/login/", {"username": "admin", "password": PWD})[1]["token"]
for path in (f"crop-assessments/{cid}/", f"assets/{aid}/", f"ownerships/{oid}/", f"lands/{lid}/", f"farmers/{fid}/"):
    call(path, method="DELETE")
print("All field-app sync checks passed.")
