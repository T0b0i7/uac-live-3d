#!/usr/bin/env python3
"""
Produit le jeu de données OSM consommable par apps/web (carte MapLibre).

Contrairement à `build_web_referential.py` (repère métrique local, destiné à
une scène 3D), ce script conserve les coordonnées WGS84 d'origine : MapLibre
projette lui-même et l'on évite toute perte de précision ou tout recalage.

Sortie :
  apps/web/src/data/geo/uac-osm-buildings.geojson
  apps/web/src/data/geo/uac-osm-footways.geojson
  apps/web/src/data/geo/uac-osm-meta.json

Les propriétés sont mises à la forme exacte attendue par
`apps/web/src/lib/geo.ts` (BuildingFeature.properties), afin que la carte
n'ait aucune transformation à inventer.

Licence : ODbL-1.0 — © OpenStreetMap contributors.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "tools" / "geo" / "out"
CACHE_DIR = ROOT / "tools" / "geo" / "cache"
TARGET = ROOT / "apps" / "web" / "src" / "data" / "geo"

METRES_PER_LEVEL = 3.4
DEFAULT_LEVELS = 2


def category_for(name: str | None, tag: str | None) -> str:
    """Traduit les tags OSM vers les catégories du contrat applicatif."""
    n = (name or "").lower()
    if any(k in n for k in ("restaurant", "cafétéria", "cafeteria", "cantine")):
        return "FOOD"
    if any(k in n for k in ("résidence", "residence", "internat", "cité")):
        return "RESIDENCE"
    if any(k in n for k in ("amphi", "auditorium")):
        return "AMPHITHEATRE"
    if any(k in n for k in ("bibliothèque", "bibliotheque")):
        return "LIBRARY"
    if any(k in n for k in ("administration", "rectorat", "scolarité")):
        return "ADMINISTRATION"
    if any(k in n for k in ("stade", "terrain", "gymnase", "sport")):
        return "SPORTS"
    if any(k in n for k in ("infirmerie", "clinique", "pharmacie", "santé")):
        return "SERVICE"
    if tag in ("school", "university", "college"):
        return "ACADEMIC"
    if tag == "residential":
        return "RESIDENCE"
    if tag in ("retail", "office", "commercial"):
        return "SERVICE"
    return "ACADEMIC"


def short_name(name: str | None, osm_id: int) -> str:
    """Nom court lisible : le tag OSM s'il existe, sinon un code stable."""
    if not name:
        return f"OSM-{osm_id}"
    cleaned = name.strip()
    if len(cleaned) <= 28:
        return cleaned
    return cleaned[:26].rstrip() + "…"


def main() -> None:
    buildings = json.load((OUT_DIR / "osm-buildings-in-campus.geojson").open(encoding="utf-8"))
    footways = json.load((OUT_DIR / "osm-footways-in-campus.geojson").open(encoding="utf-8"))
    boundary_raw = json.load((CACHE_DIR / "campus-boundary.json").open(encoding="utf-8"))
    audit = json.load((OUT_DIR / "audit-report.json").open(encoding="utf-8"))

    features = []
    for f in buildings["features"]:
        props = f["properties"]
        osm_id = props["osmId"]
        levels = props.get("levels")
        height_tag = props.get("height")
        try:
            levels = int(float(levels)) if levels is not None else None
        except (TypeError, ValueError):
            levels = None
        try:
            height = float(str(height_tag).replace("m", "").strip()) if height_tag else None
        except ValueError:
            height = None
        if height is None:
            height = (levels or DEFAULT_LEVELS) * METRES_PER_LEVEL

        features.append(
            {
                "type": "Feature",
                # L'id de feature est ce que MapLibre renvoie au clic.
                "id": f"osm-{osm_id}",
                "geometry": f["geometry"],
                "properties": {
                    "id": f"osm-{osm_id}",
                    "code": f"OSM-{osm_id}",
                    "name": props.get("name") or f"Bâtiment OSM {osm_id}",
                    "shortName": short_name(props.get("name"), osm_id),
                    "category": category_for(props.get("name"), props.get("building")),
                    "facultyName": None,
                    "floors": levels or DEFAULT_LEVELS,
                    "footprintAreaM2": props.get("areaM2"),
                    # Traçabilité : la donnée est importée mais non vérifiée
                    # sur le terrain. C'est la valeur publiée par l'audit.
                    "verificationStatus": props.get("validationStatus", "imported_unverified"),
                    "isGeoreferenced": True,
                    # Champs additionnels propres à la source OSM.
                    "heightM": round(height, 1),
                    "osmId": osm_id,
                    "source": "OpenStreetMap",
                    "sourceId": props.get("sourceId"),
                    "license": "ODbL-1.0",
                },
            }
        )

    footway_features = []
    for f in footways["features"]:
        if f["geometry"]["type"] != "LineString":
            continue
        props = f["properties"]
        footway_features.append(
            {
                "type": "Feature",
                "id": f"osm-way-{props['osmId']}",
                "geometry": f["geometry"],
                "properties": {
                    "osmId": props["osmId"],
                    "highway": props.get("highway"),
                    "name": props.get("name"),
                    "lengthM": props.get("lengthM"),
                    "source": "OpenStreetMap",
                    "license": "ODbL-1.0",
                },
            }
        )

    boundary_el = boundary_raw["elements"][0]
    boundary_coords = [[p["lon"], p["lat"]] for p in boundary_el["geometry"]]
    if boundary_coords[0] != boundary_coords[-1]:
        boundary_coords.append(boundary_coords[0])

    meta = {
        "$comment": (
            "Instantané local des données OpenStreetMap du campus de "
            "l'Université d'Abomey-Calavi. Utilisé par l'interface lorsque "
            "l'API PostGIS n'est pas joignable. Ce sont de VRAIES emprises "
            "relevées, pas des données de démonstration inventées. "
            "Licence ODbL-1.0 — © OpenStreetMap contributors."
        ),
        "source": "OpenStreetMap via Overpass API",
        "license": "ODbL-1.0",
        "attribution": "© OpenStreetMap contributors",
        "attributionUrl": "https://www.openstreetmap.org/copyright",
        "osmBaseTimestamp": audit["sources"][0].get("osmBaseTimestamp"),
        "extractedAt": audit.get("generatedAt"),
        "validationStatus": "imported_unverified",
        "campus": {
            "osmWayId": boundary_el["id"],
            "name": boundary_el.get("tags", {}).get("name"),
            "areaHectares": audit["campus"]["areaHectares"],
            "vertices": audit["campus"]["vertices"],
            "bbox": audit["campus"]["bbox"],
            "ring": boundary_coords,
        },
        "counts": {
            "buildings": len(features),
            "namedBuildings": sum(1 for f in features if f["properties"]["name"] != f"Bâtiment OSM {f['properties']['osmId']}"),
            "footways": len(footway_features),
            "totalFootprintM2": round(audit["buildings"]["totalFootprintM2"], 1),
            "coveragePercent": audit["buildings"]["coveragePercentOfCampus"],
            "footwayLengthKm": round(audit["ways"]["lengthTotalKm"], 2),
        },
        "categoryCounts": dict(Counter(f["properties"]["category"] for f in features)),
        "warnings": [
            "Les hauteurs sont estimées à 2 niveaux (6,8 m) quand OSM ne publie "
            "ni `height` ni `levels` : 18 bâtiments sur 355 ont un nombre de "
            "niveaux renseigné.",
            "Le statut de vérification est `imported_unverified` : aucune "
            "emprise n'a été contrôlée sur le terrain.",
            "Le réseau piéton OSM est partiellement incomplet ; il ne permet "
            "pas de garantir un itinéraire accessible PMR.",
        ],
    }

    TARGET.mkdir(parents=True, exist_ok=True)

    with (TARGET / "uac-osm-buildings.geojson").open("w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh, ensure_ascii=False, separators=(",", ":"))

    with (TARGET / "uac-osm-footways.geojson").open("w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": footway_features}, fh, ensure_ascii=False, separators=(",", ":"))

    with (TARGET / "uac-osm-meta.json").open("w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)

    for name in ("uac-osm-buildings.geojson", "uac-osm-footways.geojson", "uac-osm-meta.json"):
        p = TARGET / name
        print(f"OK  {p.relative_to(ROOT)}  ({p.stat().st_size / 1024:.0f} Ko)")

    print(f"    bâtiments : {len(features)} | cheminements : {len(footway_features)}")
    print(f"    catégories : {dict(Counter(f['properties']['category'] for f in features))}")
    print(f"    frontière : {len(boundary_coords)} sommets, {audit['campus']['areaHectares']} ha")


if __name__ == "__main__":
    main()
