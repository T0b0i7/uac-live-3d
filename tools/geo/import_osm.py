#!/usr/bin/env python3
"""
Import du référentiel géographique réel UAC (OpenStreetMap -> PostGIS).

Décisions appliquées (validées par le porteur de projet) :

  1. REMPLACEMENT : les 15 bâtiments synthétiques livrés en 0001 ne sont plus le
     référentiel cartographique. Ils sont ARCHIVÉS (buildings_archive) puis
     retirés de `buildings`. Aucune ligne n'est supprimée sans snapshot JSONB.

  2. IMPORT : les bâtiments OSM du périmètre campus sont insérés avec
     source = 'OSM_IMPORT', source_id = 'way/<id>',
     confidence_level = 'imported_unverified'. Le nom OSM est conservé tel quel.

  3. ABSENTS : les infrastructures connues de l'UAC mais ABSENTES d'OSM (FLSH,
     stade, infirmerie…) ne sont jamais positionnées arbitrairement. Elles sont
     créées comme fiches institutionnelles SANS géométrie, avec
     confidence_level = 'missing' et is_georeferenced implicite = faux
     (footprint / centroid / entrance à NULL).

  4. TRAÇABILITÉ : chaque ancien code est relié à sa nouvelle empreinte (ou à son
     absence) dans `building_code_mapping`, avec le type de correspondance et la
     distance constatée. Aucune correspondance n'est déclarée « vérifiée ».

Géométrie :
  - footprint  = polygone OSM tel quel
  - centroid   = ST_Centroid(footprint)          (centre géométrique)
  - entrance   = ST_PointOnSurface(footprint)    (point réellement DANS l'emprise)
  - footprint_area_m2 = ST_Area(footprint::geography)  (surface vraie, en m²)

Usage :
    python3 tools/geo/import_osm.py --dry-run
    python3 tools/geo/import_osm.py --apply
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
from psycopg2.extras import Json, execute_values

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).parent / "out"
CAMPUS_GEOJSON = ROOT / "tools/geo/cache/campus-boundary.json"
BUILDINGS_GEOJSON = OUT / "osm-buildings-in-campus.geojson"
ARCHIVE_JSON = ROOT / "tools/geo/archive/archive_15_synthetic_buildings.geojson"

MIGRATION_TAG = "0002_osm_geospatial_referential"
NOW = datetime.now(timezone.utc)

# ---------------------------------------------------------------------------
# Correspondance curatée : ancien code -> stratégie de rapprochement OSM
#
# `None` signifie : aucune correspondance fiable dans OSM => fiche
# institutionnelle sans géométrie (confidence_level = 'missing').
# Les valeurs sont des fragments normalisés recherchés dans le nom OSM.
# ---------------------------------------------------------------------------
CURATED_MATCH = {
    "IFRI": ["amphi iran administration ifri", "administration ifri"],
    "AMPHI-500": ["amphi a 500"],
    "AMPHI-B": ["amphi b 500"],
    "BIBLIO": ["bibliotheque vieyra"],
    "CROUS": ["administration cous"],
    "FAST-A": ["administration fast"],
    "FADESP": ["administration fadesp"],
    "RECTORAT": ["rectorat"],
    "RESID-A": ["residence a"],
    "RESTO-U": ["restaurant universitaire 1"],
    # Absents d'OSM au moment de l'import (vérifié par recherche par mot-clé).
    "FLSH-B": None,
    "STADE": None,
    "INFIRM": None,
    # Présence OSM ambiguë : on ne force pas une empreinte au hasard.
    "ESPACE-E": None,
    "ADMIN-SCO": None,
}

# Fiches institutionnelles à créer sans géométrie (infrastructure réelle de
# l'UAC absente d'OSM). Le nom est le nom officiel connu ; AUCUNE coordonnée.
INSTITUTIONAL_SHELLS = [
    ("FLSH-B", "FLSH — Bloc B", "Faculté des Lettres, Arts et Sciences Humaines", "ACADEMIC"),
    ("STADE", "Stade universitaire", "Installations sportives du campus", "SPORT"),
    ("INFIRM", "Infirmerie universitaire", "Service de santé estudiantin", "HEALTH"),
    ("ESPACE-E", "Espace étudiant / Maison des étudiants", "Vie associative et étudiante", "SERVICE"),
    ("ADMIN-SCO", "Services administratifs et scolarité", "Scolarité centrale", "ADMINISTRATIVE"),
]


def norm(value: str) -> str:
    """Minuscule, sans accents, ponctuation réduite à des espaces."""
    s = unicodedata.normalize("NFD", (value or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def slug(value: str, max_len: int = 40) -> str:
    s = norm(value).replace(" ", "-").upper()
    return (s[:max_len] or "SANS-NOM").strip("-")


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


# ---------------------------------------------------------------------------
# Catégorisation : tags OSM -> catégorie du domaine applicatif
# ---------------------------------------------------------------------------
def categorize(name: str | None, building_tag: str | None) -> str:
    n = norm(name or "")
    if "amphi" in n:
        return "AMPHITHEATER"
    if "bibliothe" in n or "library" in n:
        return "LIBRARY"
    if "restaurant" in n or "resto" in n or "cafeteria" in n:
        return "RESTAURANT"
    if "residence" in n:
        return "RESIDENCE"
    if "stade" in n or "sport" in n:
        return "SPORT"
    if "infirm" in n or "sante" in n:
        return "HEALTH"
    if "rectorat" in n or "administration" in n or "scolarite" in n or "bureau" in n:
        return "ADMINISTRATIVE"
    if any(k in n for k in ("labo", "faculte", "fadesp", "fast", "flsh", "ifri",
                            "epac", "eneam", "faseg", "ecole", "institut", "universite")):
        return "ACADEMIC"
    if building_tag in ("university", "college", "school"):
        return "ACADEMIC"
    return "OTHER"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="écrit réellement en base")
    ap.add_argument("--dry-run", action="store_true", help="simulation seule")
    args = ap.parse_args()
    apply = args.apply and not args.dry_run

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("ERREUR: DATABASE_URL absent de l'environnement", file=sys.stderr)
        return 1

    buildings_fc = json.loads(BUILDINGS_GEOJSON.read_text())
    features = buildings_fc["features"]
    print(f"Bâtiments OSM candidats : {len(features)}")
    print(f"Mode                   : {'APPLY (écriture)' if apply else 'DRY-RUN (lecture)' }\n")

    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    cur = conn.cursor()
    stats = {}

    try:
        # ------------------------------------------------------------------
        # ÉTAPE 1 — Périmètre OSM (provisoire) dans campus_boundaries
        # ------------------------------------------------------------------
        print("=== ETAPE 1 : périmètre OSM ===")
        campus = json.loads(CAMPUS_GEOJSON.read_text())
        campus_geom = None
        for el in campus.get("elements", []):
            if el.get("id") == 347214829 and "geometry" in el:
                coords = [[p["lon"], p["lat"]] for p in el["geometry"]]
                if coords[0] != coords[-1]:
                    coords.append(coords[0])
                campus_geom = coords
        if campus_geom is None:
            raise RuntimeError("limite campus introuvable dans le cache OSM")

        wkt_ring = ", ".join(f"{lng} {lat}" for lng, lat in campus_geom)
        cur.execute(
            """
            INSERT INTO campus_boundaries
              (code, name, boundary_type, geometry, area_m2, source, source_id,
               license, notes, imported_at)
            VALUES (
              'UAC-OSM-001',
              'Université d''Abomey-Calavi — périmètre OSM',
              'osm_boundary',
              ST_Multi(ST_GeomFromText(%s, 4326)),
              ST_Area(ST_GeomFromText(%s, 4326)::geography),
              'OSM', 'way/347214829', 'ODbL-1.0',
              'Périmètre PROVISOIRE déduit du polygone amenity=university d''OSM. '
              'Ne constitue pas la frontière officielle de l''UAC ; certaines '
              'composantes institutionnelles peuvent en être exclues.',
              %s
            )
            ON CONFLICT (code) DO UPDATE
              SET geometry = EXCLUDED.geometry,
                  area_m2 = EXCLUDED.area_m2,
                  imported_at = EXCLUDED.imported_at
            """,
            (f"POLYGON(({wkt_ring}))", f"POLYGON(({wkt_ring}))", NOW),
        )
        cur.execute(
            "SELECT area_m2 FROM campus_boundaries WHERE code = 'UAC-OSM-001'"
        )
        area = cur.fetchone()[0]
        print(f"  UAC-OSM-001  osm_boundary  {area/10000:.2f} ha  (proviseur)")
        stats["campusBoundary"] = {"code": "UAC-OSM-001", "areaHa": round(area / 10000, 2)}

        # ------------------------------------------------------------------
        # ÉTAPE 2 — Import des bâtiments OSM
        # ------------------------------------------------------------------
        print("\n=== ETAPE 2 : import des bâtiments OSM ===")
        rows = []
        used_codes: set[str] = set()
        for f in features:
            props = f["properties"]
            osm_id = props["osmId"]
            name = props.get("name")
            geom_json = json.dumps(f["geometry"])

            # Code stable et unique : dérivé du nom si présent, sinon de l'id OSM.
            base = slug(name) if name else f"OSM-{osm_id}"
            code = base
            n = 2
            while code in used_codes:
                code = f"{base}-{n}"
                n += 1
            used_codes.add(code)

            levels = props.get("levels")
            try:
                floors = max(1, min(60, int(str(levels).split(";")[0]))) if levels else 1
            except (TypeError, ValueError):
                floors = 1

            rows.append(
                (
                    code,
                    name or f"Bâtiment OSM {osm_id}",
                    None,
                    categorize(name, props.get("building")),
                    None,
                    floors,
                    geom_json,
                    geom_json,
                    geom_json,
                    f"way/{osm_id}",
                    "imported_unverified",
                    NOW,
                )
            )

        if apply:
            # Un nom OSM comme « Rectorat » produit un code `RECTORAT` identique à
            # celui d'un bâtiment synthétique encore présent. Ces derniers sont
            # déjà archivés (étape 3, avec leur code d'origine) et seront retirés
            # à l'étape 5 : on les préfixe temporairement pour laisser la place
            # aux empreintes réelles, sans perdre aucune information.
            cur.execute(
                """
                UPDATE buildings SET code = 'ARCH-' || code
                WHERE source <> 'OSM_IMPORT'
                  AND confidence_level <> 'missing'
                  AND code IN (SELECT unnest(%s::text[]))
                """,
                ([r[0] for r in rows],),
            )
            if cur.rowcount:
                print(f"  codes synthétiques préfixés (ARCH-*) : {cur.rowcount}")

            execute_values(
                cur,
                """
                INSERT INTO buildings
                  (code, name, short_name, category, description, floors,
                   footprint, centroid, entrance, source, source_id,
                   confidence_level, verification_status, imported_at,
                   footprint_area_m2)
                SELECT v.code, v.name, v.short_name, v.category, v.description,
                       v.floors,
                       ST_GeomFromGeoJSON(v.footprint),
                       ST_Centroid(ST_GeomFromGeoJSON(v.centroid)),
                       ST_PointOnSurface(ST_GeomFromGeoJSON(v.entrance)),
                       'OSM_IMPORT', v.source_id, v.confidence_level,
                       'UNVERIFIED', v.imported_at,
                       ST_Area(ST_GeomFromGeoJSON(v.footprint)::geography)
                FROM (VALUES %s) AS v(code, name, short_name, category, description,
                                      floors, footprint, centroid, entrance,
                                      source_id, confidence_level, imported_at)
                ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL
                DO NOTHING
                """,
                rows,
                page_size=200,
            )
            imported = cur.rowcount
        else:
            imported = len(rows)

        cur.execute(
            "SELECT count(*) FROM buildings WHERE source = 'OSM_IMPORT' AND deleted_at IS NULL"
        )
        total_osm = cur.fetchone()[0]
        print(f"  lignes traitées      : {len(rows)}")
        print(f"  insérées (ce run)    : {imported}")
        print(f"  total OSM_IMPORT     : {total_osm}")
        stats["osmBuildings"] = {"processed": len(rows), "inserted": imported, "total": total_osm}

        # ------------------------------------------------------------------
        # ÉTAPE 3 — Archivage des 15 bâtiments synthétiques
        # ------------------------------------------------------------------
        print("\n=== ETAPE 3 : archivage des bâtiments synthétiques ===")
        cur.execute("SELECT count(*) FROM buildings WHERE source <> 'OSM_IMPORT'")
        n_synth = cur.fetchone()[0]
        print(f"  bâtiments non-OSM présents : {n_synth}")

        if apply and n_synth:
            cur.execute(
                """
                INSERT INTO buildings_archive
                  (original_id, code, reason, snapshot, footprint_wkt, archived_by_migration)
                SELECT
                  id, code,
                  'Rectangle synthétique de 5 points — remplacé comme référentiel '
                  'cartographique par les empreintes réelles OpenStreetMap (audit '
                  'tools/geo/out/audit-report.json). Conservé pour traçabilité.',
                  to_jsonb(b.*),
                  ST_AsText(footprint),
                  %s
                FROM buildings b
                WHERE source <> 'OSM_IMPORT'
                  AND NOT EXISTS (
                    SELECT 1 FROM buildings_archive a WHERE a.original_id = b.id
                  )
                """,
                (MIGRATION_TAG,),
            )
            archived = cur.rowcount
        elif not apply:
            archived = n_synth
        else:
            archived = 0
        print(f"  archivés (ce run)    : {archived}")
        stats["archived"] = archived

        # ------------------------------------------------------------------
        # ÉTAPE 4 — Correspondance ancien code -> empreinte OSM
        # ------------------------------------------------------------------
        print("\n=== ETAPE 4 : table de correspondance ===")
        # Les anciens codes sont lus depuis l'ARCHIVE GeoJSON (et non depuis
        # `buildings`) : la correspondance reste calculable après le retrait des
        # synthétiques, et fonctionne dès le dry-run.
        archive = json.loads(ARCHIVE_JSON.read_text())
        old_rows = []
        for feat in archive["features"]:
            p = feat["properties"]
            ring = feat["geometry"]["coordinates"][0]
            lng = sum(pt[0] for pt in ring[:-1]) / (len(ring) - 1)
            lat = sum(pt[1] for pt in ring[:-1]) / (len(ring) - 1)
            old_rows.append((p["code"], p["name"], lat, lng))
        print(f"  anciens bâtiments (archive) : {len(old_rows)}")

        # Index des empreintes candidates construit depuis le GeoJSON : il est
        # ainsi disponible en dry-run comme en écriture. L'identifiant en base
        # (new_building_id) est résolu séparément, et reste NULL en dry-run.
        src_index = []
        for feat in features:
            props = feat["properties"]
            ring = feat["geometry"]["coordinates"][0]
            clng = sum(p[0] for p in ring[:-1]) / (len(ring) - 1)
            clat = sum(p[1] for p in ring[:-1]) / (len(ring) - 1)
            src_index.append((f"way/{props['osmId']}", props.get("name"), clat, clng))

        db_ids: dict[str, str] = {}
        if apply:
            cur.execute("SELECT source_id, id FROM buildings WHERE source = 'OSM_IMPORT'")
            db_ids = {r[0]: str(r[1]) for r in cur.fetchall()}

        mapping = []
        matched = 0
        unmatched = 0
        for code, name, lat, lng in old_rows:
            patterns = CURATED_MATCH.get(code)
            target = None
            if patterns:
                for pat in patterns:
                    for src_id, oname, olat, olng in src_index:
                        if norm(oname or "") == pat:
                            d = haversine(lat, lng, olat, olng) if lat and olat else None
                            target = (src_id, d)
                            break
                    if target:
                        break
            if target:
                src_id, dist = target
                mapping.append(
                    (
                        code,
                        name,
                        db_ids.get(src_id),  # NULL en dry-run, UUID en écriture
                        src_id,
                        "name_matched",
                        dist,
                        "Nom OSM identique après normalisation ; empreinte non "
                        "contrôlée sur le terrain.",
                    )
                )
                matched += 1
            else:
                mapping.append(
                    (
                        code,
                        name,
                        None,
                        None,
                        "no_geometry",
                        None,
                        "Aucune empreinte OSM fiable : fiche institutionnelle sans "
                        "géométrie, localisation à collecter sur le terrain.",
                    )
                )
                unmatched += 1

        print(f"  rapprochés (nom OSM)     : {matched}")
        print(f"  sans géométrie           : {unmatched}")
        for m in mapping:
            if m[4] == "name_matched":
                print(f"    {m[0]:12} -> {m[3]:18} ecart {m[5]:.1f} m")

        if apply and mapping:
            execute_values(
                cur,
                """
                INSERT INTO building_code_mapping
                  (old_code, old_name, new_building_id, new_source_id,
                   match_type, match_distance_m, notes)
                VALUES %s
                ON CONFLICT (old_code) DO UPDATE
                  SET new_building_id = EXCLUDED.new_building_id,
                      new_source_id = EXCLUDED.new_source_id,
                      match_type = EXCLUDED.match_type,
                      match_distance_m = EXCLUDED.match_distance_m,
                      notes = EXCLUDED.notes
                """,
                mapping,
                page_size=100,
            )
        stats["mapping"] = {"matched": matched, "noGeometry": unmatched}

        # ------------------------------------------------------------------
        # ÉTAPE 5 — Retrait des synthétiques de `buildings`
        #    UNIQUEMENT s'ils ont tous un snapshot d'archive. Doit précéder la
        #    création des fiches institutionnelles, qui réutilisent les mêmes
        #    codes et échoueraient sur la contrainte d'unicité.
        # ------------------------------------------------------------------
        print("\n=== ETAPE 5 : retrait des synthétiques ===")
        # Le garde-fou ne s'applique qu'en écriture : en dry-run, l'archivage de
        # l'étape 3 n'a pas été exécuté (rollback), donc l'absence de snapshot
        # est normale et non bloquante.
        if apply:
            cur.execute(
                """
                SELECT count(*) FROM buildings b
                WHERE b.source <> 'OSM_IMPORT'
                  AND NOT EXISTS (SELECT 1 FROM buildings_archive a WHERE a.original_id = b.id)
                """
            )
            unprotected = cur.fetchone()[0]
            if unprotected:
                raise RuntimeError(
                    f"{unprotected} bâtiment(s) sans snapshot d'archive : retrait refusé "
                    "(protection contre toute perte de données)."
                )
        else:
            unprotected = 0

        if apply:
            cur.execute(
                "DELETE FROM buildings WHERE source <> 'OSM_IMPORT' "
                "AND confidence_level <> 'missing'"
            )
            removed = cur.rowcount
        else:
            cur.execute(
                "SELECT count(*) FROM buildings WHERE source NOT IN ('OSM_IMPORT') "
                "AND confidence_level <> 'missing'"
            )
            removed = cur.fetchone()[0]
        print(f"  synthétiques retirés : {removed}")
        stats["removed"] = removed

        # ------------------------------------------------------------------
        # ÉTAPE 6 — Fiches institutionnelles sans géométrie
        #    Infrastructures réelles de l'UAC absentes d'OSM : on conserve une
        #    fiche d'identité, SANS aucune coordonnée inventée.
        # ------------------------------------------------------------------
        print("\n=== ETAPE 6 : fiches institutionnelles sans géométrie ===")
        shells = []
        for code, name, desc, cat in INSTITUTIONAL_SHELLS:
            cur.execute("SELECT 1 FROM buildings WHERE code = %s", (code,))
            if cur.fetchone():
                print(f"  {code:12} déjà présent — ignoré")
                continue
            shells.append((code, name, desc, cat))

        if apply and shells:
            execute_values(
                cur,
                """
                INSERT INTO buildings
                  (code, name, category, description, floors, source,
                   source_id, confidence_level, verification_status, is_accessible)
                VALUES %s
                ON CONFLICT (code) DO NOTHING
                """,
                [
                    (c, n, cat, d, 1, "INSTITUTIONAL", None, "missing", "UNVERIFIED", False)
                    for c, n, d, cat in shells
                ],
            )
            created = cur.rowcount
        else:
            created = len(shells)
        print(f"  fiches créées            : {created}")
        for c, n, _, _ in shells:
            print(f"    + {c:12} {n}  (sans géométrie, localisation à collecter)")
        stats["institutionalShells"] = created

        cur.execute("SELECT count(*) FROM buildings WHERE deleted_at IS NULL")
        stats["totalBuildings"] = cur.fetchone()[0]
        cur.execute(
            "SELECT confidence_level, count(*) FROM buildings "
            "WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 1"
        )
        stats["byConfidence"] = {r[0]: r[1] for r in cur.fetchall()}

        if apply:
            conn.commit()
            print("\n*** COMMIT effectué ***")
        else:
            conn.rollback()
            print("\n*** DRY-RUN : rollback, aucune écriture ***")

        (OUT / "import-stats.json").write_text(
            json.dumps(stats, ensure_ascii=False, indent=2, default=str)
        )
        print("\n=== RESUME ===")
        print(json.dumps(stats, ensure_ascii=False, indent=2, default=str))
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
