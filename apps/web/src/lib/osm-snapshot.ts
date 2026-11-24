/**
 * Repli sur un instantané OpenStreetMap local — apps/web/src/lib/osm-snapshot.ts
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * L'application interroge l'API PostGIS. Quand cette API n'est pas joignable
 * (démonstration hors ligne, environnement de revue sans base de données),
 * la carte affichait « aucun bâtiment » : techniquement honnête, mais cela
 * privait l'utilisateur d'une information pourtant disponible.
 *
 * Ce module fournit donc un JEU DE DONNÉES RÉELLES embarqué :
 * les 355 emprises bâties et 117 cheminements relevés dans OpenStreetMap
 * pour le campus d'Abomey-Calavi.
 *
 * CE QUE CE N'EST PAS
 * -------------------
 *  - Ce n'est PAS un jeu de données inventé : chaque sommet provient d'OSM.
 *  - Ce n'est PAS validé sur le terrain : `verificationStatus` vaut
 *    `imported_unverified`, exactement comme en base.
 *  - Ce n'est PAS une substitution silencieuse : l'interface affiche
 *    explicitement l'origine des données et la mention ODbL.
 *
 * Licence : ODbL-1.0 — © OpenStreetMap contributors.
 */

import buildingsRaw from "@/data/geo/uac-osm-buildings.geojson";
import footwaysRaw from "@/data/geo/uac-osm-footways.geojson";
import metaRaw from "@/data/geo/uac-osm-meta.json";
import type {
  BuildingFeature,
  BuildingFeatureCollection,
  EdgeFeatureCollection,
} from "@/lib/geo";

type SnapMeta = {
  source: string;
  license: string;
  attribution: string;
  attributionUrl: string;
  osmBaseTimestamp: string | null;
  extractedAt: string | null;
  validationStatus: string;
  campus: {
    osmWayId: number;
    name: string | null;
    areaHectares: number;
    vertices: number;
    bbox: { south: number; west: number; north: number; east: number };
    ring: [number, number][];
  };
  counts: {
    buildings: number;
    namedBuildings: number;
    footways: number;
    totalFootprintM2: number;
    coveragePercent: number;
    footwayLengthKm: number;
  };
  categoryCounts: Record<string, number>;
  warnings: string[];
};

export const OSM_SNAPSHOT_META = metaRaw as unknown as SnapMeta;

/** Emprises bâties réelles, prêtes pour MapLibre. */
export const OSM_SNAPSHOT_BUILDINGS =
  buildingsRaw as unknown as BuildingFeatureCollection;

/** Cheminements réels (LineString WGS84). */
export const OSM_SNAPSHOT_FOOTWAYS = footwaysRaw as unknown as {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    id: string;
    geometry: { type: "LineString"; coordinates: [number, number][] };
    properties: {
      osmId: number;
      highway: string | null;
      name: string | null;
      lengthM: number | null;
    };
  }[];
};

/** Contour officiel du campus (frontière OSM, 99,37 ha). */
export const OSM_CAMPUS_RING: [number, number][] = OSM_SNAPSHOT_META.campus.ring;

/** Centroïde simple d'une emprise, pour recentrer la carte sans inventer. */
export function featureCentroid(feature: BuildingFeature): [number, number] {
  const ring = feature.geometry.coordinates[0] ?? [];
  if (ring.length === 0) return [0, 0];
  let sx = 0;
  let sy = 0;
  for (const [lng, lat] of ring) {
    sx += lng;
    sy += lat;
  }
  return [sx / ring.length, sy / ring.length];
}

/**
 * Convertit les cheminements réels en FeatureCollection « edges », au format
 * exact attendu par `CampusMap` (propriétés `distanceMeters` / `surface`).
 */
export function footwaysToEdgeCollection(): EdgeFeatureCollection {
  return {
    type: "FeatureCollection",
    features: OSM_SNAPSHOT_FOOTWAYS.features.map((f) => ({
      type: "Feature" as const,
      id: f.id,
      geometry: f.geometry,
      properties: {
        id: f.id,
        accessible: true,
        distanceMeters: f.properties.lengthM ?? 0,
        // OSM ne publie pas le revêtement de ces tronçons : on déclare
        // inconnu plutôt que de supposer un revêtement praticable.
        surface: null,
      },
    })),
  };
}

/** Mention légale à afficher partout où l'instantané est utilisé. */
export const OSM_ATTRIBUTION_TEXT = OSM_SNAPSHOT_META.attribution;
export const OSM_LICENSE_TEXT = OSM_SNAPSHOT_META.license;
