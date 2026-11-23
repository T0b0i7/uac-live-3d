-- ============================================================================
-- UAC-Live 3D — Migration 0002 : référentiel géographique réel (OSM)
--
-- Contexte et décision (cf. rapport d'audit tools/geo/out/audit-report.json) :
--   - les 15 bâtiments livrés en 0001 étaient des rectangles synthétiques de
--     5 points, dont 8 hors du polygone du campus UAC ;
--   - ils sont remplacés comme RÉFÉRENTIEL CARTOGRAPHIQUE par les empreintes
--     réelles OpenStreetMap (355 bâtiments dans le périmètre OSM du campus) ;
--   - aucune donnée historique n'est détruite : les lignes sont déplacées vers
--     `buildings_archive` (snapshot JSONB complet) et un lien de correspondance
--     est conservé dans `building_code_mapping`.
--
-- Cette migration est idempotente (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT
-- EXISTS / gardes sur les contraintes) : elle peut être rejouée sans effet de
-- bord, et le runner vérifie déjà le checksum des migrations appliquées.
--
-- Elle n'ajoute AUCUNE donnée géographique : l'import OSM est fait ensuite par
-- tools/geo/import_osm.py, qui est le seul à écrire dans `buildings`.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Traçabilité de provenance sur `buildings`
--
-- `source` (OSM | INSTITUTIONAL | STUDENT) existait déjà mais ne disait pas
-- QUELLE entité OSM est à l'origine de l'empreinte. Sans `source_id`, on ne
-- peut ni réimporter sans doublon, ni propager une correction OSM.
-- `confidence_level` matérialise la gradation exigée par la mission :
--   verified | imported_unverified | estimated | missing | rejected
-- ---------------------------------------------------------------------------
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS source_id  varchar(64);
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS confidence_level varchar(20)
  NOT NULL DEFAULT 'imported_unverified';
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS imported_at timestamptz;

-- Le code institutionnel dérivé d'un nom OSM peut dépasser 24 caractères.
ALTER TABLE buildings ALTER COLUMN code TYPE varchar(64);

COMMENT ON COLUMN buildings.source_id IS
  'Identifiant de la source primaire, ex. way/347314860 (OSM). NULL = donnée sans source externe.';
COMMENT ON COLUMN buildings.confidence_level IS
  'verified | imported_unverified | estimated | missing | rejected — voir ADR géospatial.';

-- Un même objet OSM ne peut pas produire deux bâtiments (anti-doublon d'import).
CREATE UNIQUE INDEX IF NOT EXISTS buildings_source_id_uq
  ON buildings (source, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS buildings_confidence_idx
  ON buildings (confidence_level);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'buildings_confidence_valid'
  ) THEN
    ALTER TABLE buildings ADD CONSTRAINT buildings_confidence_valid
      CHECK (confidence_level IN
        ('verified','imported_unverified','estimated','missing','rejected'));
  END IF;

  -- `source` accepte désormais OSM_IMPORT pour distinguer un import automatisé
  -- d'une saisie terrain, sans perdre l'information « ça vient d'OSM ».
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'buildings_source_valid') THEN
    ALTER TABLE buildings DROP CONSTRAINT buildings_source_valid;
  END IF;
  ALTER TABLE buildings ADD CONSTRAINT buildings_source_valid
    CHECK (source IN ('OSM','OSM_IMPORT','INSTITUTIONAL','STUDENT'));
END $$;

-- ---------------------------------------------------------------------------
-- 2. Traçabilité sur `walkways`
--    Une allée piétonne doit pouvoir être rattachée à son way OSM pour être
--    rafraîchie sans dupliquer le réseau.
-- ---------------------------------------------------------------------------
ALTER TABLE walkways ADD COLUMN IF NOT EXISTS source_id  varchar(64);
ALTER TABLE walkways ADD COLUMN IF NOT EXISTS imported_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS walkways_source_id_uq
  ON walkways (source, source_id)
  WHERE source_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Périmètres du campus
--
-- Décision projet : les 99,3 ha du polygone OSM (`way/347214829`) sont un
-- périmètre PROVISOIRE, pas la frontière officielle de l'UAC. On stocke donc
-- les deux notions distinctement, et plusieurs périmètres peuvent coexister
-- (extension progressive à l'intégralité du campus).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campus_boundaries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           varchar(48)  NOT NULL,
  name           varchar(180) NOT NULL,
  boundary_type  varchar(32)  NOT NULL,
  geometry       geometry(MultiPolygon, 4326) NOT NULL,
  area_m2        double precision,
  source         varchar(16)  NOT NULL,
  source_id      varchar(64),
  license        varchar(32),
  notes          text,
  is_active      boolean      NOT NULL DEFAULT true,
  imported_at    timestamptz,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS campus_boundaries_code_uq
  ON campus_boundaries (code);
CREATE INDEX IF NOT EXISTS campus_boundaries_geom_gist
  ON campus_boundaries USING gist (geometry);
CREATE INDEX IF NOT EXISTS campus_boundaries_type_idx
  ON campus_boundaries (boundary_type);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campus_boundaries_type_valid'
  ) THEN
    ALTER TABLE campus_boundaries ADD CONSTRAINT campus_boundaries_type_valid
      CHECK (boundary_type IN ('osm_boundary','official_campus_boundary','study_area'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campus_boundaries_source_valid'
  ) THEN
    ALTER TABLE campus_boundaries ADD CONSTRAINT campus_boundaries_source_valid
      CHECK (source IN ('OSM','INSTITUTIONAL','STUDENT'));
  END IF;
END $$;

COMMENT ON COLUMN campus_boundaries.boundary_type IS
  'osm_boundary = périmètre déduit d''OSM (provisoire) ; official_campus_boundary = '
  'frontière officielle validée par l''UAC ; study_area = emprise de travail élargie.';

-- ---------------------------------------------------------------------------
-- 4. Archive des bâtiments remplacés
--
-- Aucune ligne de `buildings` n'est supprimée sans copie intégrale préalable.
-- Le snapshot JSONB permet de restaurer un état antérieur même si le schéma a
-- évolué (les colonnes ajoutées plus tard n'y figurent pas, c'est assumé).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS buildings_archive (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id     uuid         NOT NULL,
  code            varchar(64)  NOT NULL,
  reason          text         NOT NULL,
  snapshot        jsonb        NOT NULL,
  footprint_wkt   text,
  archived_at     timestamptz  NOT NULL DEFAULT now(),
  archived_by_migration varchar(64) NOT NULL DEFAULT '0002_osm_geospatial_referential'
);

CREATE INDEX IF NOT EXISTS buildings_archive_code_idx
  ON buildings_archive (code);
CREATE INDEX IF NOT EXISTS buildings_archive_original_idx
  ON buildings_archive (original_id);

COMMENT ON TABLE buildings_archive IS
  'Copie immuable des bâtiments retirés du référentiel cartographique. '
  'Conserver : c''est la seule trace des géométries synthétiques antérieures.';

-- ---------------------------------------------------------------------------
-- 5. Table de correspondance ancien code -> empreinte OSM retenue
--
-- Permet de retrouver, pour chaque bâtiment historique, l'empreinte réelle qui
-- le remplace (ou de constater qu''aucune correspondance fiable n'existe, auquel
-- cas le bâtiment devient une fiche institutionnelle sans géométrie).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS building_code_mapping (
  old_code        varchar(64) PRIMARY KEY,
  old_name        varchar(180) NOT NULL,
  new_building_id uuid REFERENCES buildings(id) ON DELETE SET NULL,
  new_source_id   varchar(64),
  match_type      varchar(24) NOT NULL,
  match_distance_m double precision,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'building_code_mapping_match_valid'
  ) THEN
    ALTER TABLE building_code_mapping ADD CONSTRAINT building_code_mapping_match_valid
      CHECK (match_type IN ('geometry_matched','name_matched','no_geometry','rejected'));
  END IF;
END $$;

COMMENT ON COLUMN building_code_mapping.match_type IS
  'geometry_matched = empreinte OSM fiable ; name_matched = nom OSM crédible mais '
  'géométrie non contrôlée ; no_geometry = fiche institutionnelle sans empreinte ; '
  'rejected = aucune correspondance, donnée écartée.';

COMMIT;
