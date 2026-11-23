#!/usr/bin/env python3
"""
Création de la `study_area` élargie + inventaire de couverture géographique.

CONTEXTE ET DÉCISION (validée par le porteur de projet) :
  - `osm_boundary` (way/347214829, 99,37 ha) est CONSERVÉ INTACT : il n'est pas
    modifié et reste étiqueté comme périmètre OSM provisoire.
  - Une `study_area` plus large est ajoutée : zone d'INVESTIGATION et de
    COLLECTE, jamais présentée comme frontière officielle de l'UAC.
  - Aucune coordonnée inventée. Les composantes absentes d'OSM restent
    explicitement non localisées.

CHOIX MÉTHODOLOGIQUE (mesuré, pas arbitraire) :
  Le campus OSM mesure ~1,51 km x 0,99 km. Les composantes rattachées à l'UAC se
  répartissent en deux familles :
    * contiguës  : Institut Paul de Tasse (427 m), African School of Economics
                   (277 m), HEGT (~2,2 km), ESCE (~1,5 km) ;
    * distantes  : IUT (~6,2 km), IMSP Porto-Novo (~30,8 km),
                   INJEPS Porto-Novo (~39,9 km).
  Fusionner les secondes dans un polygone unique produirait une emprise de 40 km
  sans aucune valeur cartographique. La `study_area` est donc un tampon de
  2,5 km autour du campus — assez large pour englober toutes les composantes
  contiguës — et les sites distants sont documentés séparément comme
  `detached_site` dans l'inventaire (sans géométrie fusionnée).

Sorties :
  - tools/geo/out/study-area.geojson
  - tools/geo/out/component-inventory.json
  - tools/geo/out/coverage-report.json
"""
from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

import psycopg2
from shapely.geometry import Point, Polygon, MultiPolygon, mapping, shape as shp_shape
from shapely.ops import transform as shp_transform
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).parent / "out"
CACHE = Path(__file__).parent / "cache"

TO_UTM = Transformer.from_crs("EPSG:4326", "EPSG:32631", always_xy=True).transform
FROM_UTM = Transformer.from_crs("EPSG:32631", "EPSG:4326", always_xy=True).transform

BUFFER_M = 2500
STUDY_AREA_CODE = "UAC-STUDY-001"

# ---------------------------------------------------------------------------
# Inventaire de référence des composantes de l'UAC.
#
# `names` : fragments recherchés (normalisés) dans les noms OSM pour établir la
# présence. Aucune géométrie n'est créée ici : on LIT OSM.
# `affiliation` : rattachement institutionnel connu ; `None` = non confirmé.
# ---------------------------------------------------------------------------
COMPONENTS = [
    # --- Facultés (référentiel `faculties` de la base) ---
    dict(code="FADESP", label="Faculté de Droit et de Science Politique",
         kind="faculty", affiliation="UAC", names=["administration fadesp", "ecole doctorale fadesp", "fadesp"]),
    dict(code="FASEG", label="Faculté des Sciences Économiques et de Gestion",
         kind="faculty", affiliation="UAC", names=["administration faseg", "faseg"]),
    dict(code="FAST", label="Faculté des Sciences et Techniques",
         kind="faculty", affiliation="UAC", names=["administration fast", "labo fast", "laboratoire fast", "fast "]),
    dict(code="FLSH", label="Faculté des Lettres, Langues, Arts et Sciences Humaines",
         kind="faculty", affiliation="UAC", names=["administration flash", "ecole doctorale flash", "flash"]),
    dict(code="FSA", label="Faculté des Sciences Agronomiques",
         kind="faculty", affiliation="UAC", names=["sciences agronomiques", "agronomique"]),
    dict(code="FSS", label="Faculté des Sciences de la Santé",
         kind="faculty", affiliation="UAC", names=["sciences de la sante", "fss"]),
    # --- Instituts et écoles ---
    dict(code="IFRI", label="Institut de Formation et de Recherche en Informatique",
         kind="institute", affiliation="UAC", names=["ifri", "informatique"]),
    dict(code="EPAC", label="École Polytechnique d'Abomey-Calavi",
         kind="school", affiliation="UAC", names=["epac", "polytechnique"]),
    dict(code="ENEAM", label="École Nationale d'Économie et de Management",
         kind="school", affiliation="UAC", names=["eneam"]),
    dict(code="INJEPS", label="Institut National de l'Éducation Physique et Sportive",
         kind="institute", affiliation="UAC", names=["inje", "education physique"]),
    dict(code="IMSP", label="Institut de Mathématiques et de Sciences Physiques",
         kind="institute", affiliation="UAC", names=["imsp", "sciences physiques"]),
    dict(code="IUT", label="Institut Universitaire de Technologie",
         kind="institute", affiliation="UAC", names=["institut universitaire de technologie"]),
    dict(code="IREEP", label="Institut de Recherche Empirique en Économie Politique",
         kind="institute", affiliation="UAC", names=["ireep"]),
    dict(code="CIPMA", label="CIPMA — Chaire UNESCO",
         kind="institute", affiliation="UAC", names=["cipma"]),
    dict(code="CONFUCIUS", label="Institut Confucius",
         kind="institute", affiliation="UAC", names=["confucius"]),
    dict(code="UVA", label="Université Virtuelle Africaine",
         kind="institute", affiliation="UAC", names=["virtuelle africaine", "uva"]),
    # --- Administration et services ---
    dict(code="RECTORAT", label="Rectorat de l'UAC",
         kind="administration", affiliation="UAC", names=["rectorat"]),
    dict(code="BIBLIO", label="Bibliothèque Centrale de l'UAC",
         kind="library", affiliation="UAC", names=["bibliotheque centrale", "bibliotheque vieyra"]),
    dict(code="COUS", label="Centre des Œuvres Universitaires et Sociales",
         kind="service", affiliation="UAC", names=["administration cous", "cous uac", "crous"]),
    dict(code="RESTO", label="Restaurants universitaires",
         kind="restaurant", affiliation="UAC", names=["restaurant universitaire"]),
    dict(code="RESID", label="Résidences universitaires",
         kind="residence", affiliation="UAC", names=["residence"]),
    dict(code="STADE", label="Installations sportives",
         kind="sport", affiliation="UAC", names=["stade universitaire", "stade ", "complexe sportif"]),
    dict(code="INFIRM", label="Infirmerie universitaire",
         kind="health", affiliation="UAC", names=["infirm"]),
]

# Sites rattachés mais géographiquement disjoints : documentés, NON fusionnés
# dans la study_area (leur distance rendrait le polygone inexploitable).
# Sites rattachés à l'UAC mais géographiquement DISJOINTS du campus.
# Coordonnées relevées dans OSM (recherche nationale) : elles servent de PREUVE
# d'existence, jamais de géométrie fusionnée dans la study_area.
DETACHED_SITES = {
    "INJEPS": {
        "label": "Institut National de l'Éducation Physique et Sportive",
        "osmName": "Institut national de la jeunesse, de l'éducation physique et du sport",
        "lat": 6.5016217, "lng": 2.6926044, "distanceKm": 39.9,
        "note": "Porto-Novo — campus disjoint, hors study_area",
    },
    "IMSP": {
        "label": "Institut de Mathématiques et de Sciences Physiques",
        "osmName": "IMSP (Ancien bâtiment)",
        "lat": 6.481388, "lng": 2.6126856, "distanceKm": 30.8,
        "note": "Porto-Novo — bâtiment historique, hors study_area",
    },
    "IUT": {
        "label": "Institut Universitaire de Technologie",
        "osmName": "INSTITUT UNIVERSITAIRE DE TECHNOLOGIE",
        "lat": 6.380745, "lng": 2.2982211, "distanceKm": 6.2,
        "note": "~6,2 km à l'ouest du campus — site disjoint",
    },
}
DETACHED_HINTS = {k: v["note"] for k, v in DETACHED_SITES.items()}


def norm(value: str) -> str:
    import re
    import unicodedata
    s = unicodedata.normalize("NFD", (value or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def load_osm_entities() -> list[dict]:
    """
    Charge les entités OSM locales servant à établir la présence d'une composante.

    Deux sources, volontairement séparées :
      * les 355 bâtiments OSM importés (tools/geo/out/osm-buildings-in-campus.geojson) :
        ce sont EUX qui portent les noms réels du campus (« Administration
        Fadesp », « Rectorat »…) ;
      * les entités `amenity=university|college` de la zone élargie.

    Les résultats de la recherche NATIONALE (uac-constituent-national.json) sont
    volontairement EXCLUS : ils contiennent des sites disjoints (INJEPS et IMSP à
    Porto-Novo, IUT à 6 km). Les inclure produisait un faux positif — « STADE »
    correspondait à « Institut national de la jeunesse… et sportive » de
    Porto-Novo. Ces sites sont traités séparément dans DETACHED_HINTS.
    """
    ents: list[dict] = []

    # 1. Bâtiments OSM du campus (source principale des noms locaux).
    b_path = OUT / "osm-buildings-in-campus.geojson"
    if b_path.exists():
        for f in json.loads(b_path.read_text())["features"]:
            props = f["properties"]
            name = props.get("name")
            if not name:
                continue
            try:
                geom = shp_shape(f["geometry"])
            except Exception:
                continue
            ents.append({"osmType": "way", "osmId": props.get("osmId"),
                         "name": name, "tags": props, "geom": geom})

    # 2. Entités universitaires de la zone élargie (périmètres institutionnels).
    for fname in ("university-entities-wide.json", "uac-named-search.json"):
        f = CACHE / fname
        if not f.exists():
            continue
        for e in json.loads(f.read_text()).get("elements", []):
            tags = e.get("tags", {})
            name = tags.get("name") or tags.get("name:fr")
            if not name:
                continue
            geom = None
            if e["type"] == "node" and "lat" in e:
                geom = Point(e["lon"], e["lat"])
            elif "geometry" in e and len(e.get("geometry", [])) >= 3:
                c = [(p["lon"], p["lat"]) for p in e["geometry"]]
                if c[0] != c[-1]:
                    c.append(c[0])
                try:
                    geom = Polygon(c)
                except Exception:
                    geom = None
            elif "center" in e:
                geom = Point(e["center"]["lon"], e["center"]["lat"])
            if geom is None:
                continue
            ents.append({"osmType": e["type"], "osmId": e["id"], "name": name,
                         "tags": tags, "geom": geom})
    return ents


def main() -> int:
    apply = "--apply" in sys.argv
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("ERREUR: DATABASE_URL absent", file=sys.stderr)
        return 1

    # --- osm_boundary : lu depuis la base, jamais modifié ---
    conn = psycopg2.connect(dsn)
    cur = conn.cursor()
    cur.execute(
        "SELECT ST_AsGeoJSON(geometry), area_m2 FROM campus_boundaries "
        "WHERE code = 'UAC-OSM-001'"
    )
    row = cur.fetchone()
    if not row:
        print("ERREUR: osm_boundary UAC-OSM-001 introuvable", file=sys.stderr)
        return 1
    osm_geom_raw = json.loads(row[0])
    osm_area = row[1]
    # La colonne est déclarée geometry(MultiPolygon,4326) : ST_AsGeoJSON renvoie
    # donc un MultiPolygon, pas un Polygon. On reconstruit un Polygone unique en
    # fusionnant les parties (le périmètre OSM n'en compte qu'une).
    osm_shape = shp_shape(osm_geom_raw)
    if isinstance(osm_shape, MultiPolygon):
        osm_poly = max(osm_shape.geoms, key=lambda g: g.area)
    else:
        osm_poly = osm_shape
    print(f"osm_boundary : {osm_area/10000:.2f} ha — INCHANGÉ ({osm_geom_raw['type']})")

    # --- study_area : tampon métrique de 2,5 km autour du campus ---
    buffered_utm = shp_transform(TO_UTM, osm_poly).buffer(BUFFER_M, resolution=64)
    study_poly = shp_transform(FROM_UTM, buffered_utm)
    study_area_m2 = shp_transform(TO_UTM, study_poly).area
    print(f"study_area   : {study_area_m2/1e6:.2f} km2 (tampon {BUFFER_M} m)")
    print(f"               soit {study_area_m2/(osm_area or 1):.1f} x la surface du campus OSM")

    # --- inventaire ---
    ents = load_osm_entities()
    print(f"entités OSM chargées : {len(ents)}\n")

    inventory = []
    for comp in COMPONENTS:
        hits = []
        for e in ents:
            n = norm(e["name"])
            if any(norm(pat) in n for pat in comp["names"]):
                hits.append(e)

        in_osm = in_study = False
        matched_names = []
        nearest_dist = None
        for h in hits:
            rep = h["geom"].representative_point()
            if osm_poly.contains(rep):
                in_osm = True
            if study_poly.contains(rep):
                in_study = True
            d = shp_transform(TO_UTM, rep).distance(shp_transform(TO_UTM, osm_poly.representative_point()))
            if nearest_dist is None or d < nearest_dist:
                nearest_dist = d
            matched_names.append(h["name"])

        if not hits and comp["code"] in DETACHED_SITES:
            status = "confirmed_detached_site"
            existence = "confirmee_hors_campus"
        elif not hits:
            status = "missing_in_osm"
            existence = "non_localisee"
        elif in_osm:
            status = "in_osm_boundary"
            existence = "confirmee"
        elif in_study:
            status = "in_study_area_only"
            existence = "confirmee"
        else:
            status = "outside_study_area"
            existence = "confirmee_hors_zone"

        inventory.append({
            "code": comp["code"],
            "label": comp["label"],
            "kind": comp["kind"],
            "affiliation": comp["affiliation"],
            "existenceConfirmed": existence == "confirmee",
            "existenceStatus": existence,
            "inOsmBoundary": in_osm,
            "inStudyArea": in_study,
            "verificationSource": "OpenStreetMap (Overpass API)" if hits else "aucune source consultée",
            "osmMatches": matched_names[:6],
            "osmMatchCount": len(hits),
            "distanceToCampusCenterM": round(nearest_dist) if nearest_dist else None,
            "validationStatus": status,
            "detachedSite": DETACHED_SITES.get(comp["code"]),
            "notes": DETACHED_HINTS.get(comp["code"], ""),
        })

    # --- rapport de couverture ---
    tot = len(inventory)
    n_osm = sum(1 for c in inventory if c["inOsmBoundary"])
    n_study = sum(1 for c in inventory if c["inStudyArea"])
    n_out = sum(1 for c in inventory if c["validationStatus"] == "outside_study_area")
    n_missing = sum(1 for c in inventory if c["validationStatus"] == "missing_in_osm")
    n_detached = sum(1 for c in inventory if c["validationStatus"] == "confirmed_detached_site")

    print("=== INVENTAIRE DES COMPOSANTES UAC ===")
    print(f"{'CODE':12} {'DANS osm':9} {'DANS study':10} {'STATUT':22} MATCHS OSM")
    print("-" * 100)
    for c in inventory:
        print(
            f"{c['code']:12} {'OUI' if c['inOsmBoundary'] else 'non':9} "
            f"{'OUI' if c['inStudyArea'] else 'non':10} "
            f"{c['validationStatus']:22} {(c['osmMatches'][0][:34] if c['osmMatches'] else '—')}"
        )

    print()
    print(f"composantes inventoriées       : {tot}")
    print(f"  présentes dans osm_boundary  : {n_osm}")
    print(f"  présentes dans study_area    : {n_study}")
    print(f"  confirmées mais hors zone    : {n_out}")
    print(f"  sites disjoints confirmés    : {n_detached}")
    print(f"  absentes d'OSM               : {n_missing}")

    coverage = {
        "generatedAt": "2026-11-21",
        "sources": [{"name": "OpenStreetMap via Overpass API", "license": "ODbL-1.0",
                     "attribution": "© OpenStreetMap contributors"}],
        "osmBoundary": {
            "code": "UAC-OSM-001", "boundaryType": "osm_boundary",
            "areaHa": round((osm_area or 0) / 10000, 2),
            "note": "Périmètre OSM provisoire, conservé intact. NON officiel.",
        },
        "studyArea": {
            "code": STUDY_AREA_CODE, "boundaryType": "study_area",
            "bufferMeters": BUFFER_M,
            "areaKm2": round(study_area_m2 / 1e6, 2),
            "note": ("Zone d'investigation et de collecte. Ne constitue PAS la "
                     "frontière officielle de l'UAC."),
            "method": ("Tampon métrique (UTM 31N) de "
                       f"{BUFFER_M} m autour de osm_boundary, dimensionné pour "
                       "englober les composantes contiguës mesurées (277 m à "
                       "2,3 km), à l'exclusion des sites disjoints."),
        },
        "detachedSites": DETACHED_SITES,
        "totals": {"components": tot, "inOsmBoundary": n_osm,
                   "inStudyArea": n_study, "outsideStudyArea": n_out,
                   "confirmedDetachedSites": n_detached,
                   "missingFromOsm": n_missing},
        "inventory": inventory,
    }

    (OUT / "coverage-report.json").write_text(
        json.dumps(coverage, ensure_ascii=False, indent=2))
    (OUT / "component-inventory.json").write_text(
        json.dumps(inventory, ensure_ascii=False, indent=2))
    (OUT / "study-area.geojson").write_text(json.dumps({
        "type": "FeatureCollection",
        "name": "uac_study_area",
        "attribution": "© OpenStreetMap contributors, ODbL 1.0",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "features": [
            {"type": "Feature", "geometry": mapping(study_poly),
             "properties": {"code": STUDY_AREA_CODE, "boundaryType": "study_area",
                            "bufferMeters": BUFFER_M, "source": "OSM",
                            "sourceId": "way/347214829 (tampon)",
                            "note": "Zone d'investigation, non officielle"}},
            {"type": "Feature", "geometry": mapping(osm_poly),
             "properties": {"code": "UAC-OSM-001", "boundaryType": "osm_boundary",
                            "source": "OSM", "sourceId": "way/347214829",
                            "note": "Périmètre OSM provisoire, non officiel"}},
        ],
    }, ensure_ascii=False, indent=1))

    if apply:
        cur.execute(
            """
            INSERT INTO campus_boundaries
              (code, name, boundary_type, geometry, area_m2, source, source_id,
               license, notes, imported_at)
            VALUES (%s, %s, 'study_area', ST_Multi(ST_GeomFromGeoJSON(%s)), %s,
                    'OSM', 'way/347214829+buffer', 'ODbL-1.0', %s, now())
            ON CONFLICT (code) DO UPDATE
              SET geometry = EXCLUDED.geometry,
                  area_m2  = EXCLUDED.area_m2,
                  notes    = EXCLUDED.notes,
                  imported_at = EXCLUDED.imported_at
            """,
            (STUDY_AREA_CODE,
             "UAC — zone d'investigation élargie (study_area)",
             json.dumps(mapping(study_poly)), study_area_m2,
             f"Zone d'investigation et de collecte : tampon de {BUFFER_M} m autour "
             "du périmètre OSM provisoire. NE CONSTITUE PAS la frontière "
             "officielle de l'UAC."),
        )
        conn.commit()
        print(f"\n*** {STUDY_AREA_CODE} enregistrée (study_area) ***")
    else:
        conn.rollback()
        print("\n(dry-run : study_area non enregistrée — utilisez --apply)")

    cur.execute(
        "SELECT code, boundary_type, ROUND((area_m2/10000)::numeric,2) "
        "FROM campus_boundaries ORDER BY boundary_type"
    )
    print("\n=== PERIMETRES EN BASE ===")
    for c in cur.fetchall():
        print(f"  {c[0]:14} {c[1]:24} {c[2]:>10} ha")

    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
