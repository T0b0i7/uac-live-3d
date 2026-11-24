#!/usr/bin/env python3
"""
Construit le référentiel géographique consommable par le frontend UAC-LIVE 3D.

Entrées (déjà produites par audit_campus.py, licence ODbL — © OpenStreetMap
contributors) :
  - tools/geo/out/osm-buildings-in-campus.geojson   (355 emprises réelles)
  - tools/geo/out/osm-footways-in-campus.geojson    (117 cheminements réels)
  - tools/geo/cache/campus-boundary.json            (frontière officielle OSM)

Sortie :
  - src/data/geo/campus-real.json   (prototype premium, racine du dépôt)

Principe de projection
----------------------
Les coordonnées WGS84 (lon, lat) sont projetées en UTM 31N (EPSG:32631),
le système métrique officiel du Bénin, puis translatées dans un repère local
dont l'origine (0,0) est le barycentre des emprises. 1 unité = 1 mètre.

Convention d'axes retenue pour le rendu :
    x = est   (abscisse du plan, croissante vers la droite)
    z = -nord (ordonnée du plan ; en Three.js -Z pointe vers le nord)
Le nord est donc en haut de la carte et vers -Z dans la scène 3D : la carte
2D et la vue 3D restent alignées sur le même repère.

Aucune coordonnée n'est inventée : chaque sommet provient d'OSM. Seules les
hauteurs sont estimées (OSM ne fournit que 18 valeurs de `levels` sur 355
bâtiments) et sont explicitement marquées comme telles.
"""

from __future__ import annotations

import json
import math
from collections import Counter
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import Polygon
from shapely.ops import transform as shapely_transform

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "tools" / "geo" / "out"
CACHE_DIR = ROOT / "tools" / "geo" / "cache"
WEB_DATA = ROOT / "src" / "data" / "geo"

SRC_CRS = "EPSG:4326"
DST_CRS = "EPSG:32631"  # UTM 31N — Bénin

# Hauteur par défaut quand OSM ne donne ni `height` ni `levels`.
# Valeur médiane observée sur le campus : R+1 (amphis et blocs pédagogiques).
DEFAULT_LEVELS = 2
METRES_PER_LEVEL = 3.4


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def build_projection(easting_origin: float, northing_origin: float):
    """Retourne lon/lat -> (x, z) local en mètres, axes carte/three.js."""
    fwd = Transformer.from_crs(SRC_CRS, DST_CRS, always_xy=True)

    def project(lon: float, lat: float) -> tuple[float, float]:
        e, n = fwd.transform(lon, lat)
        x = e - easting_origin
        y = n - northing_origin
        return (x, -y)

    return project


def ring_to_local(ring: list[list[float]], project) -> list[list[float]]:
    """Anneau WGS84 [lon, lat] -> anneau local [[x, z], ...]."""
    pts = [project(lon, lat) for lon, lat in ring]
    # Dédoublonne les sommets consécutifs (certaines emprises OSM en ont).
    dedup: list[list[float]] = []
    for p in pts:
        if not dedup or abs(p[0] - dedup[-1][0]) > 1e-6 or abs(p[1] - dedup[-1][1]) > 1e-6:
            dedup.append([round(p[0], 2), round(p[1], 2)])
    if len(dedup) > 1 and dedup[0] == dedup[-1]:
        dedup.pop()
    return dedup


def signed_area(ring: list[list[float]]) -> float:
    """Aire signée du plan (x, z). Positive si l'anneau est antihoraire."""
    s = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return s / 2.0


def ensure_ccw(ring: list[list[float]]) -> list[list[float]]:
    """Garantit un ordre antihoraire, requis par THREE.Shape."""
    return ring if signed_area(ring) > 0 else list(reversed(ring))


def main() -> None:
    buildings_geo = load_json(OUT_DIR / "osm-buildings-in-campus.geojson")
    footways_geo = load_json(OUT_DIR / "osm-footways-in-campus.geojson")
    boundary_raw = load_json(CACHE_DIR / "campus-boundary.json")
    audit = load_json(OUT_DIR / "audit-report.json")

    feats = buildings_geo["features"]

    # --- Origine : barycentre pondéré par la surface des emprises ------------
    fwd_probe = Transformer.from_crs(SRC_CRS, DST_CRS, always_xy=True)
    sum_e = sum_n = sum_area = 0.0
    for f in feats:
        ring = f["geometry"]["coordinates"][0]
        poly = Polygon([(lon, lat) for lon, lat in ring])
        if not poly.is_valid or poly.area <= 0:
            continue
        c = poly.centroid
        e, n = fwd_probe.transform(c.x, c.y)
        a = poly.area
        sum_e += e * a
        sum_n += n * a
        sum_area += a
    easting0 = sum_e / sum_area
    northing0 = sum_n / sum_area

    project = build_projection(easting0, northing0)

    # --- Frontière du campus ------------------------------------------------
    boundary_el = boundary_raw["elements"][0]
    boundary_ring_wgs = [[p["lon"], p["lat"]] for p in boundary_el["geometry"]]
    boundary_ring = ensure_ccw(ring_to_local(boundary_ring_wgs, project))

    # --- Bâtiments ----------------------------------------------------------
    out_buildings = []
    skipped = 0
    for f in feats:
        props = f["properties"]
        geom = f["geometry"]
        if geom["type"] != "Polygon":
            skipped += 1
            continue
        ring = ensure_ccw(ring_to_local(geom["coordinates"][0], project))
        if len(ring) < 3:
            skipped += 1
            continue

        # Recalcule l'aire dans le repère local (projection conforme -> fiable).
        local_poly = Polygon(ring)
        area_local = abs(local_poly.area)

        levels = props.get("levels")
        if isinstance(levels, str):
            try:
                levels = int(float(levels))
            except ValueError:
                levels = None
        height_tag = props.get("height")
        if isinstance(height_tag, str):
            try:
                height_tag = float(height_tag.replace("m", "").strip())
            except ValueError:
                height_tag = None

        if height_tag and height_tag > 0:
            height = height_tag
            height_source = "osm_height"
        elif levels:
            height = levels * METRES_PER_LEVEL
            height_source = "osm_levels"
        else:
            height = DEFAULT_LEVELS * METRES_PER_LEVEL
            height_source = "estimated"

        interior = []
        for hole in geom["coordinates"][1:]:
            h = ring_to_local(hole, project)
            if len(h) >= 3:
                interior.append(ensure_ccw(h))

        out_buildings.append(
            {
                "osmId": props["osmId"],
                "name": props.get("name"),
                "building": props.get("building"),
                "areaM2": round(area_local, 1),
                "levels": levels,
                "height": round(height, 1),
                "heightSource": height_source,
                "ring": ring,
                "holes": interior,
            }
        )

    # --- Cheminements -------------------------------------------------------
    out_footways = []
    for f in footways_geo["features"]:
        props = f["properties"]
        geom = f["geometry"]
        if geom["type"] != "LineString":
            continue
        line = [list(project(lon, lat)) for lon, lat in geom["coordinates"]]
        line = [[round(p[0], 2), round(p[1], 2)] for p in line]
        if len(line) < 2:
            continue
        out_footways.append(
            {
                "osmId": props["osmId"],
                "highway": props.get("highway"),
                "name": props.get("name"),
                "lengthM": props.get("lengthM"),
                "line": line,
            }
        )

    # --- Catégorisation -----------------------------------------------------
    def categorize(name: str | None, tag: str | None) -> str:
        n = (name or "").lower()
        if any(k in n for k in ("restaurant", "cafétéria", "cafeteria", "cantine", "crous")):
            return "food"
        if any(k in n for k in ("résidence", "residence", "internat", "cité", "cite ")):
            return "residence"
        if any(k in n for k in ("amphi", "auditorium")):
            return "amphitheatre"
        if any(k in n for k in ("bibliothèque", "bibliotheque", "library")):
            return "library"
        if any(k in n for k in ("administration", "rectorat", "scolarité", "scolarite", "secrétariat")):
            return "administration"
        if any(k in n for k in ("stade", "terrain", "gymnase", "sport", "piscine")):
            return "sports"
        if any(k in n for k in ("infirmerie", "clinique", "centre de santé", "pharmacie")):
            return "service"
        if any(k in n for k in ("laboratoire", "labo", "salle de cours", "salle", "bâtiment", "batiment")):
            return "academic"
        if tag in ("school", "university", "college"):
            return "academic"
        if tag in ("retail", "office", "commercial"):
            return "service"
        if tag == "residential":
            return "residence"
        return "academic"

    for b in out_buildings:
        b["category"] = categorize(b["name"], b["building"])

    # --- Bornes -------------------------------------------------------------
    all_x, all_z = [], []
    for b in out_buildings:
        for x, z in b["ring"]:
            all_x.append(x)
            all_z.append(z)
    for fw in out_footways:
        for x, z in fw["line"]:
            all_x.append(x)
            all_z.append(z)

    bounds = {
        "minX": round(min(all_x), 1),
        "maxX": round(max(all_x), 1),
        "minZ": round(min(all_z), 1),
        "maxZ": round(max(all_z), 1),
    }

    categories = Counter(b["category"] for b in out_buildings)
    named = [b for b in out_buildings if b["name"]]

    payload = {
        "$comment": (
            "Référentiel géographique réel dérivé d'OpenStreetMap. "
            "Licence ODbL-1.0 — © OpenStreetMap contributors. "
            "Repère local métrique (1 unité = 1 m), origine = barycentre des "
            "emprises. x = est, z = -nord (le nord pointe vers -Z). "
            "Aucune coordonnée n'est inventée ; les hauteurs sont estimées "
            "quand OSM ne les fournit pas (voir heightSource)."
        ),
        "meta": {
            "crs": DST_CRS,
            "unit": "metre",
            "origin": {"easting": round(easting0, 2), "northing": round(northing0, 2)},
            "osmBaseTimestamp": audit.get("sources", [{}])[0].get("osmBaseTimestamp"),
            "generatedAt": audit.get("generatedAt"),
            "license": "ODbL-1.0",
            "attribution": "© OpenStreetMap contributors",
            "validationStatus": "imported_unverified",
            "buildingCount": len(out_buildings),
            "namedBuildingCount": len(named),
            "footwayCount": len(out_footways),
            "skippedBuildings": skipped,
            "areaTotalM2": round(sum(b["areaM2"] for b in out_buildings), 1),
            "categoryCounts": dict(categories),
            "heightSources": dict(Counter(b["heightSource"] for b in out_buildings)),
        },
        "campusBoundary": {
            "osmWayId": audit.get("campus", {}).get("osmWayId"),
            "name": boundary_el.get("tags", {}).get("name"),
            "ring": boundary_ring,
            "areaHectares": audit.get("campus", {}).get("areaHectares"),
        },
        "bounds": bounds,
        "buildings": out_buildings,
        "footways": out_footways,
    }

    WEB_DATA.mkdir(parents=True, exist_ok=True)
    target = WEB_DATA / "campus-real.json"
    with target.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))

    size_kb = target.stat().st_size / 1024
    print(f"OK  {target.relative_to(ROOT)}  ({size_kb:.0f} Ko)")
    print(f"    bâtiments : {len(out_buildings)}  (nommés {len(named)}, ignorés {skipped})")
    print(f"    cheminements : {len(out_footways)}")
    print(f"    étendue : {bounds['maxX'] - bounds['minX']:.0f} m x "
          f"{bounds['maxZ'] - bounds['minZ']:.0f} m")
    print(f"    catégories : {dict(categories)}")
    print(f"    hauteurs : {dict(Counter(b['heightSource'] for b in out_buildings))}")


if __name__ == "__main__":
    main()
