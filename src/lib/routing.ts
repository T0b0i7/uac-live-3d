import { BUILDING_BY_ID, CAMPUS_BUILDINGS } from "@/data/buildings";
import type { Building, PedestrianRoute, RouteStep, Vec2 } from "@/types";

/**
 * MOCK PEDESTRIAN GRAPH
 * ---------------------
 * Routes are generated on a stylised pedestrian spine that connects the demo
 * buildings through a handful of shared waypoints (campus promenade + main
 * crossroads). Distances are euclidean samples of that spine scaled by a
 * 1.18 "path meander" factor, so they read plausibly without claiming to be
 * surveyed campus paths. A real deployment should swap this module for a
 * routing engine over verified OSM footpaths.
 */

const MEANDER = 1.18;
const WALK_SPEED_M_PER_MIN = 78; // relaxed campus walking pace

/** Shared pedestrian waypoints (demo coordinates). */
const SPINE: Vec2[] = [
  { x: 0, z: 26 }, // IFRI forecourt
  { x: -34, z: 22 }, // west promenade
  { x: -60, z: -6 }, // crossroads near infirmary
  { x: -44, z: -38 }, // library approach
  { x: -104, z: -44 }, // FAST approach
  { x: -116, z: 0 }, // resto approach
  { x: -140, z: -70 }, // residences approach
  { x: -62, z: 70 }, // COUS approach
  { x: -20, z: 44 }, // student life junction
  { x: 30, z: 52 }, // east promenade
  { x: 34, z: 104 }, // stadium approach
  { x: 92, z: 92 }, // FLSH approach
  { x: 122, z: 30 }, // rectorate approach
  { x: 150, z: -70 }, // FADESP approach
  { x: 88, z: -28 }, // administration approach
  { x: 62, z: -84 }, // amphitheatre approach
];

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function nearestSpine(p: Vec2): number {
  let best = 0;
  let bestD = Infinity;
  SPINE.forEach((s, i) => {
    const d = dist(p, s);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** A tiny BFS over the waypoint ring (they are ordered, so neighbours are i±1). */
function spinePath(from: Vec2, to: Vec2): Vec2[] {
  const a = nearestSpine(from);
  const b = nearestSpine(to);
  const out: Vec2[] = [from];
  if (a === b) {
    out.push(SPINE[a]!);
  } else {
    const step = a < b ? 1 : -1;
    for (let i = a; i !== b + step; i += step) {
      out.push(SPINE[i]!);
    }
  }
  out.push(to);
  // De-duplicate consecutive identical points.
  return out.filter((p, i, arr) => i === 0 || dist(p, arr[i - 1]!) > 0.5);
}

function pathDistance(points: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1]!, points[i]!);
  return total;
}

function bearing(a: Vec2, b: Vec2): number {
  return (Math.atan2(b.x - a.x, b.z - a.z) * 180) / Math.PI;
}

function turnIcon(prev: Vec2, cur: Vec2, next: Vec2): RouteStep["icon"] {
  const b1 = bearing(prev, cur);
  const b2 = bearing(cur, next);
  let delta = b2 - b1;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  if (Math.abs(delta) < 22) return "straight";
  return delta > 0 ? "right" : "left";
}

const LANDMARKS: { at: Vec2; label: string }[] = [
  { at: { x: -60, z: -6 }, label: "l'infirmerie universitaire" },
  { at: { x: -34, z: 22 }, label: "la promenade ouest" },
  { at: { x: 30, z: 52 }, label: "l'Espace Vie Étudiante" },
  { at: { x: 34, z: 104 }, label: "le complexe sportif" },
  { at: { x: 122, z: 30 }, label: "l'allée du Rectorat" },
  { at: { x: -44, z: -38 }, label: "la bibliothèque centrale" },
  { at: { x: 88, z: -28 }, label: "les bureaux administratifs" },
];

function landmarkNear(p: Vec2): string | null {
  let best: string | null = null;
  let bestD = 26;
  for (const l of LANDMARKS) {
    const d = dist(p, l.at);
    if (d < bestD) {
      bestD = d;
      best = l.label;
    }
  }
  return best;
}

export function computeRoute(fromId: string, toId: string): PedestrianRoute | null {
  const from = BUILDING_BY_ID.get(fromId);
  const to = BUILDING_BY_ID.get(toId);
  if (!from || !to || from.id === to.id) return null;

  const points = spinePath(from.position, to.position);
  const distanceM = Math.round(pathDistance(points) * MEANDER);
  const durationMin = Math.max(1, Math.round(distanceM / WALK_SPEED_M_PER_MIN));

  const steps: RouteStep[] = [
    {
      instruction: `Partez de ${from.shortName} et rejoignez l'allée piétonne`,
      distanceM: Math.round(dist(points[0]!, points[1]!) * MEANDER),
      icon: "start",
    },
  ];

  for (let i = 1; i < points.length - 1; i++) {
    const icon = turnIcon(points[i - 1]!, points[i]!, points[i + 1]!);
    const seg = Math.round(dist(points[i]!, points[i + 1]!) * MEANDER);
    const lm = landmarkNear(points[i]!);
    const verb = icon === "left" ? "Tournez à gauche" : icon === "right" ? "Tournez à droite" : "Continuez tout droit";
    steps.push({
      instruction: lm ? `${verb} en longeant ${lm}` : verb,
      distanceM: seg,
      icon,
    });
  }

  steps.push({
    instruction: `Vous êtes arrivé à ${to.shortName}`,
    distanceM: 0,
    icon: "destination",
  });

  return {
    id: `route-${fromId}-${toId}`,
    fromBuildingId: fromId,
    toBuildingId: toId,
    points,
    distanceM,
    durationMin,
    steps,
  };
}

/**
 * Deterministic pseudo-position inside a building's demo footprint.
 * Used so the radar + 3D avatars agree without shipping real GPS data.
 */
export function occupancyPointFor(building: Building, seed: number): Vec2 {
  const angle = (seed * 2.399963) % (Math.PI * 2);
  const r = 0.22 + ((seed * 37) % 100) / 260;
  return {
    x: building.position.x + Math.cos(angle) * building.footprint.w * r,
    z: building.position.z + Math.sin(angle) * building.footprint.d * r,
  };
}

export const CAMPUS_BOUNDS = (() => {
  const xs = CAMPUS_BUILDINGS.map((b) => b.position.x);
  const zs = CAMPUS_BUILDINGS.map((b) => b.position.z);
  const pad = 130;
  return {
    minX: Math.min(...xs) - pad,
    maxX: Math.max(...xs) + pad,
    minZ: Math.min(...zs) - pad,
    maxZ: Math.max(...zs) + pad,
  };
})();

export function campusCenter(): Vec2 {
  return { x: (CAMPUS_BOUNDS.minX + CAMPUS_BOUNDS.maxX) / 2, z: (CAMPUS_BOUNDS.minZ + CAMPUS_BOUNDS.maxZ) / 2 };
}
