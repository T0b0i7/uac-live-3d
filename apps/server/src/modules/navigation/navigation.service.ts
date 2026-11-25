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

/** Vitesse de marche retenue pour l'estimation : 78 m/min (~4,7 km/h). */
const WALK_SPEED_M_PER_MIN = 78;

export class NavigationService {
  private cache: CacheEntry | null = null;
  private readonly cacheTtlMs = 60_000;

  /** Dernier bilan de construction, pour le diagnostic (non exposé au public). */
  private lastBuild: {
    nodesCreated: number;
    entrances: number;
    edges: number;
    skipped: number;
  } | null = null;

  constructor(private readonly db: Database) {}

  /** Bilan de la dernière construction du graphe. */
  buildReport() {
    return this.lastBuild;
  }

  /**
   * Construit le graphe piéton depuis PostGIS (avec cache 60 s).
   *
   * HISTORIQUE D'UN DÉFAUT CORRIGÉ
   * ------------------------------
   * Cette méthode produisait 355 nœuds et **0 arête**. Raison : les nœuds
   * étaient créés uniquement depuis `buildings.entrance`, avec pour identifiant
   * `buildings.code` (slug OSM tel que `ADMINISTRATION-FAST`), tandis que
   * `walkways.from_node_id` contenait des codes courts (`FAST-A`). Le test
   * `if (!graph.nodes.has(...)) continue` écartait donc les 21 allées, une par
   * une, sans erreur ni avertissement.
   *
   * La correction ne consiste PAS à faire correspondre des codes de bâtiments
   * (la table `building_code_mapping` existe mais ne couvre que 11 allées sur
   * 21 et ses écarts vont de 255 à 780 m : elle produirait des itinéraires
   * faux). Elle consiste à créer un nœud pour chaque extrémité réellement
   * référencée par une allée, en prenant sa position sur la géométrie de
   * l'allée elle-même. Aucune coordonnée n'est inventée : elle vient de
   * `walkways.path`.
   *
   * Les points d'entrée des bâtiments restent ajoutés comme nœuds
   * supplémentaires, mais ne portent plus le trafic des allées : ils servent de
   * cibles de `snapToGraph`.
   */
  async getGraph(forceRefresh = false): Promise<PedestrianGraph> {
    if (!forceRefresh && this.cache && Date.now() - this.cache.builtAt < this.cacheTtlMs) {
      return this.cache.graph;
    }

    const { createEmptyGraph, addNode, addEdge } = await import("@uac/geospatial");
    const graph = createEmptyGraph();

    // 1. Arêtes réelles depuis `walkways`, avec les coordonnées de leurs
    //    extrémités lues sur la géométrie. C'est la source de vérité du réseau.
    const walkwayRows = await this.db
      .select({
        code: walkways.code,
        fromNodeId: walkways.fromNodeId,
        toNodeId: walkways.toNodeId,
        distanceMeters: walkways.distanceMeters,
        isAccessible: walkways.isAccessible,
        restrictions: walkways.restrictions,
        surface: walkways.surface,
        // Extrémités effectives du tracé : premier et dernier sommet.
        fromLat: sql<number | null>`ST_Y(ST_StartPoint(${walkways.path}::geometry))`,
        fromLng: sql<number | null>`ST_X(ST_StartPoint(${walkways.path}::geometry))`,
        toLat: sql<number | null>`ST_Y(ST_EndPoint(${walkways.path}::geometry))`,
        toLng: sql<number | null>`ST_X(ST_EndPoint(${walkways.path}::geometry))`,
      })
      .from(walkways);

    // 2. Créer les nœuds manquants à partir des extrémités des allées.
    //    Un nœud « manquant » n'est plus une raison d'écarter l'arête : c'est
    //    une raison de le créer, puisque sa position est connue.
    let nodesCreated = 0;
    for (const row of walkwayRows) {
      if (!row.fromNodeId || !row.toNodeId) continue;

      if (!graph.nodes.has(row.fromNodeId) && row.fromLat !== null && row.fromLng !== null) {
        addNode(graph, {
          id: row.fromNodeId,
          type: "JUNCTION",
          lat: Number(row.fromLat),
          lng: Number(row.fromLng),
          accessible: true,
        });
        nodesCreated++;
      }

      if (!graph.nodes.has(row.toNodeId) && row.toLat !== null && row.toLng !== null) {
        addNode(graph, {
          id: row.toNodeId,
          type: "JUNCTION",
          lat: Number(row.toLat),
          lng: Number(row.toLng),
          accessible: true,
        });
        nodesCreated++;
      }
    }

    // 3. Points d'entrée des bâtiments : nœuds de destination supplémentaires.
    //    `DO NOTHING` implicite : un code déjà pris par un nœud de cheminement
    //    n'est pas écrasé (addNode écrase, donc on teste avant).
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

    let entrances = 0;
    for (const row of buildingRows) {
      if (graph.nodes.has(row.code)) continue;
      addNode(graph, {
        id: row.code,
        type: "ENTRANCE",
        lat: Number(row.lat),
        lng: Number(row.lng),
        label: row.name,
        accessible: row.accessible,
      });
      entrances++;
    }

    // 4. Ajouter les arêtes maintenant que leurs extrémités existent.
    let added = 0;
    let skipped = 0;
    for (const row of walkwayRows) {
      if (!row.fromNodeId || !row.toNodeId) continue;
      if (!graph.nodes.has(row.fromNodeId) || !graph.nodes.has(row.toNodeId)) {
        // Ne devrait plus arriver : on vient de créer les nœuds. Compté pour
        // que le diagnostic soit possible si un jour ça se reproduit.
        skipped++;
        continue;
      }

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

    if (skipped > 0 && typeof process !== "undefined") {
      // Un graphe incomplet doit être signalé dans les journaux serveur.
      console.warn(
        `[navigation] ${skipped} arête(s) ignorée(s) faute d'extrémité localisable.`,
      );
    }

    this.lastBuild = { nodesCreated, entrances, edges: added, skipped };
    this.cache = { graph, builtAt: Date.now(), walkwayCount: added };
    return graph;
  }

  /**
   * Calcule un itinéraire complet entre deux coordonnées.
   *
   * Si aucune connexion n'existe dans le graphe, on ne renvoie pas un simple
   * échec : le réseau OSM du campus est réel mais fragmenté (55 composantes
   * mesurées), donc deux points proches peuvent n'être reliés par aucun
   * cheminement cartographié. On renvoie alors un tracé direct en ligne droite,
   * explicitement étiqueté `partial_direct`, avec un avertissement qui dit que
   * ce n'est PAS un cheminement. Le client faisait déjà ce repli de son côté
   * (quality `partial_direct`) ; le serveur ne le faisait pas, d'où des
   * itinéraires « introuvables » pour des points distants de 300 m.
   *
   * Ce repli n'invente aucune route : il donne une distance à vol d'oiseau,
   * présentée comme telle. C'est une information honnête, pas un tracé fictif.
   */
  async route(request: RouteRequest): Promise<RouteResponse> {
    const graph = await this.getGraph();

    const result = routeBetweenPoints(graph, request.from, request.to, {
      accessibleOnly: request.accessibleOnly,
      algorithm: request.algorithm,
      nonAccessiblePenalty: 1.6,
    });

    if (result.found && result.coordinates.length >= 2) {
      const steps = this.buildSteps(graph, result.coordinates, result.nodeIds);
      return {
        found: true,
        quality: "on_network",
        distanceMeters: Math.round(result.distanceMeters),
        estimatedMinutes: result.estimatedMinutes,
        straightLineMeters: Math.round(result.straightLineMeters),
        usesNonAccessible: result.usesNonAccessible,
        polyline: result.coordinates,
        steps,
        disclaimer: DISCLAIMER,
      };
    }

    // --- Repli explicite : aucun chemin continu dans les données ------------
    const straight = haversineMeters(
      { lat: request.from.lat, lng: request.from.lng },
      { lat: request.to.lat, lng: request.to.lng },
    );

    // Un point isolé ou un point sur lui-même n'a pas de sens à annoncer.
    if (straight < 5) {
      return {
        found: false,
        quality: "not_found",
        distanceMeters: 0,
        estimatedMinutes: 0,
        straightLineMeters: Math.round(straight),
        usesNonAccessible: false,
        polyline: [],
        steps: [],
        disclaimer: DISCLAIMER,
      };
    }

    const minutes = Math.max(1, Math.round(straight / WALK_SPEED_M_PER_MIN));

    return {
      found: true,
      quality: "partial_direct",
      distanceMeters: Math.round(straight),
      estimatedMinutes: minutes,
      straightLineMeters: Math.round(straight),
      usesNonAccessible: false,
      polyline: [
        { lat: request.from.lat, lng: request.from.lng },
        { lat: request.to.lat, lng: request.to.lng },
      ],
      steps: [
        {
          index: 0,
          instruction:
            "Aucun cheminement continu n'est cartographié entre ces deux points. " +
            "Distance à vol d'oiseau indiquée : le trajet réel sur le terrain peut " +
            "être plus long et doit être confirmé sur place.",
          distanceMeters: Math.round(straight),
          bearingDegrees: Math.max(
            0,
            Math.min(
              360,
              Math.round(
                bearingDegrees(
                  { lat: request.from.lat, lng: request.from.lng },
                  { lat: request.to.lat, lng: request.to.lng },
                ),
              ),
            ),
          ),
          coordinate: { lat: request.from.lat, lng: request.from.lng },
          landmark: null,
        },
      ],
      disclaimer:
        DISCLAIMER +
        " ATTENTION : ce tracé est un segment direct, PAS un cheminement piéton " +
        "relevé. Aucun itinéraire continu n'existe dans les données OSM pour " +
        "cette paire de points.",
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
