# ADR-003 — PostgreSQL 17 + PostGIS comme source de vérité

**Statut** : Accepté
**Date** : 2026-01

## Contexte

Le cœur du produit est géographique : bâtiments (polygones), allées piétonnes (LineString), positions GPS (Point), requêtes « qu'est-ce qui est à moins de 200 m de moi ». Un stockage JSON ou une base non spatiale imposerait de calculer toutes les distances en JavaScript applicatif, ce qui ne passe pas à l'échelle et rend le filtrage par boîte englobante impossible.

## Décision

**PostgreSQL 17 + PostGIS 3.5** avec colonnes `geometry(..., 4326)` (SRID WGS84). Les distances métriques utilisent des casts `::geography` (calcul ellipsoïdal réel) ou `ST_DWithin(geography, geography, mètres)`. Index **GIST** sur toutes les colonnes géométriques.

## Règles impératives

1. **Ne jamais comparer des degrés à des mètres.** 0.001° de longitude vaut ~111 m à l'équateur mais ~85 m à Cotonou (latitude 6.4°) — et varie avec la latitude.
2. Tout objet géographique porte `source` (`OSM` | `INSTITUTIONAL` | `STUDENT`), `verification_status`, `created_at`, `updated_at`, `created_by`, `last_verified_at`.
3. Un polygone de bâtiment est stocké en `4326` ; son aire en m² est calculée via `ST_Area(geom::geography)`.

## Alternatives écartées

| Alternative | Raison du rejet |
|---|---|
| MongoDB + index 2dsphere | Transactions multi-documents plus faibles ; pas de contraintes d'intégrité référentielle |
| SQLite + SpatiaLite | Pas d'équivalent `geography`, pas de concurrence d'écriture sérieuse |
| MySQL | Support spatial moins mature, pas de `geography` métrique |
| Store géospatial dédié (Elasticsearch) | Duplication de source de vérité |

## Conséquences

Contraintes `CHECK` + clés étrangères garantissent l'intégrité ; les migrations versionnées Drizzle rendent le schéma reproductible. Sauvegarde = `pg_dump` + restauration testée (`docs/deployment/backup-restore.md`).
