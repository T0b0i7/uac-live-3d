/**
 * Référentiel géographique réel du campus UAC (Abomey-Calavi, Bénin).
 *
 * Source : OpenStreetMap via Overpass API — licence ODbL-1.0.
 * © OpenStreetMap contributors — https://www.openstreetmap.org/copyright
 *
 * Les emprises sont de VRAIES emprises relevées, projetées en UTM 31N
 * (EPSG:32631) puis ramenées dans un repère local métrique (1 unité = 1 m)
 * dont l'origine (0, 0) est le barycentre des surfaces bâties.
 *
 * Convention d'axes : x = est, z = -nord. Le nord pointe donc vers -Z,
 * ce qui garde la carte 2D et la scène 3D alignées.
 *
 * Aucune coordonnée n'est inventée. Les hauteurs sont estimées quand OSM
 * ne fournit ni `height` ni `levels` : le champ `heightSource` le dit
 * explicitement (`osm_height` | `osm_levels` | `estimated`).
 */

import raw from "./geo/campus-real.json";

export type GeoRing = [number, number][];

export type GeoBuilding = {
  osmId: number;
  name: string | null;
  building: string | null;
  areaM2: number;
  levels: number | null;
  height: number;
  heightSource: "osm_height" | "osm_levels" | "estimated";
  category: string;
  ring: GeoRing;
  holes: GeoRing[];
};

export type GeoFootway = {
  osmId: number;
  highway: string | null;
  name: string | null;
  lengthM: number | null;
  line: GeoRing;
};

type RawPayload = {
  meta: {
    crs: string;
    unit: string;
    origin: { easting: number; northing: number };
    osmBaseTimestamp: string | null;
    generatedAt: string | null;
    license: string;
    attribution: string;
    validationStatus: string;
    buildingCount: number;
    namedBuildingCount: number;
    footwayCount: number;
    skippedBuildings: number;
    areaTotalM2: number;
    categoryCounts: Record<string, number>;
    heightSources: Record<string, number>;
  };
  campusBoundary: {
    osmWayId: number;
    name: string | null;
    ring: GeoRing;
    areaHectares: number;
  };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  buildings: GeoBuilding[];
  footways: GeoFootway[];
};

const payload = raw as unknown as RawPayload;

export const GEO_META = payload.meta;
export const CAMPUS_BOUNDARY = payload.campusBoundary;
export const GEO_BOUNDS = payload.bounds;
export const GEO_BUILDINGS: GeoBuilding[] = payload.buildings;
export const GEO_FOOTWAYS: GeoFootway[] = payload.footways;

/** Mention légale obligatoire dès qu'une donnée dérivée d'OSM est affichée. */
export const OSM_ATTRIBUTION = payload.meta.attribution;
export const OSM_LICENSE = payload.meta.license;
export const OSM_TIMESTAMP = payload.meta.osmBaseTimestamp;

/** Centre géométrique du campus, dans le repère local. */
export const CAMPUS_CENTER = {
  x: (payload.bounds.minX + payload.bounds.maxX) / 2,
  z: (payload.bounds.minZ + payload.bounds.maxZ) / 2,
};

/** Étendue du campus en mètres (largeur est-ouest, profondeur nord-sud). */
export const CAMPUS_SPAN = {
  width: payload.bounds.maxX - payload.bounds.minX,
  depth: payload.bounds.maxZ - payload.bounds.minZ,
};

/** Centroïde d'une emprise (moyenne des sommets, suffisant pour un label). */
export function ringCentroid(ring: GeoRing): { x: number; z: number } {
  let sx = 0;
  let sz = 0;
  for (const [x, z] of ring) {
    sx += x;
    sz += z;
  }
  return { x: sx / ring.length, z: sz / ring.length };
}

/** Aire d'une emprise, par formule du lacet. */
export function ringArea(ring: GeoRing): number {
  let s = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    s += x1 * z2 - x2 * z1;
  }
  return Math.abs(s / 2);
}

/** Index des bâtiments nommés, triés par surface décroissante. */
export const NAMED_BUILDINGS: GeoBuilding[] = GEO_BUILDINGS.filter(
  (b) => b.name !== null && b.name.trim().length > 0,
).sort((a, b) => b.areaM2 - a.areaM2);

/** Les plus grandes emprises, nommées ou non — utile pour les labels de carte. */
export const MAJOR_BUILDINGS: GeoBuilding[] = [...GEO_BUILDINGS]
  .sort((a, b) => b.areaM2 - a.areaM2)
  .slice(0, 40);

export const GEO_BUILDING_BY_ID = new Map<number, GeoBuilding>(
  GEO_BUILDINGS.map((b) => [b.osmId, b]),
);

/**
 * Identifiant applicatif stable pour une emprise OSM.
 * Utilisé partout dans l'app (alertes, groupes, navigation) là où un bâtiment
 * est attendu : `osm-<osmId>`.
 */
export function geoBuildingAppId(osmId: number): string {
  return `osm-${osmId}`;
}

export function osmIdFromAppId(appId: string): number | null {
  if (!appId.startsWith("osm-")) return null;
  const n = Number.parseInt(appId.slice(4), 10);
  return Number.isFinite(n) ? n : null;
}
