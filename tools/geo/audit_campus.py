#!/usr/bin/env python3
"""
Audit géographique du campus UAC (PHASE 1/2 de la mission jumeau numérique).

Ce script ne modifie AUCUNE donnée du projet : il produit un rapport d'audit
et un jeu de données GeoJSON candidat, à partir d'OpenStreetMap.

Sources :
  - Overpass API (données OSM, licence ODbL) — attribution obligatoire.

Sorties :
  - tools/geo/out/audit-report.json
  - tools/geo/out/osm-buildings-in-campus.geojson
  - tools/geo/out/osm-footways-in-campus.geojson
"""
from __future__ import annotations

import json
import math
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon, shape
from shapely.ops import transform as shapely_transform

OVERPASS = "https://overpass-api.de/api/interpreter"
USER_AGENT = "UAC-Live-3D-Audit/1.0 (projet universitaire; contact: Eucher ABATTI)"
OUT_DIR = Path(__file__).parent / "out"
CACHE_DIR = Path(__file__).parent / "cache"

# Limite du campus UAC dans OSM (way 347214829, amenity=university)
CAMPUS_WAY_ID = 347214829

# UTM zone 31N — projection métrique adaptée au Bénin (calcul de surfaces exactes)
TO_UTM = Transformer.from_crs("EPSG:4326", "EPSG:32631", always_xy=True).transform
FROM_UTM = Transformer.from_crs("EPSG:32631", "EPSG:4326", always_xy=True).transform


def overpass(query: str, cache_name: str) -> dict:
    """Interroge Overpass API avec cache disque (évite de marteler le service)."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / cache_name
    if cache_file.exists() and cache_file.stat().st_size > 200:
        print(f"  [cache] {cache_name}")
        return json.loads(cache_file.read_text())

    print(f"  [reseau] {cache_name} ...")
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(
        OVERPASS, data=data, headers={"User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        body = resp.read().decode("utf-8")
    obj = json.loads(body)
    cache_file.write_text(body)
    return obj


def way_to_polygon(el: dict) -> Polygon | None:
    """Convertit un way OSM (avec geometry) en polygone shapely fermé."""
    geom = el.get("geometry")
    if not geom or len(geom) < 3:
        return None
    coords = [(p["lon"], p["lat"]) for p in geom]
    if coords[0] != coords[-1]:
        coords.append(coords[0])
    try:
        poly = Polygon(coords)
        if not poly.is_valid:
            poly = poly.buffer(0)
        return poly if not poly.is_empty else None
    except Exception:
        return None


def area_m2(poly_4326: Polygon) -> float:
    """Surface exacte en m² via projection UTM 31N."""
    return abs(shapely_transform(TO_UTM, poly_4326).area)


def haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distance en mètres entre deux (lat, lng)."""
    r = 6371008.8
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("=== ETAPE 1 : limite du campus dans OSM ===")
    boundary = overpass(
        f"[out:json][timeout:120];way({CAMPUS_WAY_ID});out geom tags;",
        "campus-boundary.json",
    )
    campus_poly = None
    for el in boundary.get("elements", []):
        if el.get("id") == CAMPUS_WAY_ID:
            campus_poly = way_to_polygon(el)
            campus_name = el.get("tags", {}).get("name", "?")
    if campus_poly is None:
        print("ECHEC: limite du campus introuvable", file=sys.stderr)
        return 1

    campus_area = area_m2(campus_poly)
    print(f"  nom OSM       : {campus_name}")
    print(f"  sommets       : {len(campus_poly.exterior.coords) - 1}")
    print(f"  surface       : {campus_area / 10000:.1f} ha ({campus_area / 1e6:.3f} km2)")
    minx, miny, maxx, maxy = campus_poly.bounds
    print(f"  bbox          : lat {miny:.6f}..{maxy:.6f} / lng {minx:.6f}..{maxx:.6f}")

    print("\n=== ETAPE 2 : batiments OSM dans la bbox ===")
    bbox = f"{miny - 0.0002},{minx - 0.0002},{maxy + 0.0002},{maxx + 0.0002}"
    raw_b = overpass(
        f'[out:json][timeout:180];way["building"]({bbox});out geom tags;',
        "buildings-bbox.json",
    )
    all_buildings = [e for e in raw_b.get("elements", []) if e.get("geometry")]
    print(f"  ways building (bbox) : {len(all_buildings)}")

    print("\n=== ETAPE 3 : filtrage strict par le polygone du campus ===")
    inside: list[dict] = []
    outside = 0
    rejected_invalid = 0
    for el in all_buildings:
        poly = way_to_polygon(el)
        if poly is None:
            rejected_invalid += 1
            continue
        # On garde le batiment si son centroide est dans le campus
        if not campus_poly.contains(poly.representative_point()):
            outside += 1
            continue
        tags = el.get("tags", {})
        c = poly.representative_point()
        inside.append(
            {
                "osmType": "way",
                "osmId": el["id"],
                "geometry": poly,
                "tags": tags,
                "name": tags.get("name") or tags.get("name:fr"),
                "categoryRaw": tags.get("building"),
                "areaM2": area_m2(poly),
                "centroid": (c.y, c.x),  # lat, lng
                "levels": tags.get("building:levels"),
                "height": tags.get("height"),
            }
        )

    named = [b for b in inside if b["name"]]
    print(f"  batiments retenus     : {len(inside)}")
    print(f"  dont nommes           : {len(named)}")
    print(f"  hors campus (rejetes) : {outside}")
    print(f"  geometrie invalide    : {rejected_invalid}")
    total_area = sum(b["areaM2"] for b in inside)
    print(f"  surface batie totale  : {total_area:,.0f} m2")
    print(f"  densite d'occupation  : {100 * total_area / campus_area:.1f} % du campus")

    print("\n=== ETAPE 4 : chemins pietonniers OSM ===")
    # Les voies sont telechargees par lots (tools/geo/fetch_highways.py) car une
    # requete unique depasse le timeout d'Overpass API (504 Gateway Timeout).
    raw_elements: list[dict] = []
    for part in sorted(CACHE_DIR.glob("highways-*.json")) + sorted(CACHE_DIR.glob("road-*.json")):
        raw_elements.extend(json.loads(part.read_text()).get("elements", []))
    raw_w = {"elements": raw_elements}
    print(f"  fichiers de cache    : {len(list(CACHE_DIR.glob('highways-*.json'))) + len(list(CACHE_DIR.glob('road-*.json')))}")
    print(f"  ways bruts           : {len(raw_elements)}")
    foot_types = {"footway", "path", "pedestrian", "steps", "track", "service"}
    foots: list[dict] = []
    for el in raw_w.get("elements", []):
        geom = el.get("geometry")
        if not geom or len(geom) < 2:
            continue
        coords = [(p["lon"], p["lat"]) for p in geom]
        line = LineString(coords)
        if not campus_poly.intersects(line):
            continue
        hw = el.get("tags", {}).get("highway")
        foots.append(
            {
                "osmId": el["id"],
                "highway": hw,
                "isFoot": hw in foot_types,
                "geometry": line,
                "name": el.get("tags", {}).get("name"),
                "lengthM": abs(shapely_transform(TO_UTM, line).length),
            }
        )
    foots_only = [f for f in foots if f["isFoot"]]
    km_all = sum(f["lengthM"] for f in foots) / 1000
    km_foot = sum(f["lengthM"] for f in foots_only) / 1000
    print(f"  voies totales (campus) : {len(foots)} ({km_all:.1f} km)")
    print(f"  dont pietonnier/chemin : {len(foots_only)} ({km_foot:.1f} km)")

    print("\n=== ETAPE 5 : confrontation des 15 batiments en base ===")
    db_path = Path("/tmp/db_buildings.json")
    db_buildings = json.loads(db_path.read_text()) if db_path.exists() else []
    comparisons: list[dict] = []
    for db in db_buildings:
        db_lat, db_lng = db["lat"], db["lng"]
        best, best_d = None, float("inf")
        for b in inside:
            d = haversine((db_lat, db_lng), b["centroid"])
            if d < best_d:
                best, best_d = b, d
        comparisons.append(
            {
                "dbCode": db["code"],
                "dbName": db["name"],
                "dbLat": db_lat,
                "dbLng": db_lng,
                "dbArea": db["area"],
                "nearestOsmId": best["osmId"] if best else None,
                "nearestOsmName": best["name"] if best else None,
                "nearestOsmArea": round(best["areaM2"]) if best else None,
                "distanceM": round(best_d, 1) if best else None,
                "inCampusPolygon": bool(campus_poly.contains(Point(db_lng, db_lat))),
            }
        )
    for c in comparisons:
        flag = "DANS" if c["inCampusPolygon"] else "HORS"
        print(
            f"  {c['dbCode']:12} [{flag}] -> OSM {c['nearestOsmId']} "
            f"({(c['nearestOsmName'] or 'sans nom')[:26]}) ecart {c['distanceM']} m"
        )

    # ------------------------------------------------------------------ sorties
    def to_feature(b: dict, extra: dict | None = None) -> dict:
        props = {
            "osmId": b["osmId"],
            "name": b["name"],
            "building": b["categoryRaw"],
            "areaM2": round(b["areaM2"], 1),
            "levels": b["levels"],
            "height": b["height"],
            "source": "OpenStreetMap",
            "sourceId": f"way/{b['osmId']}",
            "license": "ODbL-1.0",
            "validationStatus": "imported_unverified",
        }
        if extra:
            props.update(extra)
        return {
            "type": "Feature",
            "geometry": json.loads(json.dumps(b["geometry"].__geo_interface__)),
            "properties": props,
        }

    buildings_fc = {
        "type": "FeatureCollection",
        "name": "uac_osm_buildings",
        "attribution": "© OpenStreetMap contributors, ODbL 1.0",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "features": [to_feature(b) for b in inside],
    }
    (OUT_DIR / "osm-buildings-in-campus.geojson").write_text(
        json.dumps(buildings_fc, ensure_ascii=False, indent=1)
    )

    foots_fc = {
        "type": "FeatureCollection",
        "name": "uac_osm_footways",
        "attribution": "© OpenStreetMap contributors, ODbL 1.0",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "features": [
            {
                "type": "Feature",
                "geometry": json.loads(json.dumps(f["geometry"].__geo_interface__)),
                "properties": {
                    "osmId": f["osmId"],
                    "highway": f["highway"],
                    "name": f["name"],
                    "lengthM": round(f["lengthM"], 1),
                    "source": "OpenStreetMap",
                    "sourceId": f"way/{f['osmId']}",
                    "license": "ODbL-1.0",
                    "validationStatus": "imported_unverified",
                },
            }
            for f in foots
        ],
    }
    (OUT_DIR / "osm-footways-in-campus.geojson").write_text(
        json.dumps(foots_fc, ensure_ascii=False, indent=1)
    )

    report = {
        "auditVersion": 1,
        "generatedAt": "2026-11-21",
        "sources": [
            {
                "name": "OpenStreetMap via Overpass API",
                "license": "ODbL-1.0",
                "attribution": "© OpenStreetMap contributors",
                "endpoint": OVERPASS,
                "osmBaseTimestamp": boundary.get("osm3s", {}).get("timestamp_osm_base"),
            }
        ],
        "campus": {
            "osmWayId": CAMPUS_WAY_ID,
            "name": campus_name,
            "vertices": len(campus_poly.exterior.coords) - 1,
            "areaM2": round(campus_area, 1),
            "areaHectares": round(campus_area / 10000, 2),
            "bbox": {
                "south": round(miny, 6),
                "west": round(minx, 6),
                "north": round(maxy, 6),
                "east": round(maxx, 6),
            },
        },
        "buildings": {
            "inCampus": len(inside),
            "named": len(named),
            "rejectedOutside": outside,
            "rejectedInvalidGeometry": rejected_invalid,
            "totalFootprintM2": round(total_area, 1),
            "coveragePercentOfCampus": round(100 * total_area / campus_area, 2),
        },
        "ways": {
            "total": len(foots),
            "pedestrian": len(foots_only),
            "lengthTotalKm": round(km_all, 2),
            "lengthPedestrianKm": round(km_foot, 2),
        },
        "dbComparison": comparisons,
    }
    (OUT_DIR / "audit-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2)
    )

    print("\n=== SORTIES ===")
    for f in sorted(OUT_DIR.iterdir()):
        print(f"  {f.name}  ({f.stat().st_size:,} o)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
