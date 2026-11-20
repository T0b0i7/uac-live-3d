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

const DISCLAIMER =
  "Itinéraire indicatif calculé sur un graphe piéton de démonstration. " +
  "La géométrie du campus n'a pas été relevée sur le terrain : ne vous fiez pas " +
  "à cet itinéraire pour un déplacement urgent.";

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
  async graphMetadata(): Promise<{
    nodeCount: number;
    edgeCount: number;
    accessibleEdgeCount: number;
    isValidated: boolean;
    disclaimer: string;
  }> {
    const graph = await this.getGraph();
    const accessibleEdges = graph.edges.filter((e) => e.accessible).length;
    return {
      nodeCount: graph.nodes.size,
      edgeCount: graph.edges.length,
      accessibleEdgeCount: accessibleEdges,
      isValidated: false,
      disclaimer: DISCLAIMER,
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
