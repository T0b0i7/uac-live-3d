import { describe, expect, it } from "vitest";
import {
  campusCoordinateSchema,
  createBuildingBodySchema,
  createReportBodySchema,
  createSosBodySchema,
  nearbyQuerySchema,
  paginationQuerySchema,
  polygonGeometrySchema,
  registerBodySchema,
  routeRequestSchema,
  updatePresenceBodySchema,
} from "../src/index.js";

describe("validation d'inscription", () => {
  const valid = {
    email: "Etudiant@UAC.bj",
    password: "CampusUac2026",
    fullName: "  Kokou   ADJOVI  ",
    matricule: "uac-12345",
    facultyId: "11111111-1111-4111-8111-111111111111",
    level: "L3",
  };

  it("accepte une inscription valide et normalise email/nom/matricule", () => {
    const parsed = registerBodySchema.parse(valid);
    expect(parsed.email).toBe("etudiant@uac.bj");
    expect(parsed.fullName).toBe("Kokou ADJOVI");
    expect(parsed.matricule).toBe("UAC-12345");
  });

  it("refuse un mot de passe trop court", () => {
    const result = registerBodySchema.safeParse({ ...valid, password: "Court1" });
    expect(result.success).toBe(false);
  });

  it("refuse un mot de passe sans chiffre", () => {
    const result = registerBodySchema.safeParse({ ...valid, password: "SansChiffreIci" });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("chiffre");
  });

  it("refuse un mot de passe sans lettre", () => {
    const result = registerBodySchema.safeParse({ ...valid, password: "1234567890123" });
    expect(result.success).toBe(false);
  });

  it("refuse un matricule contenant des caractères interdits", () => {
    expect(registerBodySchema.safeParse({ ...valid, matricule: "UAC 123;DROP" }).success).toBe(false);
  });

  it("refuse un niveau inconnu", () => {
    expect(registerBodySchema.safeParse({ ...valid, level: "L9" }).success).toBe(false);
  });

  it("refuse un facultyId non UUID", () => {
    expect(registerBodySchema.safeParse({ ...valid, facultyId: "abc" }).success).toBe(false);
  });
});

describe("campusCoordinateSchema — garde-fou degrés/mètres", () => {
  it("accepte un point du campus", () => {
    expect(campusCoordinateSchema.safeParse({ lat: 6.4127, lng: 2.3387 }).success).toBe(true);
  });

  it("rejette des mètres envoyés à la place de degrés", () => {
    const result = campusCoordinateSchema.safeParse({ lat: 412700, lng: 233870 });
    expect(result.success).toBe(false);
  });

  it("rejette un point manifestement hors campus (Paris)", () => {
    const result = campusCoordinateSchema.safeParse({ lat: 48.8566, lng: 2.3522 });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("Abomey-Calavi");
  });
});

describe("polygonGeometrySchema", () => {
  it("accepte un anneau fermé valide", () => {
    const polygon = {
      type: "Polygon" as const,
      coordinates: [
        [
          [2.338, 6.412],
          [2.339, 6.412],
          [2.339, 6.413],
          [2.338, 6.412],
        ],
      ],
    };
    expect(polygonGeometrySchema.safeParse(polygon).success).toBe(true);
  });

  it("refuse un anneau de moins de 4 points", () => {
    const polygon = {
      type: "Polygon" as const,
      coordinates: [
        [
          [2.338, 6.412],
          [2.339, 6.412],
        ],
      ],
    };
    expect(polygonGeometrySchema.safeParse(polygon).success).toBe(false);
  });

  it("refuse des longitudes hors bornes", () => {
    const polygon = {
      type: "Polygon" as const,
      coordinates: [
        [
          [200, 6.412],
          [2.339, 6.412],
          [2.339, 6.413],
          [200, 6.413],
        ],
      ],
    };
    expect(polygonGeometrySchema.safeParse(polygon).success).toBe(false);
  });
});

describe("pagination", () => {
  it("applique les valeurs par défaut et convertit les chaînes", () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(paginationQuerySchema.parse({ page: "3", limit: "50" })).toEqual({ page: 3, limit: 50 });
  });

  it("borne limit au maximum autorisé", () => {
    expect(paginationQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
  });

  it("rejette une page à zéro", () => {
    expect(paginationQuerySchema.safeParse({ page: "0" }).success).toBe(false);
  });
});

describe("nearbyQuerySchema", () => {
  it("applique un rayon par défaut de 500 m", () => {
    const parsed = nearbyQuerySchema.parse({ lat: "6.4127", lng: "2.3387" });
    expect(parsed.radius).toBe(500);
  });

  it("rejette un rayon déraisonnable (10 km)", () => {
    const result = nearbyQuerySchema.safeParse({ lat: 6.4127, lng: 2.3387, radius: "10000" });
    expect(result.success).toBe(false);
  });
});

describe("updatePresenceBodySchema", () => {
  it("applique une durée de partage par défaut", () => {
    const parsed = updatePresenceBodySchema.parse({ status: "ON_CAMPUS", location: null });
    expect(parsed.shareForMinutes).toBe(120);
  });

  it("refuse une durée de partage au-delà de la rétention maximale", () => {
    const result = updatePresenceBodySchema.safeParse({
      status: "ON_CAMPUS",
      location: null,
      shareForMinutes: 60 * 48,
    });
    expect(result.success).toBe(false);
  });

  it("accepte location absente (mode ghost)", () => {
    expect(updatePresenceBodySchema.safeParse({ status: "OFFLINE" }).success).toBe(true);
  });
});

describe("createReportBodySchema", () => {
  it("accepte un signalement valide", () => {
    const parsed = createReportBodySchema.parse({
      title: "Fuite d'eau au plafond",
      category: "MAINTENANCE",
      location: { lat: 6.4127, lng: 2.3387 },
      severity: 3,
    });
    expect(parsed.severity).toBe(3);
  });

  it("refuse un titre trop court", () => {
    expect(
      createReportBodySchema.safeParse({
        title: "Eau",
        category: "MAINTENANCE",
        location: { lat: 6.4127, lng: 2.3387 },
      }).success,
    ).toBe(false);
  });

  it("refuse une sévérité hors échelle 1-5", () => {
    expect(
      createReportBodySchema.safeParse({
        title: "Fuite d'eau au plafond",
        category: "MAINTENANCE",
        location: { lat: 6.4127, lng: 2.3387 },
        severity: 9,
      }).success,
    ).toBe(false);
  });

  it("refuse un titre dépassant la limite", () => {
    expect(
      createReportBodySchema.safeParse({
        title: "x".repeat(200),
        category: "OTHER",
        location: { lat: 6.4127, lng: 2.3387 },
      }).success,
    ).toBe(false);
  });
});

describe("createSosBodySchema", () => {
  it("accepte un SOS sans position (mode ghost / GPS indisponible)", () => {
    const parsed = createSosBodySchema.parse({ kind: "MEDICAL", location: null });
    expect(parsed.kind).toBe("MEDICAL");
    expect(parsed.location).toBeNull();
  });

  it("refuse une catégorie SOS inconnue", () => {
    expect(createSosBodySchema.safeParse({ kind: "ZOMBIE", location: null }).success).toBe(false);
  });
});

describe("routeRequestSchema", () => {
  it("applique les valeurs par défaut (astar, non accessible)", () => {
    const parsed = routeRequestSchema.parse({
      from: { lat: 6.4127, lng: 2.3387 },
      to: { lat: 6.4169, lng: 2.3421 },
    });
    expect(parsed.algorithm).toBe("astar");
    expect(parsed.accessibleOnly).toBe(false);
  });

  it("refuse un itinéraire dont le départ est hors campus", () => {
    expect(
      routeRequestSchema.safeParse({
        from: { lat: 51.5, lng: -0.12 },
        to: { lat: 6.4169, lng: 2.3421 },
      }).success,
    ).toBe(false);
  });
});

describe("createBuildingBodySchema", () => {
  it("normalise le code en majuscules et applique floors par défaut", () => {
    const parsed = createBuildingBodySchema.parse({
      code: " ifri ",
      name: "Institut de Formation et de Recherche en Informatique",
      category: "ACADEMIC",
    });
    expect(parsed.code).toBe("IFRI");
    expect(parsed.floors).toBe(1);
  });

  it("refuse un nombre d'étages absurde", () => {
    expect(
      createBuildingBodySchema.safeParse({
        code: "X",
        name: "Test",
        category: "OTHER",
        floors: 500,
      }).success,
    ).toBe(false);
  });
});
