/**
 * Tests — calcul d'itinéraire HORS LIGNE (tâche 2)
 *
 * Ce fichier ne teste pas une maquette : il charge le graphe piéton
 * RÉELLEMENT sérialisé par l'API (`/api/v1/navigation/graph?full=1`), capturé
 * dans `tests/fixtures/pedestrian-graph.json`, et fait tourner le MÊME code
 * que celui exécuté dans le navigateur (`computeRouteBetweenNodes`).
 *
 * Preuve « aucune requête réseau » : `globalThis.fetch` est remplacé par une
 * fonction qui lève. Si le calcul appelait le réseau, les tests échoueraient
 * immédiatement.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PedestrianGraphDto } from "@/lib/api/endpoints";
import {
  computeRouteBetweenNodes,
  dtoToPedestrianGraph,
  inspectGraph,
} from "@/lib/offline/graph-cache";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "fixtures/pedestrian-graph.json");

/** Graphe tel que renvoyé par l'API (nœuds + arêtes uniquement). */
const payload = JSON.parse(readFileSync(fixturePath, "utf8")) as PedestrianGraphDto;

/** Graphe converti en structure exploitable par les algorithmes. */
const { graph, skippedEdges } = dtoToPedestrianGraph(payload);

describe("graphe réel sérialisé par l'API", () => {
  it("contient les 15 nœuds et 21 arêtes annoncés par les métadonnées", () => {
    expect(payload.nodes).toHaveLength(15);
    expect(payload.edges).toHaveLength(21);
    expect(payload.version).toMatch(/^[0-9a-f]{8}$/);
  });

  it("se convertit sans perdre aucune arête", () => {
    expect(skippedEdges).toBe(0);
    expect(graph.nodes.size).toBe(15);
    expect(graph.edges).toHaveLength(21);
  });

  it("passe la validation d'intégrité (aucune arête orpheline, distances > 0)", () => {
    const { valid, problems } = inspectGraph(graph);
    expect(problems).toEqual([]);
    expect(valid).toBe(true);
  });

  it("porte bien 19 arêtes accessibles PMR sur 21", () => {
    expect(graph.edges.filter((edge) => edge.accessible)).toHaveLength(19);
  });
});

describe("computeRouteBetweenNodes — IFRI → AMPHI-500", () => {
  it("trouve l'itinéraire et retombe exactement sur les 327 m du serveur", () => {
    const route = computeRouteBetweenNodes(graph, "IFRI", "AMPHI-500");

    expect(route.found).toBe(true);
    // L'arête W-002-IFRI-AMPHI-500 mesure 327,2 m en base. Le serveur arrondit
    // à 327 m dans sa réponse HTTP : le calcul local doit donner la même chose.
    expect(Math.round(route.distanceMeters)).toBe(327);
    expect(route.distanceMeters).toBeCloseTo(327.2, 5);
  });

  it("respecte le contrat de PathResult (champs tous présents et typés)", () => {
    const route = computeRouteBetweenNodes(graph, "IFRI", "AMPHI-500");

    expect(route.nodeIds).toEqual(["IFRI", "AMPHI-500"]);
    expect(route.coordinates).toHaveLength(2);
    expect(route.coordinates[0]).toEqual({ lat: 6.412546256805397, lng: 2.3387 });
    expect(route.coordinates[1]).toEqual({ lat: 6.415055300522726, lng: 2.3389 });
    expect(route.straightLineMeters).toBeGreaterThan(0);
    expect(route.straightLineMeters).toBeLessThan(route.distanceMeters);
    expect(route.estimatedMinutes).toBeGreaterThan(0);
    expect(route.usesNonAccessible).toBe(false);
    expect(route.exploredNodes).toBeGreaterThan(0);
  });

  it("donne le même résultat en Dijkstra qu'en A* (heuristique admissible)", () => {
    const astar = computeRouteBetweenNodes(graph, "IFRI", "AMPHI-500", { algorithm: "astar" });
    const dijkstra = computeRouteBetweenNodes(graph, "IFRI", "AMPHI-500", { algorithm: "dijkstra" });

    expect(dijkstra.distanceMeters).toBeCloseTo(astar.distanceMeters, 6);
    expect(dijkstra.nodeIds).toEqual(astar.nodeIds);
    // A* doit explorer au plus autant de nœuds que Dijkstra.
    expect(astar.exploredNodes).toBeLessThanOrEqual(dijkstra.exploredNodes);
  });

  it("le trajet retour donne la même distance (graphe non orienté)", () => {
    const aller = computeRouteBetweenNodes(graph, "IFRI", "AMPHI-500");
    const retour = computeRouteBetweenNodes(graph, "AMPHI-500", "IFRI");
    expect(retour.distanceMeters).toBeCloseTo(aller.distanceMeters, 6);
    expect(retour.found).toBe(true);
  });

  it("un trajet d'un nœud vers lui-même vaut 0 m", () => {
    const route = computeRouteBetweenNodes(graph, "IFRI", "IFRI");
    expect(route.found).toBe(true);
    expect(route.distanceMeters).toBe(0);
    expect(route.nodeIds).toEqual(["IFRI"]);
  });

  it("emprunte l'itinéraire accessible quand accessibleOnly est exigé", () => {
    // IFRI→AMPHI-B : direct via FAST-A est non accessible (W-006). L'itinéraire
    // PMR doit passer par AMPHI-500 et être plus long.
    const libre = computeRouteBetweenNodes(graph, "IFRI", "AMPHI-B");
    const pmr = computeRouteBetweenNodes(graph, "IFRI", "AMPHI-B", { accessibleOnly: true });

    expect(libre.found).toBe(true);
    expect(pmr.found).toBe(true);
    expect(pmr.usesNonAccessible).toBe(false);
    expect(pmr.distanceMeters).toBeGreaterThanOrEqual(libre.distanceMeters);
  });
});

describe("cas limites du calcul d'itinéraire", () => {
  it("renvoie found:false pour un nœud de départ inexistant", () => {
    const route = computeRouteBetweenNodes(graph, "NŒUD-QUI-N-EXISTE-PAS", "AMPHI-500");
    expect(route.found).toBe(false);
    expect(route.nodeIds).toEqual([]);
    expect(route.coordinates).toEqual([]);
    expect(route.distanceMeters).toBe(0);
  });

  it("renvoie found:false pour un nœud d'arrivée inexistant", () => {
    const route = computeRouteBetweenNodes(graph, "IFRI", "BATIMENT-FANTÔME");
    expect(route.found).toBe(false);
    expect(route.distanceMeters).toBe(0);
  });

  it("renvoie found:false quand les deux nœuds sont inexistants", () => {
    const route = computeRouteBetweenNodes(graph, "???", "!!!");
    expect(route.found).toBe(false);
  });

  it("renvoie found:false quand la route est physiquement impossible (départ isolé)", () => {
    // Le graphe réel est connexe : pour rendre un départ inatteignable sans
    // inventer de fausses données, on interdit les 4 arêtes incidentes à IFRI.
    const blocked = graph.edges
      .filter((edge) => edge.source === "IFRI" || edge.target === "IFRI")
      .map((edge) => edge.id);

    expect(blocked).toHaveLength(4);

    const route = computeRouteBetweenNodes(graph, "IFRI", "AMPHI-500", { blockedEdgeIds: blocked });
    expect(route.found).toBe(false);
    expect(route.nodeIds).toEqual([]);
    expect(route.distanceMeters).toBe(0);
    // Un chemin trivial IFRI→IFRI resterait trouvé : on vérifie que ce n'est
    // pas ce que renvoie l'algorithme pour une destination distincte.
    expect(route.coordinates).toEqual([]);
  });

  it("n'accepte pas un graphe vide comme un succès silencieux", () => {
    const empty = dtoToPedestrianGraph({ ...payload, nodes: [], edges: [] } as PedestrianGraphDto);
    expect(empty.graph.nodes.size).toBe(0);
    const route = computeRouteBetweenNodes(empty.graph, "IFRI", "AMPHI-500");
    expect(route.found).toBe(false);
  });

  it("signale les arêtes orphelines au lieu de les ignorer silencieusement", () => {
    const corrompu = {
      ...payload,
      edges: [
        ...payload.edges,
        {
          id: "W-FANTOME",
          source: "IFRI",
          target: "NŒUD-ABSENT",
          distanceMeters: 10,
          accessible: true,
          restrictions: null,
          surface: null,
        },
      ],
    } as PedestrianGraphDto;

    const converted = dtoToPedestrianGraph(corrompu);
    expect(converted.skippedEdges).toBe(1);
    expect(converted.graph.edges).toHaveLength(21);
  });
});

describe("preuve d'exécution 100 % côté client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("ne fait AUCUN appel réseau pendant le calcul", () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("Le calcul d'itinéraire ne doit jamais appeler le réseau.");
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    try {
      const route = computeRouteBetweenNodes(graph, "IFRI", "AMPHI-500");
      expect(route.found).toBe(true);
      expect(Math.round(route.distanceMeters)).toBe(327);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("calcule encore après perte totale du réseau (double preuve)", () => {
    globalThis.fetch = (() => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    try {
      const routes = [
        ["IFRI", "AMPHI-500"],
        ["IFRI", "BIBLIO"],
        ["RESTO-U", "STADE"],
        ["CROUS", "FLSH-B"],
      ] as const;

      for (const [from, to] of routes) {
        const route = computeRouteBetweenNodes(graph, from, to);
        expect(route.found).toBe(true);
        expect(route.distanceMeters).toBeGreaterThan(0);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
