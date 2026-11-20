/**
 * Primitives géographiques — @uac/geospatial
 *
 * Toutes les entrées sont en degrés WGS84 (SRID 4326).
 * Toutes les sorties de distance sont en MÈTRES RÉELS.
 *
 * Règle absolue (voir ADR-003) : on ne compare jamais des degrés à des mètres.
 * Un degré de longitude vaut ~111 320 m à l'équateur mais ~110 570 m à 6.4° de
 * latitude, et un degré de latitude est quasi constant (~110 574 m). C'est
 * pourquoi la conversion degrés→mètres passe TOUJOURS par l'ellipsoïde.
 */

export interface LonLat {
  /** Longitude en degrés décimaux (axe est-ouest, négatif = ouest). */
  lng: number;
  /** Latitude en degrés décimaux (axe nord-sud, négatif = sud). */
  lat: number;
}

export interface BoundingBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/** Rayon moyen terrestre (IUGG), en mètres. */
export const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/**
 * Distance de Haversine : rapide, précise à ~0,5 % près sur des distances
 * inférieures à quelques dizaines de kilomètres. Suffisante pour un campus.
 *
 * Équivalent PostGIS : ST_Distance(a::geography, b::geography)
 * (PostGIS utilise une vraie ellipse ; l'écart ici est négligeable à cette échelle.)
 */
export function haversineMeters(a: LonLat, b: LonLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cap initial de a vers b, en degrés depuis le nord géographique (0–360). */
export function bearingDegrees(a: LonLat, b: LonLat): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point atteint depuis `origin` en suivant `bearing` sur `distance` mètres. */
export function destinationPoint(origin: LonLat, bearing: number, distanceMeters: number): LonLat {
  const angular = distanceMeters / EARTH_RADIUS_M;
  const theta = toRad(bearing);
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(theta),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: toDeg(lat2), lng: ((toDeg(lng2) + 540) % 360) - 180 };
}

/**
 * Conversion degrés → mètres autour d'une latitude donnée.
 * Indispensable pour dimensionner un `ST_MakeEnvelope` ou un filtre local.
 */
export function degreesToMeters(latitudeDeg: number): { metersPerDegLat: number; metersPerDegLng: number } {
  const latRad = toRad(latitudeDeg);
  // Méridien : rayon de courbure méridien.
  const metersPerDegLat = 111_132.954 - 559.822 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
  // Parallèle : rayon du parallèle (cos de la latitude).
  const metersPerDegLng = (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(latRad);
  return { metersPerDegLat, metersPerDegLng };
}

/**
 * Boîte englobante carrée autour d'un point, exprimée en degrés.
 * ATTENTION : `radiusMeters` est converti séparément sur chaque axe, sinon la
 * boîte serait plus large en longitude qu'en latitude aux hautes latitudes.
 */
export function bboxAround(center: LonLat, radiusMeters: number): BoundingBox {
  const { metersPerDegLat, metersPerDegLng } = degreesToMeters(center.lat);
  const dLat = radiusMeters / metersPerDegLat;
  const dLng = radiusMeters / Math.max(metersPerDegLng, 1e-9);
  return {
    minLng: center.lng - dLng,
    maxLng: center.lng + dLng,
    minLat: center.lat - dLat,
    maxLat: center.lat + dLat,
  };
}

export function bboxContains(bbox: BoundingBox, point: LonLat): boolean {
  return (
    point.lng >= bbox.minLng &&
    point.lng <= bbox.maxLng &&
    point.lat >= bbox.minLat &&
    point.lat <= bbox.maxLat
  );
}

export function bboxCenter(bbox: BoundingBox): LonLat {
  return {
    lng: (bbox.minLng + bbox.maxLng) / 2,
    lat: (bbox.minLat + bbox.maxLat) / 2,
  };
}

/** Étend une boîte pour englober un point. */
export function bboxExtend(bbox: BoundingBox, point: LonLat): BoundingBox {
  return {
    minLng: Math.min(bbox.minLng, point.lng),
    minLat: Math.min(bbox.minLat, point.lat),
    maxLng: Math.max(bbox.maxLng, point.lng),
    maxLat: Math.max(bbox.maxLat, point.lat),
  };
}

/** Boîte englobante d'une liste de points. Renvoie `null` si la liste est vide. */
export function bboxOfPoints(points: readonly LonLat[]): BoundingBox | null {
  if (points.length === 0) return null;
  let bbox: BoundingBox = {
    minLng: Infinity,
    minLat: Infinity,
    maxLng: -Infinity,
    maxLat: -Infinity,
  };
  for (const point of points) bbox = bboxExtend(bbox, point);
  return bbox;
}

/** Vrai si deux boîtes se recouvrent (test d'intersection AABB en degrés). */
export function bboxIntersects(a: BoundingBox, b: BoundingBox): boolean {
  return !(a.maxLng < b.minLng || b.maxLng < a.minLng || a.maxLat < b.minLat || b.maxLat < a.minLat);
}

/**
 * Test point-dans-polygone (algorithme ray-casting, frontière incluse).
 * Le polygone est une liste d'anneaux fermés implicitement ; on utilise le premier.
 * Utilisé pour rattacher une position à un bâtiment sans requête PostGIS.
 */
export function pointInPolygon(point: LonLat, ring: readonly LonLat[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i]!;
    const pj = ring[j]!;
    const intersects =
      pi.lat > point.lat !== pj.lat > point.lat &&
      point.lng < ((pj.lng - pi.lng) * (point.lat - pi.lat)) / (pj.lat - pi.lat || 1e-12) + pi.lng;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Aire approximative d'un anneau en m² (projection locale équirectangulaire). */
export function polygonAreaMeters(ring: readonly LonLat[]): number {
  if (ring.length < 3) return 0;
  let centroidLat = 0;
  for (const p of ring) centroidLat += p.lat;
  centroidLat /= ring.length;
  const { metersPerDegLat, metersPerDegLng } = degreesToMeters(centroidLat);

  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i]!;
    const pj = ring[j]!;
    area += pj.lng * metersPerDegLng * (pi.lat * metersPerDegLat) -
            pi.lng * metersPerDegLng * (pj.lat * metersPerDegLat);
  }
  return Math.abs(area) / 2;
}

/**
 * Obfuscation de position pour le mode BLURRED_ZONE (voir ADR-006).
 *
 * Deux garanties : (1) la position retournée est à au moins `minOffsetMeters` de
 * l'originale, donc jamais l'exacte ; (2) le décalage est DÉTERMINISTE par
 * `(userId, période)` — un même utilisateur obtient le même point pendant toute la
 * période, ce qui empêche de trianguler la vraie position par requêtes répétées.
 */
export function blurPosition(
  actual: LonLat,
  userId: string,
  periodMs: number,
  radiusMeters: number,
  /**
   * Instant de référence (ms). Injectable pour rendre le flou testable de façon
   * déterministe : sans cela, les tests dépendraient de l'horloge murale et
   * pourraient échouer au changement de période (une fois par heure).
   */
  now: number = Date.now(),
): LonLat {
  const period = Math.floor(now / periodMs);
  const seed = `${userId}:${period}`;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const angle = ((h >>> 0) % 3600) / 10;
  const distance = radiusMeters * (0.6 + (((h >>> 12) >>> 0) % 400) / 1000);
  return destinationPoint(actual, angle, distance);
}
