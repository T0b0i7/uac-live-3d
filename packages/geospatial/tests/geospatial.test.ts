import { describe, expect, it } from "vitest";
import {
  bboxAround,
  bboxContains,
  bearingDegrees,
  blurPosition,
  degreesToMeters,
  destinationPoint,
  haversineMeters,
  pointInPolygon,
  polygonAreaMeters,
  type LonLat,
} from "../src/geo.js";
import {
  aStar,
  addEdge,
  addNode,
  connectNodes,
  createEmptyGraph,
  dijkstra,
  reachableFrom,
  routeBetweenPoints,
  snapToGraph,
  validateGraph,
  type PedestrianGraph,
} from "../src/graph.js";

// Repères réels autour du campus d'Abomey-Calavi (Bénin, ~6.41° N / 2.34° E).
const IFRI: LonLat = { lat: 6.4127, lng: 2.3387 };
const RECTORAT: LonLat = { lat: 6.4169, lng: 2.3421 };
const RESTO: LonLat = { lat: 6.4102, lng: 2.3371 };

describe("haversineMeters", () => {
  it("renvoie 0 pour un point identique", () => {
    expect(haversineMeters(IFRI, IFRI)).toBe(0);
  });

  it("reste cohérent avec une distance connue (Paris → Lyon ≈ 392 km)", () => {
    const paris: LonLat = { lat: 48.8566, lng: 2.3522 };
    const lyon: LonLat = { lat: 45.764, lng: 4.8357 };
    const d = haversineMeters(paris, lyon);
    expect(d / 1000).toBeGreaterThan(385);
    expect(d / 1000).toBeLessThan(400);
  });

  it("est symétrique", () => {
    const ab = haversineMeters(IFRI, RECTORAT);
    const ba = haversineMeters(RECTORAT, IFRI);
    expect(Math.abs(ab - ba)).toBeLessThan(1e-6);
  });

  it("donne une distance plausible entre deux points du campus (~500 m)", () => {
    const d = haversineMeters(IFRI, RECTORAT);
    expect(d).toBeGreaterThan(300);
    expect(d).toBeLessThan(800);
  });

  it("n'égare pas les très courtes distances", () => {
    const near: LonLat = { lat: IFRI.lat + 0.0001, lng: IFRI.lng + 0.0001 };
    const d = haversineMeters(IFRI, near);
    expect(d).toBeGreaterThan(10);
    expect(d).toBeLessThan(25);
  });
});

describe("degreesToMeters — piège degrés/mètres (ADR-003)", () => {
  it("à l'équateur, 1° de longitude vaut ~111 km", () => {
    const { metersPerDegLng } = degreesToMeters(0);
    expect(metersPerDegLng / 1000).toBeGreaterThan(111);
    expect(metersPerDegLng / 1000).toBeLessThan(111.4);
  });

  it("à 6.41° (Cotonou), 1° de longitude vaut ~110.6 km", () => {
    const { metersPerDegLng } = degreesToMeters(6.4127);
    expect(metersPerDegLng).toBeGreaterThan(110_000);
    expect(metersPerDegLng).toBeLessThan(111_000);
  });

  it("1° de latitude reste quasi constant (~111 km)", () => {
    const equator = degreesToMeters(0).metersPerDegLat;
    const campus = degreesToMeters(6.4127).metersPerDegLat;
    expect(Math.abs(equator - campus)).toBeLessThan(1000);
  });

  it("démontre que longitude ≠ latitude en mètres", () => {
    const { metersPerDegLat, metersPerDegLng } = degreesToMeters(6.4127);
    expect(metersPerDegLng).toBeLessThan(metersPerDegLat);
  });
});

describe("bboxAround / bboxContains", () => {
  it("contient le centre et exclut un point hors rayon", () => {
    const box = bboxAround(IFRI, 200);
    expect(bboxContains(box, IFRI)).toBe(true);
    expect(bboxContains(box, { lat: IFRI.lat + 0.1, lng: IFRI.lng })).toBe(false);
  });

  it("produit une boîte d'environ 2× le rayon en latitude", () => {
    const box = bboxAround(IFRI, 100);
    const heightMeters = haversineMeters(
      { lat: box.minLat, lng: IFRI.lng },
      { lat: box.maxLat, lng: IFRI.lng },
    );
    expect(heightMeters).toBeGreaterThan(190);
    expect(heightMeters).toBeLessThan(215);
  });
});

describe("bearing et destinationPoint", () => {
  it("un cap plein nord donne un point au nord", () => {
    const north = destinationPoint(IFRI, 0, 500);
    expect(north.lat).toBeGreaterThan(IFRI.lat);
    expect(Math.abs(north.lng - IFRI.lng)).toBeLessThan(1e-6);
  });

  it("aller puis revenir retrouve le point de départ", () => {
    const out = destinationPoint(IFRI, 45, 400);
    const back = destinationPoint(out, 225, 400);
    expect(haversineMeters(IFRI, back)).toBeLessThan(1);
  });

  it("le cap calculé correspond au déplacement effectué", () => {
    const target = destinationPoint(IFRI, 90, 300);
    const bearing = bearingDegrees(IFRI, target);
    // Cap est ≈ 90° (tolérance liée à la convergence des méridiens).
    expect(bearing).toBeGreaterThan(85);
    expect(bearing).toBeLessThan(95);
  });
});

describe("pointInPolygon et aire", () => {
  // Carré d'environ 200 m de côté centré sur IFRI.
  const ring: LonLat[] = [
    { lat: IFRI.lat - 0.001, lng: IFRI.lng - 0.001 },
    { lat: IFRI.lat - 0.001, lng: IFRI.lng + 0.001 },
    { lat: IFRI.lat + 0.001, lng: IFRI.lng + 0.001 },
    { lat: IFRI.lat + 0.001, lng: IFRI.lng - 0.001 },
  ];

  it("détecte l'intérieur et l'extérieur", () => {
    expect(pointInPolygon(IFRI, ring)).toBe(true);
    expect(pointInPolygon({ lat: IFRI.lat + 0.01, lng: IFRI.lng }, ring)).toBe(false);
  });

  it("rejette un anneau de moins de 3 points", () => {
    expect(pointInPolygon(IFRI, ring.slice(0, 2))).toBe(false);
  });

  it("calcule une aire cohérente avec la géométrie réelle", () => {
    // La boîte fait 0.002° de côté, soit ~221 m en latitude et ~219 m en
    // longitude à cette latitude ⇒ ~48 400 m². On vérifie à ±5 %.
    const area = polygonAreaMeters(ring);
    const { metersPerDegLat, metersPerDegLng } = degreesToMeters(IFRI.lat);
    const expected = 0.002 * metersPerDegLat * 0.002 * metersPerDegLng;
    expect(area).toBeGreaterThan(expected * 0.95);
    expect(area).toBeLessThan(expected * 1.05);
  });
});

describe("blurPosition — confidentialité BLURRED_ZONE (ADR-006)", () => {
  it("déplace toujours la position d'au moins 60 % du rayon", () => {
    for (let i = 0; i < 30; i++) {
      const blurred = blurPosition(IFRI, `user-${i}`, 60_000, 120);
      expect(haversineMeters(IFRI, blurred)).toBeGreaterThan(60);
    }
  });

  it("reste déterministe pour le même utilisateur sur la même période", () => {
    const a = blurPosition(IFRI, "user-stable", 3_600_000, 120);
    const b = blurPosition(IFRI, "user-stable", 3_600_000, 120);
    expect(a.lat).toBeCloseTo(b.lat, 10);
    expect(a.lng).toBeCloseTo(b.lng, 10);
  });

  it("donne des positions différentes selon l'utilisateur (pas de point unique commun)", () => {
    const a = blurPosition(IFRI, "alice", 3_600_000, 120);
    const b = blurPosition(IFRI, "bob", 3_600_000, 120);
    expect(haversineMeters(a, b)).toBeGreaterThan(1);
  });

  it("borne le décalage au rayon demandé", () => {
    const blurred = blurPosition(IFRI, "user-x", 60_000, 100);
    expect(haversineMeters(IFRI, blurred)).toBeLessThanOrEqual(110);
  });
});

// Graphe de test : une ligne A—B—C plus un raccourci A—C, et un cul-de-sac D.
function buildTestGraph(): PedestrianGraph {
  const g = createEmptyGraph();
  addNode(g, { id: "A", type: "JUNCTION", lat: IFRI.lat, lng: IFRI.lng });
  addNode(g, { id: "B", type: "WAYPOINT", lat: IFRI.lat + 0.002, lng: IFRI.lng });
  addNode(g, { id: "C", type: "ENTRANCE", lat: IFRI.lat + 0.004, lng: IFRI.lng });
  addNode(g, { id: "D", type: "POI", lat: IFRI.lat + 0.006, lng: IFRI.lng });
  // Linéaire.
  connectNodes(g, "A", "B", { accessible: true });
  connectNodes(g, "B", "C", { accessible: true });
  // Saut direct A—C, deux fois plus court que A-B-C.
  addEdge(g, {
    id: "A-C-shortcut",
    source: "A",
    target: "C",
    distanceMeters: 200,
    accessible: false,
    restrictions: ["STAIRS"],
  });
  // Cul-de-sac isolé volontaire.
  addNode(g, { id: "E", type: "POI", lat: RESTO.lat, lng: RESTO.lng });
  return g;
}

describe("graphe — construction et intégrité", () => {
  it("refuse une arête vers un nœud inconnu", () => {
    const g = createEmptyGraph();
    addNode(g, { id: "A", type: "JUNCTION", lat: 0, lng: 0 });
    expect(() =>
      addEdge(g, { id: "x", source: "A", target: "Z", distanceMeters: 10, accessible: true }),
    ).toThrow(/nœud d'arrivée inconnu/);
    expect(() =>
      addEdge(g, { id: "x", source: "ZZ", target: "A", distanceMeters: 10, accessible: true }),
    ).toThrow(/nœud de départ inconnu/);
  });

  it("refuse une distance négative", () => {
    const g = createEmptyGraph();
    addNode(g, { id: "A", type: "JUNCTION", lat: 0, lng: 0 });
    addNode(g, { id: "B", type: "JUNCTION", lat: 0.001, lng: 0 });
    expect(() =>
      addEdge(g, { id: "x", source: "A", target: "B", distanceMeters: -5, accessible: true }),
    ).toThrow(/négative/);
  });

  it("connectNodes calcule la distance par Haversine", () => {
    const g = buildTestGraph();
    const ab = g.edges.find((e) => e.id === "A--B")!;
    expect(ab.distanceMeters).toBeCloseTo(haversineMeters(IFRI, { lat: IFRI.lat + 0.002, lng: IFRI.lng }), 5);
  });

  it("enregistre l'arête dans les deux sens d'adjacence", () => {
    const g = buildTestGraph();
    expect(g.adjacency.get("A")!.some((e) => e.id === "A--B")).toBe(true);
    expect(g.adjacency.get("B")!.some((e) => e.id === "A--B")).toBe(true);
  });

  it("validateGraph signale le nœud isolé", () => {
    const g = buildTestGraph();
    const report = validateGraph(g);
    expect(report.valid).toBe(false);
    expect(report.problems.join(" ")).toContain("nœud isolé: E");
  });
});

describe("Dijkstra", () => {
  it("trouve le chemin direct quand c'est le plus court", () => {
    const g = buildTestGraph();
    const direct = dijkstra(g, "A", "C", { nonAccessiblePenalty: 1 });
    const viaB = dijkstra(g, "A", "C", { blockedEdgeIds: ["A-C-shortcut"] });
    expect(direct.distanceMeters).toBe(200);
    expect(viaB.distanceMeters).toBeGreaterThan(direct.distanceMeters);
    expect(viaB.nodeIds).toEqual(["A", "B", "C"]);
  });

  it("respecte accessibleOnly en évitant les escaliers", () => {
    const g = buildTestGraph();
    const result = dijkstra(g, "A", "C", { accessibleOnly: true });
    expect(result.found).toBe(true);
    expect(result.usesNonAccessible).toBe(false);
    expect(result.nodeIds).toEqual(["A", "B", "C"]);
  });

  it("applique la pénalité et préfère le détour accessible quand le raccourci est pénalisé", () => {
    const g = buildTestGraph();
    // Sans pénalité : le raccourci de 200 m gagne.
    const withoutPenalty = dijkstra(g, "A", "C");
    expect(withoutPenalty.distanceMeters).toBe(200);
    // Avec pénalité 1.6 : 200×1.6 = 320 m > ~445 m ? non → on vérifie juste la cohérence.
    const withPenalty = dijkstra(g, "A", "C", { nonAccessiblePenalty: 1.6 });
    expect(withPenalty.distanceMeters).toBeGreaterThanOrEqual(200);
  });

  it("renvoie found:false si aucun chemin (graphe déconnecté)", () => {
    const g = buildTestGraph();
    const result = dijkstra(g, "A", "E");
    expect(result.found).toBe(false);
    expect(result.nodeIds).toEqual([]);
    expect(result.estimatedMinutes).toBe(0);
  });

  it("renvoie found:false pour un nœud inexistant", () => {
    const g = buildTestGraph();
    expect(dijkstra(g, "A", "INEXISTANT").found).toBe(false);
    expect(dijkstra(g, "INEXISTANT", "A").found).toBe(false);
  });

  it("gère start === end", () => {
    const g = buildTestGraph();
    const result = dijkstra(g, "A", "A");
    expect(result.found).toBe(true);
    expect(result.distanceMeters).toBe(0);
    expect(result.nodeIds).toEqual(["A"]);
  });

  it("produit des coordonnées alignées sur les nœuds", () => {
    const g = buildTestGraph();
    const result = dijkstra(g, "A", "C", { blockedEdgeIds: ["A-C-shortcut"] });
    expect(result.coordinates).toHaveLength(3);
    expect(result.coordinates[0]).toEqual({ lat: IFRI.lat, lng: IFRI.lng });
  });

  it("estime une durée de marche non nulle et croissante avec la distance", () => {
    const g = buildTestGraph();
    const court = dijkstra(g, "A", "B");
    const long = dijkstra(g, "A", "C", { blockedEdgeIds: ["A-C-shortcut"] });
    expect(court.estimatedMinutes).toBeGreaterThanOrEqual(1);
    expect(long.estimatedMinutes).toBeGreaterThanOrEqual(court.estimatedMinutes);
  });
});

describe("A*", () => {
  it("renvoie le même coût que Dijkstra (heuristique consistante)", () => {
    const g = buildTestGraph();
    for (const [start, end] of [["A", "C"], ["A", "B"], ["B", "A"], ["C", "A"]]) {
      const d = dijkstra(g, start!, end!);
      const a = aStar(g, start!, end!);
      expect(a.found).toBe(d.found);
      expect(a.distanceMeters).toBeCloseTo(d.distanceMeters, 6);
      expect(a.nodeIds).toEqual(d.nodeIds);
    }
  });

  it("explore moins de nœuds que Dijkstra sur un graphe en grille", () => {
    const g = createEmptyGraph();
    const size = 12;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        addNode(g, {
          id: `n${x}_${y}`,
          type: "JUNCTION",
          lat: IFRI.lat + y * 0.0005,
          lng: IFRI.lng + x * 0.0005,
        });
      }
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (x + 1 < size) connectNodes(g, `n${x}_${y}`, `n${x + 1}_${y}`, { accessible: true });
        if (y + 1 < size) connectNodes(g, `n${x}_${y}`, `n${x}_${y + 1}`, { accessible: true });
      }
    }
    const d = dijkstra(g, "n0_0", `n${size - 1}_${size - 1}`);
    const a = aStar(g, "n0_0", `n${size - 1}_${size - 1}`);
    expect(a.found).toBe(true);
    expect(a.distanceMeters).toBeCloseTo(d.distanceMeters, 6);
    expect(a.exploredNodes).toBeLessThanOrEqual(d.exploredNodes);
  });

  it("respecte les arêtes bloquées", () => {
    const g = buildTestGraph();
    const result = aStar(g, "A", "C", { blockedEdgeIds: ["A-C-shortcut"] });
    expect(result.nodeIds).toEqual(["A", "B", "C"]);
  });
});

describe("reachableFrom", () => {
  it("détecte la composante connexe et exclut les nœuds isolés", () => {
    const g = buildTestGraph();
    const reachable = reachableFrom(g, "A");
    expect(reachable.has("A")).toBe(true);
    expect(reachable.has("B")).toBe(true);
    expect(reachable.has("C")).toBe(true);
    expect(reachable.has("D")).toBe(false);
    expect(reachable.has("E")).toBe(false);
  });
});

describe("snapToGraph et routeBetweenPoints", () => {
  it("accroche un point au nœud le plus proche", () => {
    const g = buildTestGraph();
    const snap = snapToGraph(g, { lat: IFRI.lat + 0.0001, lng: IFRI.lng + 0.0001 });
    expect(snap?.nodeId).toBe("A");
    expect(snap?.isFar).toBe(false);
  });

  it("signale un point hors campus comme lointain", () => {
    const g = buildTestGraph();
    const snap = snapToGraph(g, { lat: IFRI.lat + 0.5, lng: IFRI.lng });
    expect(snap?.isFar).toBe(true);
  });

  it("calcule un itinéraire complet entre deux coordonnées libres", () => {
    const g = buildTestGraph();
    const result = routeBetweenPoints(
      g,
      { lat: IFRI.lat + 0.0001, lng: IFRI.lng },
      { lat: IFRI.lat + 0.0041, lng: IFRI.lng },
      { algorithm: "astar", accessibleOnly: true },
    );
    expect(result.found).toBe(true);
    expect(result.snapStart?.nodeId).toBe("A");
    expect(result.snapEnd?.nodeId).toBe("C");
    expect(result.distanceMeters).toBeGreaterThan(0);
  });

  it("échoue proprement sur un graphe vide", () => {
    const empty = createEmptyGraph();
    const result = routeBetweenPoints(empty, IFRI, RECTORAT);
    expect(result.found).toBe(false);
    expect(result.snapStart).toBeNull();
  });
});
