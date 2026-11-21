/**
 * Service de navigation — apps/server/src/modules/navigation/navigation.service.ts
 *
 * Le graphe est construit à la demande depuis `walkways` (PostGIS) et mis en
 * cache. On n'invente aucune géométrie : si une allée manque en base, l'itinéraire
 * sera simplement plus long — jamais faux.
 *
 * L'avertissement `disclaimer` est renvoyé à chaque réponse : le graphe n'a pas
 * été validé géographiquement, et le produit doit le dire.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@uac/database";
import { buildings, walkways } from "@uac/database";
import {
  aStar,
  bearingDegrees,
  dijkstra,
  haversineMeters,
  routeBetweenPoints,
  snapToGraph,
  type GraphEdge,
  type PedestrianGraph,
} from "@uac/geospatial";
import { NotFoundError, DATA_SOURCES } from "@uac/shared";
import type { RouteRequest, RouteResponse, RouteStep } from "@uac/contracts";

/**
 * Avertissement attaché à CHAQUE itinéraire et à CHAQUE réponse de graphe.
 *
 * Il doit décrire l'état réel des données, pas un état antérieur du produit :
 *  - les données géospatiales existent (bâtiments et allées relevés dans
 *    PostGIS, graphe construit depuis les allées réelles) : on le dit ;
 *  - les itinéraires n'ont PAS encore été validés sur le terrain (aucun
 *    relevé GPS contradictoire, aucune vérification physique des allées) : on
 *    le dit aussi, et on qualifie donc le résultat d'INDICATIF.
 *
 * La version précédente annonçait un « graphe de démonstration » sans
 * géométrie relevée, ce qui n'était plus exact et sous-estimait la qualité des
 * données tout en restant vague sur la limite réelle (la validation terrain).
 */
const DISCLAIMER =
  "Itinéraire indicatif. Les données géospatiales du campus (bâtiments, allées " +
  "piétonnes) sont disponibles et géoréférencées dans la base PostGIS, et le " +
  "graphe de navigation est construit à partir de ces allées réelles. La " +
  "correspondance entre ce graphe et le terrain n'a toutefois pas encore été " +
  "validée par relevé : considérez les distances et les tracés comme " +
  "INDICATIFS tant que cette validation n'est pas établie.";

interface CacheEntry {
  graph: PedestrianGraph;
  builtAt: number;
  walkwayCount: number;
}

export class NavigationService {
  private cache: CacheEntry | null = null;
  private readonly cacheTtlMs = 60_000;

  constructor(private readonly db: Database) {}

  /** Construit le graphe piéton depuis PostGIS (avec cache 60 s). */
  async getGraph(forceRefresh = false): Promise<PedestrianGraph> {
    if (!forceRefresh && this.cache && Date.now() - this.cache.builtAt < this.cacheTtlMs) {
      return this.cache.graph;
    }

    const { createEmptyGraph, addNode, addEdge } = await import("@uac/geospatial");
    const graph = createEmptyGraph();

    // 1. Nœuds : points d'entrée des bâtiments + extrémités des allées.
    const buildingRows = await this.db
      .select({
        code: buildings.code,
        name: buildings.name,
        lat: sql<number>`ST_Y(${buildings.entrance}::geometry)`,
        lng: sql<number>`ST_X(${buildings.entrance}::geometry)`,
        accessible: buildings.isAccessible,
      })
      .from(buildings)
      .where(and(sql`${buildings.entrance} IS NOT NULL`, sql`${buildings.deletedAt} IS NULL`));

    for (const row of buildingRows) {
      addNode(graph, {
        id: row.code,
        type: "ENTRANCE",
        lat: Number(row.lat),
        lng: Number(row.lng),
        label: row.name,
        accessible: row.accessible,
      });
    }

    // 2. Arêtes réelles depuis `walkways`.
    const walkwayRows = await this.db
      .select({
        code: walkways.code,
        fromNodeId: walkways.fromNodeId,
        toNodeId: walkways.toNodeId,
        distanceMeters: walkways.distanceMeters,
        isAccessible: walkways.isAccessible,
        restrictions: walkways.restrictions,
        surface: walkways.surface,
      })
      .from(walkways);

    let added = 0;
    for (const row of walkwayRows) {
      if (!row.fromNodeId || !row.toNodeId) continue;
      if (!graph.nodes.has(row.fromNodeId) || !graph.nodes.has(row.toNodeId)) continue;

      const restrictions = row.restrictions
        ? (row.restrictions.split(",").map((r) => r.trim()).filter(Boolean) as GraphEdge["restrictions"])
        : undefined;

      const edge: GraphEdge = {
        id: row.code,
        source: row.fromNodeId,
        target: row.toNodeId,
        distanceMeters: Number(row.distanceMeters),
        accessible: row.isAccessible,
        restrictions,
        surface: row.surface as GraphEdge["surface"],
      };
      addEdge(graph, edge);
      added++;
    }

    this.cache = { graph, builtAt: Date.now(), walkwayCount: added };
    return graph;
  }

  /** Calcule un itinéraire complet entre deux coordonnées. */
  async route(request: RouteRequest): Promise<RouteResponse> {
    const graph = await this.getGraph();

    const result = routeBetweenPoints(graph, request.from, request.to, {
      accessibleOnly: request.accessibleOnly,
      algorithm: request.algorithm,
      nonAccessiblePenalty: 1.6,
    });

    const steps = this.buildSteps(graph, result.coordinates, result.nodeIds);

    return {
      found: result.found,
      distanceMeters: Math.round(result.distanceMeters),
      estimatedMinutes: result.estimatedMinutes,
      straightLineMeters: Math.round(result.straightLineMeters),
      usesNonAccessible: result.usesNonAccessible,
      polyline: result.coordinates,
      steps,
      disclaimer: DISCLAIMER,
    };
  }

  /** Métadonnées du graphe, pour transparence côté client. */
  /**
   * Graphe COMPLET, nœuds et arêtes inclus.
   *
   * `graphMetadata()` ne renvoie que des compteurs : suffisant pour un tableau
   * de bord, inutilisable pour naviguer. Le client a besoin du graphe entier
   * pour (a) calculer un itinéraire sans rappeler le serveur et (b) le
   * conserver hors ligne (ADR-007). Cette méthode est la seule source.
   */
  async fullGraph(): Promise<{
    nodes: Array<{
      id: string;
      type: string;
      lat: number;
      lng: number;
      label: string | null;
      accessible: boolean;
    }>;
    edges: Array<{
      id: string;
      source: string;
      target: string;
      distanceMeters: number;
      accessible: boolean;
      restrictions: string[] | null;
      surface: string | null;
    }>;
    metadata: {
      nodeCount: number;
      edgeCount: number;
      accessibleEdgeCount: number;
      isValidated: boolean;
      disclaimer: string;
      /** Version du graphe : le client invalide son cache hors ligne si elle change. */
      version: string;
    };
  }> {
    const graph = await this.getGraph();

    const nodes = [...graph.nodes.values()].map((node) => ({
      id: node.id,
      type: String(node.type),
      lat: Number(node.lat),
      lng: Number(node.lng),
      label: node.label ?? null,
      accessible: node.accessible ?? true,
    }));

    const edges = graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      distanceMeters: Number(edge.distanceMeters),
      accessible: edge.accessible,
      restrictions: edge.restrictions ? edge.restrictions.map(String) : null,
      surface: edge.surface ?? null,
    }));

    return {
      nodes,
      edges,
      metadata: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        accessibleEdgeCount: edges.filter((e) => e.accessible).length,
        isValidated: false,
        disclaimer: DISCLAIMER,
        // Empreinte stable : si le graphe change en base, le cache client est
        // périmé et doit être retéléchargé. Sans cela, un étudiant naviguerait
        // indéfiniment sur un graphe obsolète.
        version: fingerprint(nodes, edges),
      },
    };
  }

  async graphMetadata(): Promise<{
    nodeCount: number;
    edgeCount: number;
    accessibleEdgeCount: number;
    isValidated: boolean;
    disclaimer: string;
    version: string;
  }> {
    const graph = await this.getGraph();
    const accessibleEdges = graph.edges.filter((e) => e.accessible).length;
    return {
      nodeCount: graph.nodes.size,
      edgeCount: graph.edges.length,
      accessibleEdgeCount: accessibleEdges,
      isValidated: false,
      disclaimer: DISCLAIMER,
      version: fingerprint(
        [...graph.nodes.values()].map((n) => ({ id: n.id, lat: n.lat, lng: n.lng })),
        graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      ),
    };
  }

  /** Accroche une position au nœud du graphe le plus proche. */
  async snap(lat: number, lng: number): Promise<{ nodeId: string; distanceMeters: number; isFar: boolean }> {
    const graph = await this.getGraph();
    const result = snapToGraph(graph, { lat, lng });
    if (!result) throw new NotFoundError("Graphe piéton", "Aucun nœud de navigation disponible.");
    return result;
  }

  /** Destinations possibles (bâtiments avec point d'entrée). */
  async destinations(): Promise<Array<{ id: string; label: string; lat: number; lng: number }>> {
    const graph = await this.getGraph();
    const output: Array<{ id: string; label: string; lat: number; lng: number }> = [];
    for (const node of graph.nodes.values()) {
      if (node.type === "ENTRANCE") {
        output.push({ id: node.id, label: node.label ?? node.id, lat: node.lat, lng: node.lng });
      }
    }
    return output.sort((a, b) => a.label.localeCompare(b.label));
  }

  /** Comparaison Dijkstra/A* — utile pour un test de parité et pour mesurer. */
  async compareAlgorithms(
    fromId: string,
    toId: string,
  ): Promise<{ dijkstra: number; astar: number; sameCost: boolean; exploredD: number; exploredA: number }> {
    const graph = await this.getGraph();
    const d = dijkstra(graph, fromId, toId);
    const a = aStar(graph, fromId, toId);
    return {
      dijkstra: d.distanceMeters,
      astar: a.distanceMeters,
      sameCost: Math.abs(d.distanceMeters - a.distanceMeters) < 0.01,
      exploredD: d.exploredNodes,
      exploredA: a.exploredNodes,
    };
  }

  /**
   * Construit les étapes lisibles à partir de la polyligne.
   * Chaque étape porte un cap (bearing) et un point de repère quand disponible.
   */
  private buildSteps(
    graph: PedestrianGraph,
    coordinates: Array<{ lat: number; lng: number }>,
    nodeIds: string[],
  ): RouteStep[] {
    if (coordinates.length < 2) return [];

    const steps: RouteStep[] = [];
    for (let i = 1; i < coordinates.length; i++) {
      const previous = coordinates[i - 1]!;
      const current = coordinates[i]!;
      const distance = haversineMeters(previous, current);
      if (distance < 1) continue;

      const bearing = bearingDegrees(previous, current);
      const nodeId = nodeIds[i];
      const node = nodeId ? graph.nodes.get(nodeId) : undefined;

      steps.push({
        index: steps.length,
        instruction: this.buildInstruction(bearing, node?.label ?? null),
        distanceMeters: Math.round(distance),
        bearingDegrees: Math.round(bearing),
        coordinate: current,
        landmark: node?.label ?? null,
      });
    }
    return steps;
  }

  private buildInstruction(bearing: number, landmark: string | null): string {
    const direction =
      bearing < 22.5 || bearing >= 337.5
        ? "Continuez vers le nord"
        : bearing < 67.5
          ? "Prenez vers le nord-est"
          : bearing < 112.5
            ? "Prenez vers l'est"
            : bearing < 157.5
              ? "Prenez vers le sud-est"
              : bearing < 202.5
                ? "Continuez vers le sud"
                : bearing < 247.5
                  ? "Prenez vers le sud-ouest"
                  : bearing < 292.5
                    ? "Prenez vers l'ouest"
                    : "Prenez vers le nord-ouest";

    return landmark ? `${direction} en direction de ${landmark}` : direction;
  }
}

export { DATA_SOURCES };

/**
 * Empreinte déterministe du graphe (FNV-1a 32 bits).
 *
 * But : donner au client une chaîne courte et stable qui change dès que la
 * topologie change. Elle sert d'identifiant de version du cache hors ligne —
 * pas de rôle cryptographique, donc pas besoin d'une dépendance de hachage.
 */
function fingerprint(
  nodes: Array<{ id: string; lat?: number | string; lng?: number | string }>,
  edges: Array<{ id: string; source: string; target: string }>,
): string {
  const canonical = [
    ...nodes
      .map((n) => `n:${n.id}`)
      .sort(),
    ...edges
      .map((e) => `e:${e.id}:${e.source}>${e.target}`)
      .sort(),
  ].join("|");

  let hash = 2166136261;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
