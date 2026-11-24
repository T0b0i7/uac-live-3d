import { BUILDING_BY_ID, CAMPUS_BUILDINGS } from "@/data/buildings";
import { CAMPUS_BOUNDARY, GEO_BOUNDS, GEO_FOOTWAYS } from "@/data/campus-geo";
import type { Building, PedestrianRoute, RouteStep, Vec2 } from "@/types";

/**
 * ROUTAGE PIÉTON SUR LE RÉSEAU RÉEL
 * ----------------------------------
 * Le graphe est construit à partir des 117 cheminements d'OpenStreetMap
 * (licence ODbL — © OpenStreetMap contributors) : chaque extrémité de
 * segment devient un nœud, les nœuds distants de moins de 3 m sont fusionnés,
 * puis un Dijkstra pondéré par la longueur réelle calcule le trajet.
 *
 * Les distances sont donc des distances MESURÉES le long des cheminements,
 * et non une distance à vol d'oiseau majorée d'un facteur arbitraire.
 *
 * Limites assumées :
 *  - OSM ne qualifie pas le revêtement ni l'accessibilité de tous les
 *    cheminements : un itinéraire PMR n'est PAS garanti.
 *  - Le rattachement d'un bâtiment au réseau se fait par le nœud le plus
 *    proche (liaison rectiligne finale), pas par une entrée relevée.
 *  - Le réseau OSM du campus est partiellement incomplet (117 tronçons).
 *    Un trajet peut donc emprunter la liaison directe si aucun chemin
 *    n'existe : ce cas est signalé dans `RouteStep.instruction`.
 */

const WALK_SPEED_M_PER_MIN = 78; // allure piétonne détendue sur campus
const SNAP_TOLERANCE_M = 3; // fusion des extrémités quasi confondues
const MAX_LINK_M = 400; // au-delà, on refuse la liaison au réseau

type Node = { id: number; x: number; z: number };
type Edge = { to: number; w: number };

/** Graphe non orienté construit une seule fois au chargement du module. */
const GRAPH = buildGraph();

function buildGraph(): { nodes: Node[]; adj: Edge[][] } {
  const nodes: Node[] = [];
  const adj: Edge[][] = [];
  const cell = 8; // grille spatiale de fusion, en mètres
  const grid = new Map<string, number[]>();

  const key = (x: number, z: number) =>
    `${Math.floor(x / cell)}:${Math.floor(z / cell)}`;

  const findOrCreate = (x: number, z: number): number => {
    const k = key(x, z);
    // Cherche dans la cellule et les 8 voisines (tolérance de fusion).
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const bucket = grid.get(`${cx + dx}:${cz + dz}`);
        if (!bucket) continue;
        for (const id of bucket) {
          const n = nodes[id]!;
          if (Math.hypot(n.x - x, n.z - z) <= SNAP_TOLERANCE_M) return id;
        }
      }
    }
    const id = nodes.length;
    nodes.push({ id, x, z });
    adj.push([]);
    const b = grid.get(k);
    if (b) b.push(id);
    else grid.set(k, [id]);
    return id;
  };

  const connect = (a: number, b: number) => {
    if (a === b) return;
    const na = nodes[a]!;
    const nb = nodes[b]!;
    const w = Math.hypot(nb.x - na.x, nb.z - na.z);
    if (w < 0.05) return;
    // Évite les doublons d'arêtes parallèles.
    if (adj[a]!.some((e) => e.to === b)) return;
    adj[a]!.push({ to: b, w });
    adj[b]!.push({ to: a, w });
  };

  for (const fw of GEO_FOOTWAYS) {
    const pts = fw.line;
    let prev = -1;
    for (const [x, z] of pts) {
      const id = findOrCreate(x, z);
      if (prev >= 0) connect(prev, id);
      prev = id;
    }
  }

  return { nodes, adj };
}

/** Nœud du réseau le plus proche d'un point, avec sa distance. */
function nearestNode(p: Vec2): { id: number; d: number } | null {
  let best = -1;
  let bestD = Infinity;
  for (const n of GRAPH.nodes) {
    const d = Math.hypot(n.x - p.x, n.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = n.id;
    }
  }
  if (best < 0) return null;
  return { id: best, d: bestD };
}

/** Dijkstra sur le graphe piéton réel. */
function shortestPath(startId: number, goalId: number): number[] | null {
  if (startId === goalId) return [startId];
  const n = GRAPH.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);

  dist[startId] = 0;
  // File de priorité simple (tas binaire) — le graphe fait ~600 nœuds.
  const heap: { id: number; d: number }[] = [{ id: startId, d: 0 }];
  const push = (item: { id: number; d: number }) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]!.d <= heap[i]!.d) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]!.d < heap[m]!.d) m = l;
        if (r < heap.length && heap[r]!.d < heap[m]!.d) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };

  while (heap.length) {
    const cur = pop();
    if (visited[cur!.id]) continue;
    visited[cur!.id] = 1;
    if (cur!.id === goalId) break;
    for (const e of GRAPH.adj[cur!.id]!) {
      const nd = dist[cur!.id]! + e.w;
      if (nd < dist[e.to]!) {
        dist[e.to] = nd;
        prev[e.to] = cur!.id;
        push({ id: e.to, d: nd });
      }
    }
  }

  if (!Number.isFinite(dist[goalId]!)) return null;
  const path: number[] = [];
  let cur = goalId;
  while (cur >= 0) {
    path.push(cur);
    if (cur === startId) break;
    cur = prev[cur]!;
  }
  return path.reverse();
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
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

/** Repères nommés réels, pour contextualiser les instructions. */
const WAYPOINT_LABELS = CAMPUS_BUILDINGS.filter((b) => b.confidence === "osm_footprint").map(
  (b) => ({ at: b.position, label: b.shortName }),
);

function landmarkNear(p: Vec2, maxD = 70): string | null {
  let best: string | null = null;
  let bestD = maxD;
  for (const l of WAYPOINT_LABELS) {
    const d = dist(p, l.at);
    if (d < bestD) {
      bestD = d;
      best = l.label;
    }
  }
  return best;
}

/** Ramène le nombre de points d'un tracé à un niveau raisonnable. */
function simplify(points: Vec2[], minSegM = 6): Vec2[] {
  if (points.length <= 2) return points;
  const out: Vec2[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i += 1) {
    if (dist(out[out.length - 1]!, points[i]!) >= minSegM) out.push(points[i]!);
  }
  out.push(points[points.length - 1]!);
  return out;
}

export type RouteQuality = "on_network" | "partial_direct";

export type DetailedRoute = PedestrianRoute & {
  quality: RouteQuality;
  /** Longueur réellement mesurée sur le réseau, hors liaisons finales. */
  networkDistanceM: number;
};

export function computeRoute(fromId: string, toId: string): DetailedRoute | null {
  const from = BUILDING_BY_ID.get(fromId);
  const to = BUILDING_BY_ID.get(toId);
  if (!from || !to || from.id === to.id) return null;

  const startLink = nearestNode(from.position);
  const goalLink = nearestNode(to.position);

  let networkPoints: Vec2[] = [];
  let quality: RouteQuality = "partial_direct";

  if (startLink && goalLink && GRAPH.nodes.length > 1) {
    const ids = shortestPath(startLink.id, goalLink.id);
    if (ids) {
      networkPoints = ids.map((id) => ({
        x: GRAPH.nodes[id]!.x,
        z: GRAPH.nodes[id]!.z,
      }));
      quality = "on_network";
    }
  }

  // Liaisons finales : du bâtiment au premier nœud, puis du dernier nœud au bâtiment.
  const walkable =
    quality === "on_network" &&
    startLink !== null &&
    goalLink !== null &&
    startLink.d <= MAX_LINK_M &&
    goalLink.d <= MAX_LINK_M;

  const points: Vec2[] = walkable
    ? simplify([from.position, ...networkPoints, to.position])
    : [from.position, to.position];

  const distanceM = Math.round(
    points.reduce((sum, p, i) => (i === 0 ? 0 : sum + dist(points[i - 1]!, p)), 0),
  );
  const networkDistanceM = networkPoints.reduce(
    (sum, p, i) => (i === 0 ? 0 : sum + dist(networkPoints[i - 1]!, p)),
    0,
  );
  const durationMin = Math.max(1, Math.round(distanceM / WALK_SPEED_M_PER_MIN));

  const steps: RouteStep[] = [
    {
      instruction: `Partez de ${from.shortName} et rejoignez le cheminement`,
      distanceM: Math.round(dist(points[0]!, points[1] ?? points[0]!)),
      icon: "start",
    },
  ];

  for (let i = 1; i < points.length - 1; i += 1) {
    const icon = turnIcon(points[i - 1]!, points[i]!, points[i + 1]!);
    const seg = Math.round(dist(points[i]!, points[i + 1]!));
    const lm = landmarkNear(points[i]!);
    const verb =
      icon === "left"
        ? "Tournez à gauche"
        : icon === "right"
          ? "Tournez à droite"
          : "Continuez tout droit";
    steps.push({
      instruction: lm ? `${verb} en passant près de ${lm}` : verb,
      distanceM: seg,
      icon,
    });
  }

  steps.push({
    instruction:
      quality === "on_network"
        ? `Vous êtes arrivé à ${to.shortName}`
        : `Aucun cheminement OSM continu : trajet direct indicatif jusqu'à ${to.shortName}`,
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
    quality,
    networkDistanceM: Math.round(networkDistanceM),
  };
}

/** Petit utilitaire de diagnostic, affiché dans la fiche du bâtiment. */
export function networkStats() {
  const edgeCount = GRAPH.adj.reduce((sum, list) => sum + list.length, 0) / 2;
  return {
    nodes: GRAPH.nodes.length,
    edges: Math.round(edgeCount),
    footways: GEO_FOOTWAYS.length,
  };
}

/**
 * Position déterministe autour d'un bâtiment, pour le radar et les avatars 3D.
 * Ce n'est PAS une position GPS : c'est une répartition visuelle.
 */
export function occupancyPointFor(building: Building, seed: number): Vec2 {
  const angle = (seed * 2.399963) % (Math.PI * 2);
  const r = 0.22 + ((seed * 37) % 100) / 260;
  return {
    x: building.position.x + Math.cos(angle) * building.footprint.w * r,
    z: building.position.z + Math.sin(angle) * building.footprint.d * r,
  };
}

/** Bornes du référentiel réel (frontière OSM du campus). */
export const CAMPUS_BOUNDS = (() => {
  const xs = CAMPUS_BOUNDARY.ring.map((p) => p[0]);
  const zs = CAMPUS_BOUNDARY.ring.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
})();

export function campusCenter(): Vec2 {
  return {
    x: (GEO_BOUNDS.minX + GEO_BOUNDS.maxX) / 2,
    z: (GEO_BOUNDS.minZ + GEO_BOUNDS.maxZ) / 2,
  };
}
