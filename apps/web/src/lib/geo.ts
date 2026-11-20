/**
 * Conversion des données serveur vers GeoJSON — apps/web/src/lib/geo.ts
 *
 * RÈGLE ABSOLUE : on ne fabrique aucune géométrie. Si un bâtiment n'a pas de
 * polygone en base, il n'apparaît pas comme surface — il apparaît comme point
 * s'il possède un centroïde, et pas du tout sinon. Inventer un rectangle autour
 * d'un centroïde donnerait une carte crédible et fausse.
 */

import type { Building } from "@uac/contracts";
import type { GraphEdgeDto, GraphNodeDto } from "@/lib/api/endpoints";

/** Centre du campus d'Abomey-Calavi, utilisé comme vue initiale. */
export const CAMPUS_CENTER: [number, number] = [2.3395, 6.4145];

export const CAMPUS_ZOOM = 15.4;

/** Emprise approximative du campus : sert à valider les coordonnées reçues. */
export const CAMPUS_BOUNDS = {
  minLng: 2.1,
  maxLng: 2.6,
  minLat: 6.2,
  maxLat: 6.6,
} as const;

export function isInsideCampus(lng: number, lat: number): boolean {
  return (
    lng >= CAMPUS_BOUNDS.minLng &&
    lng <= CAMPUS_BOUNDS.maxLng &&
    lat >= CAMPUS_BOUNDS.minLat &&
    lat <= CAMPUS_BOUNDS.maxLat
  );
}

export type BuildingFeature = {
  type: "Feature";
  id: string;
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
  properties: {
    id: string;
    code: string;
    name: string;
    shortName: string | null;
    category: string;
    facultyName: string | null;
    floors: number;
    footprintAreaM2: number | null;
    verificationStatus: string;
    isGeoreferenced: boolean;
  };
};

export type BuildingFeatureCollection = {
  type: "FeatureCollection";
  features: BuildingFeature[];
};

/**
 * Construit la FeatureCollection des bâtiments géoréférencés.
 *
 * Les coordonnées sont validées (bornes + anneau fermé) avant d'être envoyées à
 * MapLibre : une géométrie invalide fait planter le rendu de la couche entière,
 * pas seulement l'entité fautive.
 */
export function buildingsToFeatureCollection(buildings: Building[]): BuildingFeatureCollection {
  const features: BuildingFeature[] = [];

  for (const building of buildings) {
    const geometry = building.geometry;
    if (!geometry || geometry.type !== "Polygon") continue;

    const rings = geometry.coordinates;
    if (!Array.isArray(rings) || rings.length === 0) continue;

    const valid = rings.every(
      (ring) =>
        Array.isArray(ring) &&
        ring.length >= 4 &&
        ring.every(
          (point) =>
            Array.isArray(point) &&
            point.length >= 2 &&
            Number.isFinite(point[0]) &&
            Number.isFinite(point[1]) &&
            isInsideCampus(point[0]!, point[1]!),
        ),
    );
    if (!valid) continue;

    features.push({
      type: "Feature",
      id: building.id,
      geometry: { type: "Polygon", coordinates: rings as [number, number][][] },
      properties: {
        id: building.id,
        code: building.code,
        name: building.name,
        shortName: building.shortName,
        category: building.category,
        facultyName: building.facultyName,
        floors: building.floors,
        footprintAreaM2: building.footprintAreaM2,
        verificationStatus: building.verificationStatus,
        isGeoreferenced: building.isGeoreferenced,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/** Bâtiments sans polygone mais avec un centroïde : affichés en marqueur. */
export function buildingsWithoutGeometry(buildings: Building[]): Building[] {
  return buildings.filter(
    (b) =>
      (!b.geometry || b.geometry.type !== "Polygon") &&
      b.centroid &&
      isInsideCampus(b.centroid.lng, b.centroid.lat),
  );
}

export type NodeFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: { id: string; type: string; label: string | null; accessible: boolean };
  }>;
};

export function graphNodesToFeatureCollection(nodes: GraphNodeDto[]): NodeFeatureCollection {
  return {
    type: "FeatureCollection",
    features: nodes
      .filter((n) => isInsideCampus(n.lng, n.lat))
      .map((n) => ({
        type: "Feature" as const,
        id: n.id,
        geometry: { type: "Point" as const, coordinates: [n.lng, n.lat] as [number, number] },
        properties: { id: n.id, type: n.type, label: n.label, accessible: n.accessible },
      })),
  };
}

export type EdgeFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    geometry: { type: "LineString"; coordinates: [number, number][] };
    properties: { id: string; accessible: boolean; distanceMeters: number; surface: string | null };
  }>;
};

/** Arêtes du graphe : une LineString par allée entre deux nœuds réels. */
export function graphEdgesToFeatureCollection(
  edges: GraphEdgeDto[],
  nodes: GraphNodeDto[],
): EdgeFeatureCollection {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const features: EdgeFeatureCollection["features"] = [];

  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    // Une arête dont une extrémité manque serait une ligne inventée : on l'ignore.
    if (!source || !target) continue;
    if (!isInsideCampus(source.lng, source.lat) || !isInsideCampus(target.lng, target.lat)) continue;

    features.push({
      type: "Feature",
      id: edge.id,
      geometry: {
        type: "LineString",
        coordinates: [
          [source.lng, source.lat],
          [target.lng, target.lat],
        ],
      },
      properties: {
        id: edge.id,
        accessible: edge.accessible,
        distanceMeters: edge.distanceMeters,
        surface: edge.surface,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/** Itinéraire calculé localement → LineString affichable. */
export function routeToFeatureCollection(
  coordinates: Array<{ lat: number; lng: number }>,
): EdgeFeatureCollection {
  if (coordinates.length < 2) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "route",
        geometry: {
          type: "LineString",
          coordinates: coordinates.map((c) => [c.lng, c.lat] as [number, number]),
        },
        properties: { id: "route", accessible: true, distanceMeters: 0, surface: null },
      },
    ],
  };
}

/** Libellé court pour l'affichage (le nom complet est trop long sur une puce). */
export function buildingLabel(building: {
  shortName: string | null;
  name: string;
  code: string;
}): string {
  return building.shortName ?? building.name ?? building.code;
}
