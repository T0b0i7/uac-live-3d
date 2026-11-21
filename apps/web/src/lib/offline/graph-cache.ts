/**
 * Cache hors-ligne du graphe piéton — apps/web/src/lib/offline/graph-cache.ts
 *
 * Objectif terrain : un étudiant doit pouvoir calculer un itinéraire dans une
 * zone sans réseau. On télécharge donc le graphe une fois, on le persiste dans
 * IndexedDB, et on calcule localement avec les MÊMES algorithmes que le serveur
 * (`@uac/geospatial`) — ce qui garantit qu'un itinéraire hors-ligne et le même
 * itinéraire en ligne donnent le même résultat.
 *
 * Pourquoi IndexedDB et pas localStorage : le graphe sérialisé dépasse vite le
 * quota de localStorage (5 Mo) dès que le campus grandit, et localStorage est
 * synchrone (il bloque le rendu de la carte). IndexedDB est asynchrone et
 * dispose d'un quota bien supérieur.
 *
 * Clé de fraîcheur : `version` (empreinte calculée côté serveur). Un graphe
 * dont la version ne correspond plus est INUTILISABLE, pas « approximatif » :
 * naviguer sur un graphe obsolète enverrait l'utilisateur dans un mur.
 */

import {
  addEdge,
  addNode,
  createEmptyGraph,
  dijkstra,
  aStar,
  routeBetweenPoints,
  validateGraph,
  type EdgeRestriction,
  type GraphEdge,
  type GraphNode,
  type NodeType,
  type PathOptions,
  type PathResult,
  type PedestrianGraph,
} from "@uac/geospatial";
import type { GraphEdgeDto, GraphNodeDto, PedestrianGraphDto } from "@/lib/api/endpoints";

const DB_NAME = "uac-live-3d";
const DB_VERSION = 1;
const STORE = "pedestrian-graph";
const RECORD_KEY = "current";

export interface CachedGraphRecord {
  version: string;
  savedAt: number;
  nodeCount: number;
  edgeCount: number;
  graph: PedestrianGraphDto;
}

// ---------------------------------------------------------------------------
// IndexedDB minimal (aucune dépendance supplémentaire)
// ---------------------------------------------------------------------------

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB indisponible dans cet environnement."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Ouverture IndexedDB impossible."));
  });
}

/** Enregistre le graphe téléchargé. `version` est la fraîcheur. */
export async function saveGraphToCache(payload: PedestrianGraphDto): Promise<void> {
  const db = await openDatabase();
  const record: CachedGraphRecord = {
    version: payload.version,
    savedAt: Date.now(),
    nodeCount: payload.nodes.length,
    edgeCount: payload.edges.length,
    graph: payload,
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record, RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Écriture du cache impossible."));
  });

  db.close();
}

/**
 * Vrai si l'objet stocké a bien la forme d'un `CachedGraphRecord` exploitable.
 *
 * Un enregistrement corrompu (écriture interrompue, schéma d'une ancienne
 * version, quota dépassé, manipulation manuelle) ne doit pas être renvoyé au
 * code appelant : celui-ci le croirait valide puis planterait au premier accès
 * à `graph.nodes`. On le traite donc comme absent → retéléchargement.
 */
function isUsableRecord(value: unknown): value is CachedGraphRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<CachedGraphRecord>;
  if (typeof record.version !== "string" || record.version.length === 0) return false;
  if (typeof record.savedAt !== "number" || !Number.isFinite(record.savedAt)) return false;
  const graph = record.graph;
  if (typeof graph !== "object" || graph === null) return false;
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return false;
  // Un graphe sans aucun nœud n'est pas un graphe : c'est un cache inutile.
  if (graph.nodes.length === 0) return false;
  return graph.nodes.every(
    (node) =>
      typeof node === "object" &&
      node !== null &&
      typeof node.id === "string" &&
      typeof node.lat === "number" &&
      typeof node.lng === "number",
  );
}

/** Lit le cache. Renvoie `null` si rien n'est stocké ou si l'enregistrement est inutilisable. */
export async function readGraphFromCache(): Promise<CachedGraphRecord | null> {
  try {
    const db = await openDatabase();
    const record = await new Promise<CachedGraphRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(RECORD_KEY);
      request.onsuccess = () => resolve((request.result as CachedGraphRecord | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Lecture du cache impossible."));
    });
    db.close();
    return isUsableRecord(record) ? record : null;
  } catch {
    // Un cache illisible ne doit jamais empêcher l'application de démarrer.
    return null;
  }
}

/**
 * Lit le cache en n'acceptant QUE la version attendue.
 *
 * Si le serveur annonce une version différente, le cache local est périmé et
 * renvoyé comme absent — c'est ce qui force un retéléchargement.
 */
export async function readGraphFromCacheIfVersion(expectedVersion: string): Promise<CachedGraphRecord | null> {
  const record = await readGraphFromCache();
  if (!record) return null;
  if (record.version !== expectedVersion) return null;
  return record;
}

export async function clearGraphCache(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Suppression du cache impossible."));
    });
    db.close();
  } catch {
    // Sans conséquence : le prochain enregistrement écrasera l'ancien.
  }
}

/** Vrai si le stockage persistant est accordé (sinon le navigateur peut purger). */
export async function isPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persisted) return false;
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// DTO serveur → graphe exploitable
// ---------------------------------------------------------------------------

const NODE_TYPES: readonly NodeType[] = ["WAYPOINT", "ENTRANCE", "POI", "JUNCTION"];
const RESTRICTIONS: readonly EdgeRestriction[] = ["STAIRS", "PRIVATE", "CLOSED", "UNPAVED", "STEEP"];
const SURFACES = ["PAVED", "GRAVEL", "DIRT", "UNKNOWN"] as const;

function asNodeType(value: string): NodeType {
  return (NODE_TYPES as readonly string[]).includes(value) ? (value as NodeType) : "WAYPOINT";
}

function asRestrictions(value: string[] | null): EdgeRestriction[] | undefined {
  if (!value || value.length === 0) return undefined;
  const kept = value.filter((r): r is EdgeRestriction => (RESTRICTIONS as readonly string[]).includes(r));
  return kept.length > 0 ? kept : undefined;
}

function asSurface(value: string | null): GraphEdge["surface"] {
  if (!value) return undefined;
  return (SURFACES as readonly string[]).includes(value)
    ? (value as (typeof SURFACES)[number])
    : undefined;
}

/**
 * Convertit le payload de l'API en structure de graphe du package partagé.
 *
 * Une arête référençant un nœud absent est ignorée : l'inclure créerait une
 * arête fantôme qui fausserait le calcul de distance sans qu'on puisse le voir.
 */
export function dtoToPedestrianGraph(payload: PedestrianGraphDto): {
  graph: PedestrianGraph;
  skippedEdges: number;
} {
  const graph = createEmptyGraph();

  for (const node of payload.nodes) {
    const graphNode: GraphNode = {
      id: node.id,
      type: asNodeType(node.type),
      lat: node.lat,
      lng: node.lng,
      ...(node.label !== null ? { label: node.label } : {}),
      accessible: node.accessible,
    };
    addNode(graph, graphNode);
  }

  let skippedEdges = 0;
  for (const edge of payload.edges) {
    const restrictions = asRestrictions(edge.restrictions);
    const surface = asSurface(edge.surface);
    const graphEdge: GraphEdge = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      distanceMeters: edge.distanceMeters,
      accessible: edge.accessible,
      ...(restrictions ? { restrictions } : {}),
      ...(surface ? { surface } : {}),
    };

    if (!graph.nodes.has(edge.source) || !graph.nodes.has(edge.target)) {
      skippedEdges++;
      continue;
    }

    try {
      addEdge(graph, graphEdge);
    } catch {
      skippedEdges++;
    }
  }

  return { graph, skippedEdges };
}

// ---------------------------------------------------------------------------
// Calcul d'itinéraire local
// ---------------------------------------------------------------------------

export interface LocalRouteResult {
  found: boolean;
  coordinates: Array<{ lat: number; lng: number }>;
  nodeIds: string[];
  distanceMeters: number;
  estimatedMinutes: number;
  /** Distance à vol d'oiseau entre les deux extrémités (repère de sanity check). */
  straightLineMeters: number;
  usesNonAccessible: boolean;
  exploredNodes: number;
  /** Nœuds du graphe effectivement utilisés comme départ/arrivée. */
  snapStartId: string | null;
  snapEndId: string | null;
  /** Vrai si le départ ou l'arrivée est loin du réseau piéton. */
  isFarFromGraph: boolean;
}

function toLocalRoute(
  result: PathResult,
  snapStart: { nodeId: string; isFar: boolean } | null,
  snapEnd: { nodeId: string; isFar: boolean } | null,
): LocalRouteResult {
  return {
    found: result.found,
    coordinates: result.coordinates,
    nodeIds: result.nodeIds,
    distanceMeters: result.distanceMeters,
    estimatedMinutes: result.estimatedMinutes,
    straightLineMeters: result.straightLineMeters,
    usesNonAccessible: result.usesNonAccessible,
    exploredNodes: result.exploredNodes,
    snapStartId: snapStart?.nodeId ?? null,
    snapEndId: snapEnd?.nodeId ?? null,
    isFarFromGraph: Boolean(snapStart?.isFar || snapEnd?.isFar),
  };
}

/**
 * Itinéraire calculé LOCALEMENT, sans réseau.
 *
 * `routeBetweenPoints` accroche automatiquement les coordonnées libres au nœud
 * le plus proche, puis applique l'algorithme demandé. C'est exactement le
 * chemin de code utilisé par le serveur : les résultats sont donc comparables.
 */
export function computeLocalRoute(
  graph: PedestrianGraph,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  options: PathOptions & { algorithm?: "dijkstra" | "astar" } = {},
): LocalRouteResult {
  const result = routeBetweenPoints(graph, from, to, {
    algorithm: options.algorithm ?? "astar",
    ...(options.accessibleOnly !== undefined ? { accessibleOnly: options.accessibleOnly } : {}),
    ...(options.nonAccessiblePenalty !== undefined
      ? { nonAccessiblePenalty: options.nonAccessiblePenalty }
      : {}),
    ...(options.blockedEdgeIds ? { blockedEdgeIds: options.blockedEdgeIds } : {}),
  });

  return toLocalRoute(result, result.snapStart, result.snapEnd);
}

/**
 * Itinéraire entre deux NŒUDS identifiés (pas deux coordonnées).
 *
 * Utile pour naviguer entrée → bâtiment, où les deux extrémités sont déjà des
 * nœuds du graphe : on évite ainsi tout accrochement approximatif.
 */
export function computeRouteBetweenNodes(
  graph: PedestrianGraph,
  startId: string,
  endId: string,
  options: PathOptions & { algorithm?: "dijkstra" | "astar" } = {},
): LocalRouteResult {
  const algorithm = options.algorithm === "dijkstra" ? dijkstra : aStar;
  const result = algorithm(graph, startId, endId, options);
  return toLocalRoute(result, null, null);
}

/** Vérifie l'intégrité du graphe téléchargé avant de s'en servir. */
export function inspectGraph(graph: PedestrianGraph): { valid: boolean; problems: string[] } {
  return validateGraph(graph);
}

export type { PedestrianGraph, PathOptions, PathResult, GraphNodeDto, GraphEdgeDto };
