/**
 * Graphe piéton et algorithmes de plus court chemin — @uac/geospatial
 *
 * Le graphe est un multigraphe non orienté pondéré, non négatif. Les arêtes
 * portent des métadonnées d'accessibilité (PMR, escaliers, zones interdites).
 *
 * Deux algorithmes implémentés :
 *  - Dijkstra : plus court chemin exact, explore uniformément.
 *  - A*       : plus court chemin exact avec heuristique Haversine (admissible ET
 *               consistante car la distance à vol d'oiseau minore toujours la
 *               distance réelle le long des allées). Résultat identique à Dijkstra,
 *               mais bien moins de nœuds explorés sur un grand graphe.
 *
 * Aucun des deux ne suppose un graphe connexe : si aucun chemin n'existe,
 * on renvoie un résultat explicite (`found: false`) plutôt que de lever.
 */

import { haversineMeters, type LonLat } from "./geo.js";
import { NAVIGATION } from "@uac/shared";

export type NodeType = "WAYPOINT" | "ENTRANCE" | "POI" | "JUNCTION";

export interface GraphNode extends LonLat {
  id: string;
  type: NodeType;
  label?: string;
  /** Nœud accessible en fauteuil roulant. */
  accessible?: boolean;
}

export type EdgeRestriction = "STAIRS" | "PRIVATE" | "CLOSED" | "UNPAVED" | "STEEP";

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** Longueur réelle de l'allée en mètres. Jamais recalculée depuis les coordonnées. */
  distanceMeters: number;
  accessible: boolean;
  restrictions?: EdgeRestriction[];
  /** Revêtement / confort, informatif. */
  surface?: "PAVED" | "GRAVEL" | "DIRT" | "UNKNOWN";
}

export interface PedestrianGraph {
  nodes: Map<string, GraphNode>;
  /** Liste d'adjacence : nodeId → arêtes sortantes (dans les deux sens). */
  adjacency: Map<string, GraphEdge[]>;
  edges: GraphEdge[];
}

export interface PathOptions {
  /** N'emprunte que les arêtes accessibles PMR. */
  accessibleOnly?: boolean;
  /**
   * Pénalité multiplicative appliquée aux arêtes non accessibles quand
   * `accessibleOnly` est faux. Évite un détour absurde pour gagner 2 mètres,
   * tout en préférant l'itinéraire accessible quand il est raisonnable.
   */
  nonAccessiblePenalty?: number;
  /** Arêtes à interdire explicitement (ex. allée fermée pour travaux). */
  blockedEdgeIds?: readonly string[];
}

export interface PathResult {
  found: boolean;
  nodeIds: string[];
  coordinates: LonLat[];
  /** Distance cumulée le long du graphe, en mètres. */
  distanceMeters: number;
  /** Distance à vol d'oiseau départ→arrivée, en mètres. */
  straightLineMeters: number;
  /** Estimation de marche en minutes. */
  estimatedMinutes: number;
  /** Vrai si au moins une arête non accessible a été empruntée. */
  usesNonAccessible: boolean;
  /** Nombre de nœuds effectivement explorés (indicateur de performance). */
  exploredNodes: number;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function createEmptyGraph(): PedestrianGraph {
  return { nodes: new Map(), adjacency: new Map(), edges: [] };
}

export function addNode(graph: PedestrianGraph, node: GraphNode): void {
  graph.nodes.set(node.id, node);
  if (!graph.adjacency.has(node.id)) graph.adjacency.set(node.id, []);
}

/**
 * Ajoute une arête non orientée. L'arête est enregistrée dans les deux listes
 * d'adjacence : le graphe physique est bidirectionnel même si l'allée est
 * décrite une seule fois dans la donnée source.
 */
export function addEdge(graph: PedestrianGraph, edge: GraphEdge): void {
  if (!graph.nodes.has(edge.source)) {
    throw new Error(`addEdge: nœud de départ inconnu "${edge.source}"`);
  }
  if (!graph.nodes.has(edge.target)) {
    throw new Error(`addEdge: nœud d'arrivée inconnu "${edge.target}"`);
  }
  if (edge.distanceMeters < 0) {
    throw new Error(`addEdge: distance négative sur l'arête "${edge.id}"`);
  }
  graph.edges.push(edge);
  graph.adjacency.get(edge.source)!.push(edge);
  graph.adjacency.get(edge.target)!.push(edge);
}

/** Ajoute une arête en calculant sa longueur par Haversine. */
export function connectNodes(
  graph: PedestrianGraph,
  source: string,
  target: string,
  options: Omit<GraphEdge, "source" | "target" | "distanceMeters" | "id"> & { id?: string } = {
    accessible: true,
  },
): GraphEdge {
  const a = graph.nodes.get(source);
  const b = graph.nodes.get(target);
  if (!a || !b) throw new Error(`connectNodes: nœud manquant ${source} → ${target}`);
  const edge: GraphEdge = {
    id: options.id ?? `${source}--${target}`,
    source,
    target,
    distanceMeters: haversineMeters(a, b),
    accessible: options.accessible,
    restrictions: options.restrictions,
    surface: options.surface,
  };
  addEdge(graph, edge);
  return edge;
}

// ---------------------------------------------------------------------------
// Accès
// ---------------------------------------------------------------------------

export function edgeCost(edge: GraphEdge, options: PathOptions = {}): number {
  if (options.nonAccessiblePenalty && !edge.accessible) {
    return edge.distanceMeters * options.nonAccessiblePenalty;
  }
  return edge.distanceMeters;
}

function isEdgeUsable(edge: GraphEdge, options: PathOptions): boolean {
  if (options.blockedEdgeIds?.includes(edge.id)) return false;
  if (options.accessibleOnly && !edge.accessible) return false;
  if (edge.restrictions?.includes("CLOSED")) return false;
  if (edge.restrictions?.includes("PRIVATE")) return false;
  if (options.accessibleOnly && edge.restrictions?.includes("STAIRS")) return false;
  return true;
}

function neighbourOf(edge: GraphEdge, nodeId: string): string {
  return edge.source === nodeId ? edge.target : edge.source;
}

// ---------------------------------------------------------------------------
// File de priorité (tas binaire min)
// ---------------------------------------------------------------------------

/**
 * Tas binaire min minimaliste. Une implémentation naïve par tri à chaque
 * itération serait O(V² log V) ; ici on obtient O((V+E) log V), ce qui compte
 * sur un graphe de plusieurs centaines de nœuds.
 */
class MinHeap<T> {
  private readonly items: Array<{ key: number; value: T }> = [];

  get size(): number {
    return this.items.length;
  }

  push(key: number, value: T): void {
    this.items.push({ key, value });
    this.bubbleUp(this.items.length - 1);
  }

  pop(): { key: number; value: T } | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0]!;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(index: number): void {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent]!.key <= this.items[i]!.key) break;
      [this.items[parent], this.items[i]] = [this.items[i]!, this.items[parent]!];
      i = parent;
    }
  }

  private bubbleDown(index: number): void {
    let i = index;
    const n = this.items.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && this.items[left]!.key < this.items[smallest]!.key) smallest = left;
      if (right < n && this.items[right]!.key < this.items[smallest]!.key) smallest = right;
      if (smallest === i) break;
      [this.items[smallest], this.items[i]] = [this.items[i]!, this.items[smallest]!];
      i = smallest;
    }
  }
}

// ---------------------------------------------------------------------------
// Reconstruction du chemin
// ---------------------------------------------------------------------------

function reconstruct(
  graph: PedestrianGraph,
  cameFrom: Map<string, string>,
  startId: string,
  endId: string,
  totalDistance: number,
  exploredNodes: number,
  usesNonAccessible: boolean,
): PathResult {
  const nodeIds: string[] = [];
  let cursor: string | undefined = endId;
  const guard = graph.nodes.size + 2;
  let steps = 0;
  while (cursor !== undefined && steps++ < guard) {
    nodeIds.push(cursor);
    if (cursor === startId) break;
    cursor = cameFrom.get(cursor);
  }
  nodeIds.reverse();

  const coordinates: LonLat[] = [];
  let straightLine = 0;
  const first = nodeIds[0];
  const last = nodeIds[nodeIds.length - 1];
  for (const id of nodeIds) {
    const node = graph.nodes.get(id);
    if (node) coordinates.push({ lat: node.lat, lng: node.lng });
  }
  if (first && last) {
    const a = graph.nodes.get(first);
    const b = graph.nodes.get(last);
    if (a && b) straightLine = haversineMeters(a, b);
  }

  return {
    found: true,
    nodeIds,
    coordinates,
    distanceMeters: totalDistance,
    straightLineMeters: straightLine,
    estimatedMinutes: Math.max(1, Math.round(totalDistance / NAVIGATION.WALK_SPEED_M_PER_MIN)),
    usesNonAccessible,
    exploredNodes,
  };
}

function notFound(graph: PedestrianGraph, startId: string, endId: string): PathResult {
  const a = graph.nodes.get(startId);
  const b = graph.nodes.get(endId);
  return {
    found: false,
    nodeIds: [],
    coordinates: [],
    distanceMeters: 0,
    straightLineMeters: a && b ? haversineMeters(a, b) : 0,
    estimatedMinutes: 0,
    usesNonAccessible: false,
    exploredNodes: 0,
  };
}

// ---------------------------------------------------------------------------
// Dijkstra
// ---------------------------------------------------------------------------

/**
 * Plus court chemin exact. Complexité O((V + E) log V).
 * Utilisé comme référence de vérité dans les tests comparatifs avec A*.
 */
export function dijkstra(graph: PedestrianGraph, startId: string, endId: string, options: PathOptions = {}): PathResult {
  if (!graph.nodes.has(startId) || !graph.nodes.has(endId)) return notFound(graph, startId, endId);
  if (startId === endId) {
    const node = graph.nodes.get(startId)!;
    return {
      found: true,
      nodeIds: [startId],
      coordinates: [{ lat: node.lat, lng: node.lng }],
      distanceMeters: 0,
      straightLineMeters: 0,
      estimatedMinutes: 0,
      usesNonAccessible: false,
      exploredNodes: 1,
    };
  }

  const dist = new Map<string, number>([[startId, 0]]);
  const cameFrom = new Map<string, string>();
  const visited = new Set<string>();
  const usesNonAccessible = new Map<string, boolean>([[startId, false]]);
  const heap = new MinHeap<string>();
  heap.push(0, startId);
  let explored = 0;

  while (heap.size > 0) {
    const current = heap.pop()!;
    const nodeId = current.value;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    explored++;

    if (nodeId === endId) {
      return reconstruct(
        graph,
        cameFrom,
        startId,
        endId,
        dist.get(endId) ?? 0,
        explored,
        usesNonAccessible.get(endId) ?? false,
      );
    }

    const currentDist = dist.get(nodeId) ?? Infinity;
    for (const edge of graph.adjacency.get(nodeId) ?? []) {
      if (!isEdgeUsable(edge, options)) continue;
      const next = neighbourOf(edge, nodeId);
      if (visited.has(next)) continue;
      const candidate = currentDist + edgeCost(edge, options);
      if (candidate < (dist.get(next) ?? Infinity)) {
        dist.set(next, candidate);
        cameFrom.set(next, nodeId);
        usesNonAccessible.set(
          next,
          (usesNonAccessible.get(nodeId) ?? false) || !edge.accessible,
        );
        heap.push(candidate, next);
      }
    }
  }

  return notFound(graph, startId, endId);
}

// ---------------------------------------------------------------------------
// A*
// ---------------------------------------------------------------------------

/**
 * A* avec heuristique Haversine vers la destination.
 *
 * L'heuristique est admissible (elle minore la distance réelle) et consistante,
 * donc A* renvoie EXACTEMENT le même coût que Dijkstra. Avec
 * `nonAccessiblePenalty > 1`, l'heuristique reste admissible car la pénalité
 * ne fait qu'augmenter les coûts réels.
 */
export function aStar(graph: PedestrianGraph, startId: string, endId: string, options: PathOptions = {}): PathResult {
  if (!graph.nodes.has(startId) || !graph.nodes.has(endId)) return notFound(graph, startId, endId);
  if (startId === endId) return dijkstra(graph, startId, endId, options);

  const goal = graph.nodes.get(endId)!;
  const heuristic = (nodeId: string): number => {
    const node = graph.nodes.get(nodeId);
    return node ? haversineMeters(node, goal) : 0;
  };

  const gScore = new Map<string, number>([[startId, 0]]);
  const cameFrom = new Map<string, string>();
  const closed = new Set<string>();
  const usesNonAccessible = new Map<string, boolean>([[startId, false]]);
  const heap = new MinHeap<string>();
  heap.push(heuristic(startId), startId);
  let explored = 0;

  while (heap.size > 0) {
    const current = heap.pop()!;
    const nodeId = current.value;
    if (closed.has(nodeId)) continue;
    closed.add(nodeId);
    explored++;

    if (nodeId === endId) {
      return reconstruct(
        graph,
        cameFrom,
        startId,
        endId,
        gScore.get(endId) ?? 0,
        explored,
        usesNonAccessible.get(endId) ?? false,
      );
    }

    const currentG = gScore.get(nodeId) ?? Infinity;
    for (const edge of graph.adjacency.get(nodeId) ?? []) {
      if (!isEdgeUsable(edge, options)) continue;
      const next = neighbourOf(edge, nodeId);
      if (closed.has(next)) continue;
      const tentative = currentG + edgeCost(edge, options);
      if (tentative < (gScore.get(next) ?? Infinity)) {
        gScore.set(next, tentative);
        cameFrom.set(next, nodeId);
        usesNonAccessible.set(next, (usesNonAccessible.get(nodeId) ?? false) || !edge.accessible);
        heap.push(tentative + heuristic(next), next);
      }
    }
  }

  return notFound(graph, startId, endId);
}

// ---------------------------------------------------------------------------
// Accroche spatiale (snapping)
// ---------------------------------------------------------------------------

export interface SnapResult {
  nodeId: string;
  distanceMeters: number;
  /** Vrai si le point est plus loin que `SNAP_MAX_DISTANCE_M`. */
  isFar: boolean;
}

/**
 * Trouve le nœud du graphe le plus proche d'un point libre.
 * Retourne `null` si le graphe est vide.
 *
 * Un point situé au-delà de `NAVIGATION.SNAP_MAX_DISTANCE_M` reste rattaché
 * (mieux vaut un itinéraire approximatif que rien), mais `isFar` permet à
 * l'appelant de prévenir l'utilisateur que sa position est hors campus.
 */
export function snapToGraph(graph: PedestrianGraph, point: LonLat): SnapResult | null {
  let best: SnapResult | null = null;
  for (const node of graph.nodes.values()) {
    const distance = haversineMeters(point, node);
    if (best === null || distance < best.distanceMeters) {
      best = { nodeId: node.id, distanceMeters: distance, isFar: false };
    }
  }
  if (best) best.isFar = best.distanceMeters > NAVIGATION.SNAP_MAX_DISTANCE_M;
  return best;
}

/** Variante orientée accessibilité : ignore les nœuds non accessibles. */
export function snapToGraphAccessible(graph: PedestrianGraph, point: LonLat): SnapResult | null {
  let best: SnapResult | null = null;
  for (const node of graph.nodes.values()) {
    if (node.accessible === false) continue;
    const distance = haversineMeters(point, node);
    if (best === null || distance < best.distanceMeters) {
      best = { nodeId: node.id, distanceMeters: distance, isFar: false };
    }
  }
  if (best) best.isFar = best.distanceMeters > NAVIGATION.SNAP_MAX_DISTANCE_M;
  return best;
}

/**
 * Itinéraire complet depuis deux coordonnées libres, avec accroche automatique.
 * C'est le point d'entrée utilisé par le service de navigation du serveur.
 */
export function routeBetweenPoints(
  graph: PedestrianGraph,
  from: LonLat,
  to: LonLat,
  options: PathOptions & { algorithm?: "dijkstra" | "astar" } = {},
): PathResult & { snapStart: SnapResult | null; snapEnd: SnapResult | null } {
  const snapStart = options.accessibleOnly
    ? snapToGraphAccessible(graph, from)
    : snapToGraph(graph, from);
  const snapEnd = options.accessibleOnly ? snapToGraphAccessible(graph, to) : snapToGraph(graph, to);

  if (!snapStart || !snapEnd) {
    return { ...notFound(graph, "", ""), snapStart, snapEnd };
  }

  const algorithm = options.algorithm === "dijkstra" ? dijkstra : aStar;
  const result = algorithm(graph, snapStart.nodeId, snapEnd.nodeId, options);
  return { ...result, snapStart, snapEnd };
}

// ---------------------------------------------------------------------------
// Indicateurs et validation
// ---------------------------------------------------------------------------

/** Vérifie l'intégrité du graphe : arêtes orphelines, nœuds isolés. */
export function validateGraph(graph: PedestrianGraph): { valid: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const edge of graph.edges) {
    if (!graph.nodes.has(edge.source)) problems.push(`arête ${edge.id}: source inconnue ${edge.source}`);
    if (!graph.nodes.has(edge.target)) problems.push(`arête ${edge.id}: cible inconnue ${edge.target}`);
    if (edge.distanceMeters <= 0 && edge.source !== edge.target) {
      problems.push(`arête ${edge.id}: distance nulle ou négative`);
    }
  }
  for (const nodeId of graph.nodes.keys()) {
    const list = graph.adjacency.get(nodeId) ?? [];
    if (list.length === 0) problems.push(`nœud isolé: ${nodeId}`);
  }
  return { valid: problems.length === 0, problems };
}

/** Composante connexe contenant `startId` — détecte les zones injoignables. */
export function reachableFrom(graph: PedestrianGraph, startId: string): Set<string> {
  const seen = new Set<string>();
  if (!graph.nodes.has(startId)) return seen;
  const stack = [startId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of graph.adjacency.get(id) ?? []) {
      const next = neighbourOf(edge, id);
      if (!seen.has(next)) stack.push(next);
    }
  }
  return seen;
}
