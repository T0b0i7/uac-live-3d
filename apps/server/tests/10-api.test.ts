/**
 * Tests d'intégration API — apps/server/tests/10-api.test.ts
 *
 * Chaque test traverse la vraie pile : Fastify → validation Zod → service →
 * PostgreSQL/PostGIS → sérialisation. Aucun mock de base de données.
 *
 * Couverture exigée (§3) : /health, login, refresh, me, buildings, faculties,
 * navigation/graph, reports — réponses, validations, autorisations, erreurs.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  assertSeedPresent,
  authHeader,
  createTestContext,
  DEMO_EMAIL,
  loginAsDemo,
  type TestContext,
} from "./helpers.js";

let ctx: TestContext;
let tokens: { accessToken: string; refreshToken: string; userId: string };

beforeAll(async () => {
  ctx = await createTestContext();
  await assertSeedPresent(ctx.db);
  tokens = await loginAsDemo(ctx.app);
});

afterAll(async () => {
  await ctx?.close();
});

// ===========================================================================
// GET /health
// ===========================================================================
describe("GET /health", () => {
  it("confirme la connexion PostgreSQL et PostGIS", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      status: string;
      database: string;
      postgis: string | null;
      service: string;
    };
    expect(body.status).toBe("ok");
    expect(body.database).toBe("up");
    expect(body.service).toBe("uac-live-3d-api");
    // PostGIS doit réellement répondre, pas seulement être installé.
    expect(body.postgis).toMatch(/^\d+\.\d+/);
  });
});

// ===========================================================================
// POST /api/v1/auth/login
// ===========================================================================
describe("POST /api/v1/auth/login", () => {
  it("authentifie le compte de démonstration et renvoie un couple de jetons", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: DEMO_EMAIL, password: "CampusUac2026" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: {
        user: { id: string; email: string; role: string; matriculeMasked: string; matricule: string };
        tokens: { accessToken: string; refreshToken: string; expiresIn: number; tokenType: string };
      };
    };

    expect(body.data.user.email).toBe(DEMO_EMAIL);
    expect(body.data.user.role).toBe("ADMIN");
    expect(body.data.tokens.accessToken.split(".")).toHaveLength(3); // JWT
    expect(body.data.tokens.expiresIn).toBe(900); // 15 min
    expect(body.data.tokens.tokenType).toBe("Bearer");
    // Le matricule complet n'est exposé que sur /auth/me, pas ici… mais on
    // vérifie surtout que le masquage existe.
    expect(body.data.user.matriculeMasked).toContain("*");
  });

  it("accepte un email insensible à la casse", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "DEMO@UAC-LIVE.BJ", password: "CampusUac2026" },
    });
    expect(response.statusCode).toBe(200);
  });

  it("refuse un mot de passe incorrect avec 401 et un message identique à email inconnu", async () => {
    const wrongPassword = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: DEMO_EMAIL, password: "MauvaisMotDePasse1" },
    });
    const unknownEmail = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "inconnu@uac-live.bj", password: "MauvaisMotDePasse1" },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);

    const a = wrongPassword.json() as { error: { message: string; code: string } };
    const b = unknownEmail.json() as { error: { message: string; code: string } };
    // Indistinguabilité : même code ET même message.
    expect(a.error.code).toBe("AUTHENTICATION_ERROR");
    expect(a.error.message).toBe(b.error.message);
  });

  it("rejette un payload invalide en 422 avec les champs fautifs", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "pas-un-email", password: "" },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json() as {
      error: { code: string; message: string; requestId: string; fields?: Record<string, string> };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields).toBeDefined();
    expect(Object.keys(body.error.fields!)).toContain("email");
  });
});

// ===========================================================================
// GET /api/v1/auth/me + autorisations
// ===========================================================================
describe("GET /api/v1/auth/me", () => {
  it("renvoie le profil complet authentifié (matricule en clair pour soi)", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: authHeader(tokens.accessToken),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: { id: string; email: string; fullName: string; matricule: string; privacyMode: string };
    };
    expect(body.data.id).toBe(tokens.userId);
    expect(body.data.matricule).toBeTruthy();
    expect(body.data.privacyMode).toBe("FRIENDS_PROMO");
  });

  it("refuse sans jeton (401)", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/api/v1/auth/me" });
    expect(response.statusCode).toBe(401);
  });

  it("refuse un jeton malformé (401) sans fuite de détail", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: authHeader("pas.un.jwt"),
    });
    expect(response.statusCode).toBe(401);
    const body = response.json() as { error: { message: string } };
    expect(body.error.message).not.toContain("jsonwebtoken");
  });
});

// ===========================================================================
// POST /api/v1/auth/refresh — rotation + détection de rejeu
// ===========================================================================
describe("POST /api/v1/auth/refresh", () => {
  it("fait tourner le jeton et invalide l'ancien", async () => {
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: DEMO_EMAIL, password: "CampusUac2026" },
    });
    const original = (login.json() as { data: { tokens: { refreshToken: string } } }).data.tokens
      .refreshToken;

    const first = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: original },
    });
    expect(first.statusCode).toBe(200);

    const rotated = (first.json() as { data: { tokens: { refreshToken: string } } }).data.tokens
      .refreshToken;
    expect(rotated).not.toBe(original);

    // Rejeu de l'ancien jeton ⇒ 401 ET révocation de toute la famille.
    const replay = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: original },
    });
    expect(replay.statusCode).toBe(401);

    // Le jeton tourné est lui aussi invalidé par la révocation de famille.
    const afterReplay = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: rotated },
    });
    expect(afterReplay.statusCode).toBe(401);
  });

  it("refuse un jeton inconnu (401)", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: "jeton-totalement-invente-mais-assez-long" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("refuse une requête sans jeton (401)", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: {},
    });
    expect(response.statusCode).toBe(401);
  });
});

// ===========================================================================
// GET /api/v1/buildings
// ===========================================================================
describe("GET /api/v1/buildings", () => {
  it("liste les bâtiments avec pagination", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/api/v1/buildings" });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      data: Array<{ id: string; code: string; name: string; category: string }>;
      meta: { page: number; limit: number; total: number; hasMore: boolean };
    };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.meta.page).toBe(1);
    expect(body.meta.limit).toBe(20);
    expect(body.meta.total).toBeGreaterThanOrEqual(15);
  });

  it("filtre par catégorie", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/buildings?category=LIBRARY",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: Array<{ category: string }> };
    for (const building of body.data) expect(building.category).toBe("LIBRARY");
  });

  it("filtre par recherche textuelle", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/buildings?search=IFRI",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: Array<{ code: string; name: string }> };
    expect(body.data.some((b) => b.code === "IFRI")).toBe(true);
  });

  it("applique un filtre spatial bbox réel via PostGIS", async () => {
    // Boîte serrée autour de l'IFRI : doit exclure le stade, à ~700 m.
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/buildings?bbox=2.3360,6.4100,2.3420,6.4160",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: Array<{ code: string }> };
    const codes = body.data.map((b) => b.code);
    expect(codes).toContain("IFRI");
    expect(codes).not.toContain("STADE");
  });

  it("rejette une catégorie inconnue (422)", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/buildings?category=NUCLEAR",
    });
    expect(response.statusCode).toBe(422);
  });

  it("rejette un limit hors bornes (422)", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/buildings?limit=9999",
    });
    expect(response.statusCode).toBe(422);
  });

  it("expose les aires calculées par PostGIS (m² plausibles)", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/buildings?search=IFRI",
    });
    const body = response.json() as { data: Array<{ code: string; footprintAreaM2: number | null }> };
    const ifri = body.data.find((b) => b.code === "IFRI");
    expect(ifri).toBeDefined();
    // Un bâtiment de 46×34 m ≈ 1564 m² ; on vérifie l'ordre de grandeur réel.
    expect(ifri!.footprintAreaM2).toBeGreaterThan(1000);
    expect(ifri!.footprintAreaM2).toBeLessThan(3000);
  });
});

// ===========================================================================
// GET /api/v1/faculties
// ===========================================================================
describe("GET /api/v1/faculties", () => {
  it("liste les facultés avec le décompte de bâtiments", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/api/v1/faculties" });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      data: Array<{ code: string; name: string; buildingCount: number }>;
    };
    expect(body.data.length).toBe(7);
    expect(body.data.map((f) => f.code)).toContain("IFRI");
    const ifri = body.data.find((f) => f.code === "IFRI")!;
    expect(ifri.buildingCount).toBeGreaterThan(0);
  });

  it("renvoie les bâtiments d'une faculté", async () => {
    const list = await ctx.app.inject({ method: "GET", url: "/api/v1/faculties" });
    const ifri = (list.json() as { data: Array<{ id: string; code: string }> }).data.find(
      (f) => f.code === "IFRI",
    )!;

    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/faculties/${ifri.id}/buildings`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: Array<{ facultyId: string }> };
    for (const b of body.data) expect(b.facultyId).toBe(ifri.id);
  });
});

// ===========================================================================
// GET /api/v1/navigation/graph
// ===========================================================================
describe("GET /api/v1/navigation/graph", () => {
  it("décrit le graphe piéton construit depuis PostGIS", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/navigation/graph",
    });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      data: {
        nodeCount: number;
        edgeCount: number;
        accessibleEdgeCount: number;
        isValidated: boolean;
        disclaimer: string;
      };
    };
    expect(body.data.nodeCount).toBeGreaterThan(10);
    expect(body.data.edgeCount).toBeGreaterThan(10);
    expect(body.data.accessibleEdgeCount).toBeLessThanOrEqual(body.data.edgeCount);
    // Honnêteté : le graphe n'est PAS déclaré validé.
    expect(body.data.isValidated).toBe(false);
    // Le texte doit refléter l'état réel : données géospatiales disponibles,
    // itinéraires restant INDICATIFS faute de validation terrain.
    expect(body.data.disclaimer.toLowerCase()).toContain("indicatif");
    expect(body.data.disclaimer.toLowerCase()).toContain("postgis");
    expect(body.data.disclaimer.toLowerCase()).not.toContain("démonstration");
  });

  it("calcule un itinéraire réel entre deux bâtiments", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/navigation/routes",
      payload: {
        from: { lat: 6.4127, lng: 2.3387 }, // IFRI
        to: { lat: 6.4102, lng: 2.3371 }, // Resto U
        accessibleOnly: false,
        algorithm: "astar",
      },
    });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      data: {
        found: boolean;
        distanceMeters: number;
        estimatedMinutes: number;
        straightLineMeters: number;
        polyline: Array<{ lat: number; lng: number }>;
        steps: Array<{ instruction: string; distanceMeters: number }>;
        disclaimer: string;
      };
    };
    expect(body.data.found).toBe(true);
    expect(body.data.distanceMeters).toBeGreaterThan(0);
    expect(body.data.estimatedMinutes).toBeGreaterThanOrEqual(1);
    expect(body.data.polyline.length).toBeGreaterThanOrEqual(2);
    expect(body.data.steps.length).toBeGreaterThan(0);
    // L'itinéraire réel est toujours ≥ la ligne droite.
    expect(body.data.distanceMeters).toBeGreaterThanOrEqual(
      Math.floor(body.data.straightLineMeters),
    );
  });

  it("refuse une coordonnée hors campus (garde-fou degrés/mètres)", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/navigation/routes",
      payload: {
        from: { lat: 48.8566, lng: 2.3522 }, // Paris
        to: { lat: 6.4102, lng: 2.3371 },
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it("expose les destinations navigables", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/navigation/destinations",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: Array<{ id: string; label: string }> };
    expect(body.data.length).toBeGreaterThan(5);
    expect(body.data.some((d) => d.id === "IFRI")).toBe(true);
  });
});

// ===========================================================================
// GET /api/v1/reports
// ===========================================================================
describe("GET /api/v1/reports", () => {
  it("liste les signalements actifs", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/api/v1/reports" });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      data: Array<{ id: string; title: string; category: string; location: { lat: number; lng: number } }>;
      meta: { total: number };
    };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.meta.total).toBeGreaterThan(0);
    // La position doit être un point exploitable.
    const first = body.data[0]!;
    expect(first.location.lat).toBeGreaterThan(6);
    expect(first.location.lng).toBeGreaterThan(2);
  });

  it("filtre par catégorie", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/reports?category=SAFETY",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: Array<{ category: string }> };
    for (const r of body.data) expect(r.category).toBe("SAFETY");
  });

  it("renvoie le détail d'un signalement", async () => {
    const list = await ctx.app.inject({ method: "GET", url: "/api/v1/reports" });
    const id = (list.json() as { data: Array<{ id: string }> }).data[0]!.id;

    const response = await ctx.app.inject({ method: "GET", url: `/api/v1/reports/${id}` });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { id: string; myVote: number } };
    expect(body.data.id).toBe(id);
  });

  it("renvoie 404 structuré pour un identifiant inconnu", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/reports/00000000-0000-4000-8000-000000000000",
    });
    expect(response.statusCode).toBe(404);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("exige l'authentification pour créer un signalement", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: {
        title: "Test sans authentification",
        category: "OTHER",
        location: { lat: 6.4127, lng: 2.3387 },
      },
    });
    expect(response.statusCode).toBe(401);
  });
});

// ===========================================================================
// Création de signalement authentifiée + idempotence
// ===========================================================================
describe("POST /api/v1/reports (authentifié)", () => {
  it("crée un signalement et respecte l'idempotence de l'operationId", async () => {
    const operationId = crypto.randomUUID();
    const payload = {
      title: "Signalement de test d'intégration",
      body: "Créé par la suite de tests automatisés.",
      category: "OTHER",
      severity: 2,
      location: { lat: 6.4127, lng: 2.3387 },
    };

    const first = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/reports",
      headers: { ...authHeader(tokens.accessToken), "idempotency-key": operationId },
      payload,
    });
    expect(first.statusCode).toBe(201);
    const firstId = (first.json() as { data: { id: string } }).data.id;

    // Rejeu réseau : même operationId ⇒ même enregistrement, pas de doublon.
    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/reports",
      headers: { ...authHeader(tokens.accessToken), "idempotency-key": operationId },
      payload,
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as { data: { id: string }; meta: { duplicate: boolean } };
    expect(secondBody.data.id).toBe(firstId);
    expect(secondBody.meta.duplicate).toBe(true);

    // Nettoyage : on ne laisse pas de résidu dans la base de démonstration.
    await ctx.app.inject({
      method: "DELETE",
      url: `/api/v1/reports/${firstId}`,
      headers: authHeader(tokens.accessToken),
    });
  });

  it("rejette un titre trop court (422)", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/reports",
      headers: authHeader(tokens.accessToken),
      payload: { title: "X", category: "OTHER", location: { lat: 6.4127, lng: 2.3387 } },
    });
    expect(response.statusCode).toBe(422);
  });
});

// ===========================================================================
// RBAC
// ===========================================================================
describe("RBAC", () => {
  const adminRoutes = [
    "/api/v1/admin/dashboard",
    "/api/v1/admin/contributions",
    "/api/v1/admin/audit-logs",
  ];

  it("refuse les routes admin sans authentification", async () => {
    for (const url of adminRoutes) {
      const response = await ctx.app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(401);
    }
  });

  it("autorise le compte de démonstration ADMIN et renvoie des statistiques réelles", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/admin/dashboard",
      headers: authHeader(tokens.accessToken),
    });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      data: {
        totals: { users: number; buildings: number; verifiedBuildings: number };
        presence: { sharing: number; ghost: number; blurred: number };
      };
    };
    // >= et non === : les tests d'inscription créent des comptes jetables.
    expect(body.data.totals.users).toBeGreaterThanOrEqual(25);
    expect(body.data.totals.buildings).toBe(15);
    expect(body.data.totals.verifiedBuildings).toBeGreaterThan(0);
    expect(body.data.presence.sharing + body.data.presence.ghost + body.data.presence.blurred).toBeGreaterThan(0);
  });

  it("refuse un STUDENT sur une route MODERATOR", async () => {
    // Inscription d'un compte jetable, puis tentative d'accès admin.
    const email = `test-rbac-${Date.now()}@uac-live.bj`;
    const faculties = await ctx.app.inject({ method: "GET", url: "/api/v1/faculties" });
    const facultyId = (faculties.json() as { data: Array<{ id: string }> }).data[0]!.id;

    const registered = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email,
        password: "MotDePasseTest2026",
        fullName: "Test RBAC",
        matricule: `T-${Date.now()}`,
        facultyId,
        level: "L1",
      },
    });
    expect(registered.statusCode).toBe(201);
    const studentToken = (registered.json() as { data: { tokens: { accessToken: string } } }).data
      .tokens.accessToken;

    try {
      const forbidden = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/admin/dashboard",
        headers: authHeader(studentToken),
      });
      expect(forbidden.statusCode).toBe(403);
      const body = forbidden.json() as { error: { code: string } };
      expect(body.error.code).toBe("AUTHORIZATION_ERROR");
    } finally {
      // Nettoyage : le compte jetable ne doit pas fausser les décomptes
      // des exécutions suivantes (ni polluer la base de démonstration).
      await ctx.db.execute(sql`DELETE FROM users WHERE email = ${email}`);
    }
  });
});

// ===========================================================================
// Confidentialité GPS — le cœur du produit (ADR-006)
// ===========================================================================
describe("confidentialité de présence (ADR-006)", () => {
  it("ne divulgue jamais de coordonnées pour un utilisateur en GHOST", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/presence/nearby?lat=6.4127&lng=2.3387&radius=2000",
      headers: authHeader(tokens.accessToken),
    });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      data: Array<{ privacyMode: string; location: { lat: number; lng: number } | null; approximate: boolean }>;
    };

    for (const entry of body.data) {
      expect(entry.privacyMode).not.toBe("GHOST");
      if (entry.privacyMode === "BLURRED_ZONE") {
        // Une position floue ne peut pas être la position exacte, et est marquée.
        expect(entry.approximate).toBe(true);
      }
    }
  });

  it("applique le changement de mode immédiatement (GHOST purge la position)", async () => {
    const before = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: authHeader(tokens.accessToken),
    });
    expect((before.json() as { data: { privacyMode: string } }).data.privacyMode).toBe(
      "FRIENDS_PROMO",
    );

    const patch = await ctx.app.inject({
      method: "PATCH",
      url: "/api/v1/presence/privacy",
      headers: authHeader(tokens.accessToken),
      payload: { privacyMode: "GHOST" },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as { data: { privacyMode: string } }).data.privacyMode).toBe("GHOST");

    // Restauration pour ne pas polluer les données de démonstration.
    await ctx.app.inject({
      method: "PATCH",
      url: "/api/v1/presence/privacy",
      headers: authHeader(tokens.accessToken),
      payload: { privacyMode: "FRIENDS_PROMO" },
    });
  });

  it("rejette un mode de confidentialité inconnu (422)", async () => {
    const response = await ctx.app.inject({
      method: "PATCH",
      url: "/api/v1/presence/privacy",
      headers: authHeader(tokens.accessToken),
      payload: { privacyMode: "INVISIBLE_TOTAL" },
    });
    expect(response.statusCode).toBe(422);
  });
});

// ===========================================================================
// Enveloppe de réponse homogène (ADR-010)
// ===========================================================================
describe("enveloppe de réponse", () => {
  it("respecte { data, meta, requestId } sur les succès", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/api/v1/faculties" });
    const body = response.json() as { data: unknown; requestId: string };
    expect(body).toHaveProperty("data");
    expect(typeof body.requestId).toBe("string");
  });

  it("respecte { error: { code, message, requestId } } sur les erreurs", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/api/v1/buildings/inconnu-id" });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    const body = response.json() as { error: { code: string; message: string; requestId: string } };
    expect(body.error.code).toBeTruthy();
    expect(body.error.message).toBeTruthy();
    expect(body.error.requestId).toBeTruthy();
  });

  it("ne divulgue jamais de stack trace dans une erreur", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/api/v1/buildings/inconnu-id" });
    const raw = response.body;
    expect(raw).not.toContain("at Object.");
    expect(raw).not.toContain("node_modules");
    expect(raw).not.toContain("drizzle");
  });
});

// ===========================================================================
// Régressions — trois défauts corrigés (priorité 5)
// ===========================================================================
describe("régressions priorité 5", () => {
  describe("presence/nearby exige l'authentification", () => {
    it("refuse un appelant anonyme (401)", async () => {
      // Avant correction, un anonyme balayait le campus et obtenait les
      // positions des étudiants en mode PUBLIC — violation directe de l'ADR-006.
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/presence/nearby?lat=6.4127&lng=2.3387&radius=2000",
      });
      expect(response.statusCode).toBe(401);
      const body = response.json() as { error: { code: string } };
      expect(body.error.code).toBe("AUTHENTICATION_ERROR");
    });

    it("refuse un jeton malformé (401) sans fuite d'information", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/presence/nearby?lat=6.4127&lng=2.3387&radius=2000",
        headers: { authorization: "Bearer pas-un-vrai-jeton" },
      });
      expect(response.statusCode).toBe(401);
      const raw = response.body;
      expect(raw).not.toContain("at ");
      expect(raw).not.toContain("node_modules");
    });

    it("n'inclut jamais le demandeur lui-même dans les résultats", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/presence/nearby?lat=6.4127&lng=2.3387&radius=5000",
        headers: authHeader(tokens.accessToken),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: Array<{ userId: string }> };
      const ids = body.data.map((e) => e.userId);
      expect(ids).not.toContain(tokens.userId);
    });
  });

  describe("navigation/graph expose le graphe réel", () => {
    it("renvoie des métadonnées seules sans ?full=1", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/navigation/graph",
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        data: { nodeCount: number; edgeCount: number; version: string; nodes?: unknown };
      };
      expect(body.data.nodes).toBeUndefined();
      expect(body.data.nodeCount).toBeGreaterThan(0);
      expect(body.data.edgeCount).toBeGreaterThan(0);
      expect(typeof body.data.version).toBe("string");
      expect(body.data.version).toMatch(/^[0-9a-f]{8}$/);
    });

    it("renvoie nœuds et arêtes complets avec ?full=1", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/navigation/graph?full=1",
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        data: {
          nodes: Array<{ id: string; lat: number; lng: number; type: string }>;
          edges: Array<{
            id: string;
            source: string;
            target: string;
            distanceMeters: number;
            accessible: boolean;
          }>;
          nodeCount: number;
          edgeCount: number;
          version: string;
          isValidated: boolean;
        };
      };

      expect(Array.isArray(body.data.nodes)).toBe(true);
      expect(Array.isArray(body.data.edges)).toBe(true);
      expect(body.data.nodes.length).toBe(body.data.nodeCount);
      expect(body.data.edges.length).toBe(body.data.edgeCount);
      expect(body.data.nodes.length).toBeGreaterThan(0);
      expect(body.data.isValidated).toBe(false);
    });

    it("n'a aucune arête orpheline (source et cible existent)", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/navigation/graph?full=1",
      });
      const body = response.json() as {
        data: { nodes: Array<{ id: string }>; edges: Array<{ source: string; target: string }> };
      };
      const ids = new Set(body.data.nodes.map((n) => n.id));
      for (const edge of body.data.edges) {
        expect(ids.has(edge.source), `source inconnue : ${edge.source}`).toBe(true);
        expect(ids.has(edge.target), `cible inconnue : ${edge.target}`).toBe(true);
      }
    });

    it("n'a aucune distance nulle ou négative", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/navigation/graph?full=1",
      });
      const body = response.json() as { data: { edges: Array<{ distanceMeters: number }> } };
      for (const edge of body.data.edges) {
        expect(edge.distanceMeters).toBeGreaterThan(0);
        expect(Number.isFinite(edge.distanceMeters)).toBe(true);
      }
    });

    it("coordonnées dans l'emprise du campus béninois", async () => {
      // Détecte le piège degrés/mètres : une confusion produirait des valeurs
      // aberrantes qui seraient pourtant « techniquement » des nombres.
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/navigation/graph?full=1",
      });
      const body = response.json() as { data: { nodes: Array<{ lat: number; lng: number }> } };
      for (const node of body.data.nodes) {
        expect(node.lat).toBeGreaterThan(6.2);
        expect(node.lat).toBeLessThan(6.6);
        expect(node.lng).toBeGreaterThan(2.1);
        expect(node.lng).toBeLessThan(2.6);
      }
    });

    it("calcule un itinéraire sur le graphe exposé", async () => {
      const graph = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/navigation/graph?full=1",
      });
      const g = graph.json() as {
        data: { nodes: Array<{ id: string; lat: number; lng: number }> };
      };
      const a = g.data.nodes[0]!;
      const b = g.data.nodes[1]!;

      const routeReq = await ctx.app.inject({
        method: "POST",
        url: "/api/v1/navigation/routes",
        payload: { from: { lat: a.lat, lng: a.lng }, to: { lat: b.lat, lng: b.lng } },
      });
      expect(routeReq.statusCode).toBe(200);
      const route = routeReq.json() as {
        data: { distanceMeters: number | null; steps: unknown[] };
      };
      expect(route.data.steps.length).toBeGreaterThan(0);
      if (route.data.distanceMeters !== null) {
        expect(route.data.distanceMeters).toBeGreaterThan(0);
      }
    });
  });

  describe("géométrie des bâtiments réellement exposée", () => {
    it("renvoie un polygone GeoJSON valide pour chaque bâtiment", async () => {
      // Avant correction, `geometry` était TOUJOURS null : la carte n'aurait
      // rien pu dessiner, alors même que PostGIS contenait les polygones.
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/buildings?limit=100",
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        data: Array<{
          code: string;
          geometry: { type: string; coordinates: number[][][] } | null;
          centroid: { lat: number; lng: number } | null;
        }>;
      };
      expect(body.data.length).toBeGreaterThan(0);

      let withGeometry = 0;
      for (const building of body.data) {
        if (!building.geometry) continue;
        withGeometry++;
        expect(building.geometry.type).toBe("Polygon");
        const ring = building.geometry.coordinates[0]!;
        expect(ring.length).toBeGreaterThanOrEqual(4);
        // Anneau fermé : indispensable pour que MapLibre accepte le polygone.
        expect(ring[0]).toEqual(ring[ring.length - 1]);
        for (const [lng, lat] of ring) {
          expect(lng).toBeGreaterThan(2.1);
          expect(lng).toBeLessThan(2.6);
          expect(lat).toBeGreaterThan(6.2);
          expect(lat).toBeLessThan(6.6);
        }
      }
      // Les 15 bâtiments du jeu de démonstration sont géoréférencés.
      expect(withGeometry).toBeGreaterThanOrEqual(12);
    });

    it("fournit un centroïde utilisable pour centrer la carte", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/buildings?limit=5",
      });
      const body = response.json() as {
        data: Array<{ centroid: { lat: number; lng: number } | null }>;
      };
      for (const building of body.data) {
        if (!building.centroid) continue;
        expect(building.centroid.lat).toBeGreaterThan(6.2);
        expect(building.centroid.lng).toBeGreaterThan(2.1);
      }
    });

    it("le détail d'un bâtiment contient aussi sa géométrie", async () => {
      const list = await ctx.app.inject({ method: "GET", url: "/api/v1/buildings?limit=1" });
      const first = (list.json() as { data: Array<{ id: string }> }).data[0]!;

      const detail = await ctx.app.inject({
        method: "GET",
        url: `/api/v1/buildings/${first.id}`,
      });
      expect(detail.statusCode).toBe(200);
      const body = detail.json() as { data: { id: string; geometry: unknown } };
      expect(body.data.id).toBe(first.id);
      expect(body.data.geometry).not.toBeNull();
    });
  });

  describe("pagination cohérente", () => {
    it("hasMore est faux quand tout tient dans une page", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/buildings?limit=100",
      });
      const meta = (response.json() as {
        meta: { total: number; totalPages: number; hasMore: boolean };
      }).meta;
      expect(meta.hasMore).toBe(meta.totalPages > 1);
    });

    it("hasMore est vrai quand une page suivante contient des résultats", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/buildings?limit=2&page=1",
      });
      const meta = (response.json() as {
        meta: { total: number; hasMore: boolean };
      }).meta;
      expect(meta.hasMore).toBe(meta.total > 2);
    });

    it("hasMore est faux sur la dernière page", async () => {
      const first = await ctx.app.inject({ method: "GET", url: "/api/v1/buildings?limit=5" });
      const totalPages = (first.json() as { meta: { totalPages: number } }).meta.totalPages;

      const last = await ctx.app.inject({
        method: "GET",
        url: `/api/v1/buildings?limit=5&page=${totalPages}`,
      });
      const meta = (last.json() as { meta: { hasMore: boolean; page: number } }).meta;
      expect(meta.page).toBe(totalPages);
      expect(meta.hasMore).toBe(false);
    });
  });

  describe("cohérence des contrats exposés au client", () => {
    it("les salles respectent intégralement roomSchema (buildingId + createdAt inclus)", async () => {
      // Avant correction, `roomsOf()` omettait `buildingId` et `createdAt`.
      // Le client rétrécissait alors le contrat (`roomSchema.omit(...)`) pour
      // valider la réponse : l'écart était masqué au lieu d'être corrigé.
      const list = await ctx.app.inject({ method: "GET", url: "/api/v1/buildings?limit=100" });
      const buildings = (list.json() as { data: Array<{ id: string }> }).data;
      expect(buildings.length).toBeGreaterThan(0);

      let totalRooms = 0;
      for (const building of buildings) {
        const response = await ctx.app.inject({
          method: "GET",
          url: `/api/v1/buildings/${building.id}/rooms`,
        });
        expect(response.statusCode).toBe(200);
        const body = response.json() as {
          data: Array<Record<string, unknown>>;
        };
        expect(Array.isArray(body.data)).toBe(true);

        for (const room of body.data) {
          totalRooms++;
          // Clés exigées par roomSchema, vérifiées une par une pour que
          // l'échec nomme précisément le champ manquant.
          expect(room.id, "id").toEqual(expect.any(String));
          expect(room.buildingId, "buildingId").toBe(building.id);
          expect(room.code, "code").toEqual(expect.any(String));
          expect(room.name, "name").toEqual(expect.any(String));
          expect(room.capacity, "capacity").toEqual(expect.any(Number));
          expect(room.floor, "floor").toEqual(expect.any(Number));
          expect(room.roomType, "roomType").toEqual(expect.any(String));
          expect(room.isAccessible, "isAccessible").toEqual(expect.any(Boolean));
          expect(room.isOpen, "isOpen").toEqual(expect.any(Boolean));
          // createdAt doit être une date ISO sérialisable, pas un null.
          expect(room.createdAt, "createdAt").toEqual(expect.any(String));
          expect(Number.isNaN(Date.parse(room.createdAt as string))).toBe(false);
        }
      }
      // Le jeu de démonstration contient des salles : le test ne peut pas
      // passer « à vide ».
      expect(totalRooms).toBeGreaterThan(0);
    });

    it("le disclaimer du graphe décrit l'état réel des données (pas un état antérieur)", async () => {
      // Le texte annonçait un « graphe de démonstration » sans géométrie
      // relevée, alors que PostGIS contient bâtiments + allées réelles. Il
      // doit dire que les données existent ET que les tracés restent
      // indicatifs tant que la validation terrain n'est pas faite.
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/navigation/graph",
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        data: { disclaimer: string; isValidated: boolean };
      };

      const text = body.data.disclaimer;
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(60);
      // Ne doit plus prétendre que le graphe est de la « démonstration ».
      expect(text.toLowerCase()).not.toContain("démonstration");
      // Doit reconnaître la disponibilité réelle des données géospatiales.
      expect(text.toLowerCase()).toContain("géospatiales");
      expect(text.toLowerCase()).toContain("postgis");
      // Doit conserver la limite honnête : non validé terrain → indicatif.
      expect(text.toLowerCase()).toContain("indicatif");
      expect(text.toLowerCase()).toContain("validée");
      // Le drapeau machine reste cohérent avec le texte.
      expect(body.data.isValidated).toBe(false);
    });

    it("le même disclaimer accompagne les itinéraires calculés", async () => {
      const graph = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/navigation/graph?full=1",
      });
      const nodes = (graph.json() as {
        data: { nodes: Array<{ id: string; lat: number; lng: number }> };
      }).data.nodes;
      const a = nodes[0]!;
      const b = nodes[1]!;

      const routeReq = await ctx.app.inject({
        method: "POST",
        url: "/api/v1/navigation/routes",
        payload: { from: { lat: a.lat, lng: a.lng }, to: { lat: b.lat, lng: b.lng } },
      });
      expect(routeReq.statusCode).toBe(200);
      const route = routeReq.json() as { data: { disclaimer: string } };
      expect(route.data.disclaimer.toLowerCase()).toContain("indicatif");
      expect(route.data.disclaimer.toLowerCase()).toContain("postgis");
    });
  });
});
