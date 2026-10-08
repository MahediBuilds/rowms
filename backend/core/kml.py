"""KML / KMZ import and export.

Import rules (per project):
* Point placemarks      -> infrastructure locations (assets). The placemark name is
                            the pole/tower number. Existing numbers are updated.
* LineString placemarks -> the project's corridor / route line.
* Polygon placemarks    -> land boundary, when the placemark name matches a survey
                            number ("45/2" or "45") of a land record in the project.
"""
import io
import re
import zipfile
from decimal import Decimal
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

from django.db import transaction
from django.utils import timezone

from .models import Asset, AssetType, LandParcel

MAX_KML_BYTES = 20 * 1024 * 1024


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def _coords(text):
    pts = []
    for chunk in (text or "").split():
        parts = chunk.split(",")
        if len(parts) >= 2:
            try:
                pts.append([float(parts[0]), float(parts[1])])
            except ValueError:
                continue
    return pts


def read_kml_bytes(upload):
    raw = upload.read(MAX_KML_BYTES + 1)
    if len(raw) > MAX_KML_BYTES:
        raise ValueError("File is too large (max 20 MB).")
    if raw[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            names = [n for n in zf.namelist() if n.lower().endswith(".kml")]
            if not names:
                raise ValueError("No .kml file found inside the KMZ.")
            info = zf.getinfo(names[0])
            if info.file_size > MAX_KML_BYTES:
                raise ValueError("KML inside KMZ is too large.")
            raw = zf.read(names[0])
    return raw


def parse_placemarks(raw):
    # Refuse DTDs/entities (XML bomb protection)
    if b"<!DOCTYPE" in raw[:2000] or b"<!ENTITY" in raw:
        raise ValueError("Unsupported KML (DTD/entities not allowed).")
    root = ET.fromstring(raw)
    out = []
    for pm in root.iter():
        if _local(pm.tag) != "Placemark":
            continue
        name, desc, ext = "", "", {}
        geoms = []
        for el in pm.iter():
            t = _local(el.tag)
            if t == "name" and not name:
                name = (el.text or "").strip()
            elif t == "description" and not desc:
                desc = (el.text or "").strip()
            elif t in ("Data", "SimpleData"):
                key = el.get("name")
                val = el.text
                if t == "Data":
                    v = next((c for c in el if _local(c.tag) == "value"), None)
                    val = v.text if v is not None else ""
                if key:
                    ext[key.strip().lower()] = (val or "").strip()
            elif t == "Point":
                c = next((x for x in el.iter() if _local(x.tag) == "coordinates"), None)
                pts = _coords(c.text if c is not None else "")
                if pts:
                    geoms.append({"type": "Point", "coordinates": pts[0]})
            elif t == "LineString":
                c = next((x for x in el.iter() if _local(x.tag) == "coordinates"), None)
                pts = _coords(c.text if c is not None else "")
                if len(pts) >= 2:
                    geoms.append({"type": "LineString", "coordinates": pts})
            elif t == "Polygon":
                outer = next((x for x in el.iter() if _local(x.tag) == "outerBoundaryIs"), None)
                scope = outer if outer is not None else el
                c = next((x for x in scope.iter() if _local(x.tag) == "coordinates"), None)
                pts = _coords(c.text if c is not None else "")
                if len(pts) >= 3:
                    if pts[0] != pts[-1]:
                        pts.append(pts[0])
                    geoms.append({"type": "Polygon", "coordinates": [pts]})
        for g in geoms:
            out.append({"name": name, "description": desc, "data": ext, "geometry": g})
    return out


def guess_asset_type(name, default):
    n = name.upper()
    if re.match(r"^(T|TWR|TOWER|AP)[-\s]?\d", n):
        return AssetType.TOWER
    if re.match(r"^(P|POLE|LOC)[-\s]?\d", n):
        return AssetType.POLE
    if "SS" in n or "SUBSTATION" in n:
        return AssetType.SUBSTATION
    return default


@transaction.atomic
def import_kml(project, raw, user, default_type=AssetType.POLE, line_name=""):
    marks = parse_placemarks(raw)
    report = {"assets_created": 0, "assets_updated": 0, "route_lines": 0, "land_boundaries": 0, "skipped": []}
    lines = []
    existing = {a.asset_number.upper(): a for a in Asset.objects.filter(project=project)}
    lands = list(LandParcel.objects.filter(projects=project))
    for i, pm in enumerate(marks):
        g = pm["geometry"]
        name = pm["name"] or pm["data"].get("name") or ""
        if g["type"] == "Point":
            if not name:
                name = f"PT-{i + 1:04d}"
            lon, lat = g["coordinates"]
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                report["skipped"].append(f"{name}: invalid coordinates")
                continue
            a = existing.get(name.upper())
            atype = pm["data"].get("type", "").upper()
            atype = atype if atype in AssetType.values else guess_asset_type(name, default_type)
            if a is None:
                a = Asset(project=project, asset_number=name, asset_type=atype, created_by=user,
                          line_name=line_name or pm["data"].get("line", ""))
                report["assets_created"] += 1
                existing[name.upper()] = a
            else:
                report["assets_updated"] += 1
            a.latitude = Decimal(str(round(lat, 7)))
            a.longitude = Decimal(str(round(lon, 7)))
            a.gps_captured_at = timezone.now()
            a.gps_accuracy_m = None
            a.updated_by = user
            if pm["description"] and not a.remarks:
                a.remarks = re.sub(r"<[^>]+>", " ", pm["description"])[:1000]
            a.save()
        elif g["type"] == "LineString":
            lines.append(g["coordinates"])
        elif g["type"] == "Polygon":
            key = name.replace(" ", "").upper()
            match = next((lp for lp in lands if lp.survey_label.replace(" ", "").upper() == key), None)
            if match is None:
                match = next((lp for lp in lands if lp.survey_number.replace(" ", "").upper() == key and not lp.hissa), None)
            if match:
                match.boundary_geojson = g
                ring = g["coordinates"][0]
                if match.latitude is None:
                    match.longitude = Decimal(str(round(sum(p[0] for p in ring) / len(ring), 7)))
                    match.latitude = Decimal(str(round(sum(p[1] for p in ring) / len(ring), 7)))
                match.updated_by = user
                match.save()
                report["land_boundaries"] += 1
            else:
                report["skipped"].append(f"Polygon '{name}': no land record with that survey number in this project")
    if lines:
        project.route_geojson = {"type": "MultiLineString", "coordinates": lines}
        project.updated_by = user
        project.save()
        report["route_lines"] = len(lines)
    report["skipped"] = report["skipped"][:50]
    return report


STATUS_COLORS = {  # KML colours are aabbggrr
    0: "ff9e9e9e", 1: "ff3d8bff", 2: "ff00c0ff", 3: "ff00d7ff", 4: "ff50af4c", 5: "ff2e7d32",
}


def export_kml(project_name, assets_with_progress, lands, route):
    def pm_point(a, prog):
        done = prog["completed_count"]
        style = "#s%d" % min(5, done * 5 // max(1, prog["total"]))
        rows = "".join(
            f'<Data name="{escape(st["name"])}"><value>{"Yes" if st["completed"] else "No"}</value></Data>'
            for st in prog["stages"]
        )
        return (
            f"<Placemark><name>{escape(a.asset_number)}</name><styleUrl>{style}</styleUrl>"
            f"<ExtendedData><Data name=\"type\"><value>{a.asset_type}</value></Data>"
            f"<Data name=\"survey\"><value>{escape(a.land_parcel.survey_label if a.land_parcel_id else '')}</value></Data>"
            f"{rows}</ExtendedData>"
            f"<Point><coordinates>{a.longitude},{a.latitude},0</coordinates></Point></Placemark>"
        )

    parts = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
             f"<name>{escape(project_name)}</name>"]
    for k, color in STATUS_COLORS.items():
        parts.append(f'<Style id="s{k}"><IconStyle><color>{color}</color><scale>0.9</scale>'
                     '<Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>')
    parts.append("<Folder><name>Locations</name>")
    for a, prog in assets_with_progress:
        if a.latitude is not None:
            parts.append(pm_point(a, prog))
    parts.append("</Folder>")
    if lands:
        parts.append("<Folder><name>Land parcels</name>")
        for lp in lands:
            g = lp.boundary_geojson
            if g and g.get("type") == "Polygon":
                coords = " ".join(f"{x},{y},0" for x, y in g["coordinates"][0])
                parts.append(f"<Placemark><name>{escape(lp.survey_label)}</name><description>{escape(lp.village)}</description>"
                             f"<Polygon><outerBoundaryIs><LinearRing><coordinates>{coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>")
        parts.append("</Folder>")
    if route and route.get("type") in ("LineString", "MultiLineString"):
        lines = [route["coordinates"]] if route["type"] == "LineString" else route["coordinates"]
        parts.append("<Folder><name>Route</name>")
        for ln in lines:
            coords = " ".join(f"{x},{y},0" for x, y in ln)
            parts.append(f"<Placemark><name>Route</name><LineString><coordinates>{coords}</coordinates></LineString></Placemark>")
        parts.append("</Folder>")
    parts.append("</Document></kml>")
    return "".join(parts)
