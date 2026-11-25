#!/usr/bin/env python3
"""
Import des cheminements piétons OSM réels dans la table `walkways`.

PROBLÈME RÉSOLU
---------------
Le graphe piéton renvoyait 355 nœuds et 0 arête : aucune navigation possible.
Cause mesurée : les 21 allées de `walkways` référençaient des codes courts
(`IFRI`, `FAST-A`, `BIBLIO`) absents de `buildings.code` (slugs OSM du type
`ADMINISTRATION-FAST`). `NavigationService.getGraph()` écarte donc toutes les
arêtes via `if (!graph.nodes.has(...)) continue`.

La table `building_code_mapping` ne pouvait pas corriger cela : elle ne couvre
que 11 allées sur 21 et ses correspondances sont décalées de 255 à 780 m.

APPROCHE RETENUE
----------------
Ne dépendre d'AUCUNE correspondance de code de bâtiment. Les géométries OSM
portent leurs propres extrémités : on reconstruit les nœuds par coïncidence
géométrique exacte des points terminaux (tolérance centimétrique), puis on
crée une arête par cheminement.

Un nœud n'est donc pas « le bâtiment X » mais « le point (lat, lng) où plusieurs
cheminements se rencontrent » — ce qui est la définition correcte d'un nœud de
graphe. Aucune coordonnée n'est inventée : toutes proviennent des `LineString`.

CE QUI N'EST PAS FAIT, VOLONTAIREMENT
-------------------------------------
- Aucune surface n'est supposée : OSM ne la publie pas, `surface` reste
  `UNKNOWN` (valeur que la contrainte CHECK de la table accepte).
- Aucun raccordement n'est fabriqué entre le réseau et les bâtiments. Un
  bâtiment est atteint depuis le nœud de cheminement le plus proche, par le
  `snapToGraph` du moteur de routage. Créer des arêtes « bâtiment → allée »
  inventerait un trajet qui n'existe pas dans les données.

USAGE
-----
    python3 tools/geo/import_osm_walkways.py --dry-run
    python3 tools/geo/import_osm_walkways.py --apply

Le script est idempotent : les cheminements importés portent
`source = 'OSM_IMPORT'` et un `source_id = 'way/<osmId>'` unique ; un second
passage met à jour au lieu de dupliquer. Les 21 allées existantes
(`source = 'STUDENT'`) ne sont PAS supprimées.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path

try:
    import psycopg2
except ImportError:
    print("psycopg2 requis : pip install psycopg2-binary", file=sys.stderr)
    raise

ROOT = Path(__file__).resolve().parents[2]
FOOTWAYS = ROOT / "apps/web/src/data/geo/uac-osm-footways.geojson"

# Tolérance de fusion des points terminaux, en degrés (~1 cm).
# Les extrémités d'un même carrefour OSM sont identiques au bit près, mais on
# garde une marge pour absorber un arrondi de sérialisation.
MERGE_EPS_DEG = 1e-7

# En deçà, une arête est jugée dégénérée (contrainte CHECK distance_meters > 0).
MIN_EDGE_M = 0.5


def haversine_m(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
    """Distance géodésique en mètres entre deux points WGS84."""
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def line_length_m(coords: list[list[float]]) -> float:
    total = 0.0
    for (lng1, lat1), (lng2, lat2) in zip(coords, coords[1:]):
        total += haversine_m(lng1, lat1, lng2, lat2)
    return total


def node_key(lng: float, lat: float) -> tuple[float, float]:
    """Clé de fusion : arrondi à la tolérance de fusion."""
    return (round(lng / MERGE_EPS_DEG), round(lat / MERGE_EPS_DEG))


def build_graph_payload(features: list[dict]) -> dict:
    """
    Reconstruit nœuds et arêtes depuis les LineString.

    Retourne un dictionnaire contenant :
      - nodes : clé -> (lng, lat) du point effectif
      - edges : liste de dicts prêts pour l'insertion SQL
    """
    nodes: dict[tuple[float, float], tuple[float, float]] = {}
    edges: list[dict] = []
    stats = {
        "features": len(features),
        "tooShort": 0,
        "selfLoop": 0,
        "nodesCreated": 0,
        "edgesCreated": 0,
        "totalLengthM": 0.0,
        "byHighway": {},
    }

    for f in features:
        props = f.get("properties") or {}
        geom = f.get("geometry") or {}
        osm_id = props.get("osmId")
        highway = props.get("highway") or "path"
        coords = geom.get("coordinates") or []

        if len(coords) < 2:
            stats["tooShort"] += 1
            continue

        length_m = line_length_m(coords)
        if length_m < MIN_EDGE_M:
            stats["tooShort"] += 1
            continue

        start_lng, start_lat = coords[0]
        end_lng, end_lat = coords[-1]
        k_start = node_key(start_lng, start_lat)
        k_end = node_key(end_lng, end_lat)

        # Une boucle sur soi-même viole le sens d'une arête de graphe et
        # fausserait Dijkstra : on l'écarte, c'est un cercle de rond-point ou
        # une géométrie dégénérée, pas un trajet utile.
        if k_start == k_end:
            stats["selfLoop"] += 1
            continue

        nodes.setdefault(k_start, (start_lng, start_lat))
        nodes.setdefault(k_end, (end_lng, end_lat))

        stats["byHighway"][highway] = stats["byHighway"].get(highway, 0) + 1
        stats["totalLengthM"] += length_m

        edges.append(
            {
                "code": f"OSM-W-{osm_id}",
                "source_id": f"way/{osm_id}",
                "from_key": k_start,
                "to_key": k_end,
                "length_m": length_m,
                "highway": highway,
                "wkt": "LINESTRING(" + ", ".join(f"{lng} {lat}" for lng, lat in coords) + ")",
            }
        )

    stats["nodesCreated"] = len(nodes)
    stats["edgesCreated"] = len(edges)
    return {"nodes": nodes, "edges": edges, "stats": stats}


def node_id(key: tuple[float, float], nodes: dict) -> str:
    """
    Identifiant lisible et stable : coordonnées arrondies à 6 décimales.

    On n'utilise pas un index d'ordre de lecture, qui changerait dès qu'un
    cheminement serait ajouté dans OSM et invaliderait les identifiants déjà
    distribués.
    """
    lng, lat = nodes[key]
    return f"WN-{lat:.6f}-{lng:.6f}".replace("-", "m").replace(".", "d")


def run(dsn: str, apply: bool) -> int:
    if not FOOTWAYS.exists():
        print(f"Fichier source introuvable : {FOOTWAYS}", file=sys.stderr)
        return 1

    payload = json.loads(FOOTWAYS.read_text())
    built = build_graph_payload(payload.get("features") or [])
    stats, nodes, edges = built["stats"], built["nodes"], built["edges"]

    print("=" * 68)
    print("IMPORT DES CHEMINEMENTS PIÉTONS OSM")
    print("=" * 68)
    print(f"  fichier source       : {FOOTWAYS.relative_to(ROOT)}")
    print(f"  cheminements lus     : {stats['features']}")
    print(f"  ignorés (trop court) : {stats['tooShort']}")
    print(f"  ignorés (boucle)     : {stats['selfLoop']}")
    print(f"  nœuds reconstruits   : {stats['nodesCreated']}")
    print(f"  arêtes reconstruites : {stats['edgesCreated']}")
    print(f"  longueur totale      : {stats['totalLengthM']:.1f} m")
    print(f"  par type             : {stats['byHighway']}")
    print()

    if not apply:
        print("--dry-run : aucune écriture en base. Relancer avec --apply.")
        return 0

    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        # ------------------------------------------------------------------
        # 1. Déclasser les allées à codes courts non résolubles.
        #    On ne les supprime pas : elles gardent leur valeur documentaire.
        #    On ne les réintègre pas : leurs distances de correspondance sont
        #    fausses (255 à 780 m mesurés).
        # ------------------------------------------------------------------
        cur.execute(
            """
            SELECT count(*) FROM walkways
            WHERE source = 'STUDENT' AND from_node_id IS NOT NULL
            """
        )
        legacy = cur.fetchone()[0]
        print(f"  allées historiques à codes courts : {legacy} (conservées en base)")

        # ------------------------------------------------------------------
        # 2. Reconstruire les nœuds sous forme de tableaux d'extrémités.
        #    Le graphe applicatif lit `walkways.from_node_id` / `to_node_id` :
        #    on y place nos identifiants de nœuds géométriques.
        # ------------------------------------------------------------------
        id_for_key = {k: node_id(k, nodes) for k in nodes}

        inserted = 0
        updated = 0
        for e in edges:
            cur.execute(
                """
                INSERT INTO walkways
                    (code, path, from_node_id, to_node_id, distance_meters,
                     is_accessible, surface, source, source_id, imported_at)
                VALUES
                    (%s, ST_GeomFromText(%s, 4326), %s, %s, %s,
                     TRUE, 'UNKNOWN', 'OSM_IMPORT', %s, now())
                ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL
                DO UPDATE SET
                    code            = EXCLUDED.code,
                    path            = EXCLUDED.path,
                    from_node_id    = EXCLUDED.from_node_id,
                    to_node_id      = EXCLUDED.to_node_id,
                    distance_meters = EXCLUDED.distance_meters,
                    imported_at     = EXCLUDED.imported_at,
                    updated_at      = now()
                RETURNING (xmax = 0) AS was_insert
                """,
                (
                    e["code"],
                    e["wkt"],
                    id_for_key[e["from_key"]],
                    id_for_key[e["to_key"]],
                    round(e["length_m"], 2),
                    e["source_id"],
                ),
            )
            row = cur.fetchone()
            if row and row[0]:
                inserted += 1
            else:
                updated += 1

        conn.commit()

        cur.execute(
            """
            SELECT count(*),
                   count(*) FILTER (WHERE source = 'OSM_IMPORT'),
                   count(*) FILTER (WHERE source = 'STUDENT'),
                   round(sum(distance_meters)::numeric, 1)
            FROM walkways
            """
        )
        total, osm, student, total_len = cur.fetchone()

        print()
        print(f"  insérées             : {inserted}")
        print(f"  mises à jour         : {updated}")
        print(f"  total en base        : {total}  (OSM_IMPORT {osm}, STUDENT {student})")
        print(f"  longueur cumulée     : {total_len} m")

        # Vérification d'intégrité : chaque arête doit avoir deux extrémités
        # distinctes et non nulles, sinon le graphe applicatif l'écartera.
        cur.execute(
            """
            SELECT count(*) FROM walkways
            WHERE source = 'OSM_IMPORT'
              AND (from_node_id IS NULL OR to_node_id IS NULL
                   OR from_node_id = to_node_id)
            """
        )
        broken = cur.fetchone()[0]
        print(f"  arêtes malformées    : {broken}")
        if broken:
            print("  ⚠ des arêtes seront ignorées par le graphe applicatif", file=sys.stderr)

        cur.execute(
            """
            SELECT count(DISTINCT from_node_id) + count(DISTINCT to_node_id)
            FROM walkways WHERE source = 'OSM_IMPORT'
            """
        )
        print(f"  extrémités distinctes: {cur.fetchone()[0]}")
        print()
        print("OK — relancer l'API (ou attendre 60 s de cache) pour voir le graphe.")
        return 0

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Importe les cheminements OSM dans walkways.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true", help="analyse sans écrire")
    group.add_argument("--apply", action="store_true", help="écrit en base")
    args = parser.parse_args()

    dsn = os.environ.get(
        "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/uac_live"
    )
    return run(dsn, apply=args.apply)


if __name__ == "__main__":
    raise SystemExit(main())
