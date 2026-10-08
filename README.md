# ROW Manager – Farmer ROW & Land Compensation Management System (prototype)

Prototype for Ipower Engineering Services LLP. It tracks farmers, land/survey numbers, poles and towers,
agreements, compensation and manually recorded payments, and the seven progress stages of every
location, from survey to staywire.

```
rowms/
  backend/   Django 5.2 + Django REST Framework API, PostgreSQL (SQLite works for a quick look)
  web/       React web admin (dashboard, records, map, reports, users, activity log)
  mobile/    Android field app (Expo / React Native), offline-first with background sync
```

## What the prototype does

**Web admin** (all office roles)
- Dashboard per project or across projects: farmers, survey numbers, locations, agreements executed/pending,
  crop claims, ROW cleared %, progress by stage, a "line progress" diagram (each pole a column, each stage a row),
  and compensation approved / paid / balance.
- Farmers with a permanent Farmer ID (`FRM-000001`), masked Aadhaar (last 4 digits only), KYC status,
  encrypted bank details, and a lifetime history across all projects, survey numbers, poles, agreements,
  crop claims and payments. Excel farmer statement.
- Land records with joint owners and one primary payee; poles/towers/substations/access roads/lines with GPS.
- The seven stages – Surveyed, KYC, Agreement, Payment, Pole Erection, Stringing, Staywire & Accessories –
  can be marked in any order. KYC is taken from the farmer record; "Agreement Executed" and "Payment Made"
  are also set automatically when an agreement is executed or the location's compensation is fully paid.
- Agreements (lease / ROW / easement / consent) with scanned signed copies.
- Compensation by category (crop, tree, pole/tower, land, access road, other), approval by Project Manager / Admin,
  and **manually recorded** payments in instalments. Nothing transfers money.
- Map (OpenStreetMap / satellite) of routes, land boundaries and locations coloured by progress or by a chosen stage.
- KML/KMZ import (points → poles/towers, lines → route, polygons → land boundaries) and KML export.
- Excel reports: farmer list, pole/tower progress & GPS, compensation statement, payment register,
  agreements, crop assessments, village/hobli/taluk summary.
- Users and roles, project assignment, activity log of every change, approval, export and sensitive-document view.

**Android field app** (Field Surveyor, also usable by ROW Officers)
- Works with no signal: everything is saved on the phone and uploaded automatically when connectivity returns
  (also retried every minute while anything is waiting). Retried uploads are never applied twice.
- Register farmers, land records and poles/towers; link owners; mark stages done with date, remarks and proof photos.
- GPS capture with live accuracy; a warning (not a block) when accuracy is worse than the configurable limit (15 m).
- Live camera photos (tagged with GPS and time) or gallery uploads; KYC and bank-proof photos are encrypted on the server.
- Crop assessments with photos and GPS.
- A sync screen showing what is waiting, anything the server refused (e.g. a stage the role cannot change), and re-download.

## Roles

| Role | Sees | Can change |
|---|---|---|
| Company Administrator | everything | everything, users, settings |
| Project Manager | assigned projects | all records; approves compensation |
| Land / ROW Officer | assigned projects | farmers, land, agreements, proposes compensation; bank details |
| Field Surveyor | assigned projects only, no money | farmers, land, locations, stages (not Agreement/Payment), crop, photos |
| Finance User | all projects | records payments, "Payment Made" stage, bank details |
| Management | all projects | read only |
| Farmer User | – | reserved for the future farmer portal |

The rules are all in `backend/core/access.py`.

## Quick start with Docker (recommended)

Requires Docker Desktop.

```bash
cp .env.example .env        # then edit SECRET_KEY and FIELD_ENCRYPTION_KEY
docker compose up --build
```

Open http://localhost:8000. With `SEED_DEMO=true` the demo data and users are loaded on first start:

| Username | Role | Password |
|---|---|---|
| admin | Company Administrator | Demo@1234 |
| pm | Project Manager | Demo@1234 |
| rowofficer | Land / ROW Officer | Demo@1234 |
| surveyor1, surveyor2 | Field Surveyor | Demo@1234 |
| finance | Finance User | Demo@1234 |
| management | Management | Demo@1234 |

Set `SEED_DEMO=false` and change or deactivate the demo users before real data goes in.

## Running without Docker (development)

```bash
# API
cd backend
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_demo
python manage.py runserver 0.0.0.0:8000           # uses SQLite unless DATABASE_URL is set

# Web admin (second terminal)
cd web
npm install
npm run dev                                       # http://localhost:5173, proxies /api to :8000
```

Tests: `cd backend && python manage.py test core` (22 tests). Field-app sync check against a running server:
`python scripts/simulate_field_app.py http://127.0.0.1:8000 surveyor1 Demo@1234`.

## Building the Android app

The app is an Expo (SDK 54) project. Expo Go from the Play Store only runs the newest SDK, so install a built APK:

**Option A – Expo's cloud build (no Android Studio needed)**
```bash
cd mobile
npm install
npm install -g eas-cli
eas login                      # free account at expo.dev
eas build -p android --profile preview
```
EAS gives a link to download the `.apk`. Install it on the phones (allow "install unknown apps").

**Option B – build on your computer** (Android Studio + JDK 17):
```bash
cd mobile && npm install
npx expo prebuild -p android
cd android && ./gradlew assembleRelease     # APK in android/app/build/outputs/apk/release/
```

On first launch enter the **server address**: during a pilot this is the office computer running Docker,
e.g. `192.168.1.20:8000` (phone and computer on the same Wi-Fi); in production an HTTPS address such as
`row.yourcompany.in`. Plain HTTP is allowed in this prototype build so a local pilot works; use HTTPS for real data.

## Security notes

- The full Aadhaar number is never stored: only the last 4 digits. Uploaded Aadhaar, other ID and bank-proof
  images are encrypted at rest (Fernet / AES) and only Admin, Project Manager and ROW Officer (bank proof: also
  Finance) can open them; every view is written to the activity log. Surveyors can upload but not re-open them.
- Bank account numbers are encrypted in the database and hidden from roles that do not need them.
- Documents are never served as public files – only through short-lived signed links checked against the user's role.
- **Keep `FIELD_ENCRYPTION_KEY` safe and backed up.** Without it encrypted documents cannot be read.
- Back up the `pgdata` and `media` Docker volumes (database and documents) daily.
- Before go-live: HTTPS, strong passwords, remove demo users, and a legal check of Aadhaar/DPDP Act handling.

## Deliberately left for later (designed to be added without rework)

Multi-company (a `Company` table already exists), ownership-share split compensation (`share_percent` field exists),
span-level stringing (P-244 → P-245), asset-specific stage lists (`StageDefinition.asset_types`), automatic
compensation rates, multi-level approvals, farmer portal with OTP login, e-signatures, Kannada,
background sync while the app is closed, PostGIS spatial queries, Play Store release (needs the app upgraded
to a current Expo SDK at that time).
