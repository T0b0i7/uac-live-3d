/**
 * Enregistrement des routes — apps/server/src/routes/index.ts
 * Toutes les routes sont préfixées par /api/v1 (sauf /health).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, count, desc, eq, sql } from "drizzle-orm";
import {
  auditLogs,
  buildings,
  contributions,
  faculties,
  notifications,
  reports,
  rooms,
  users,
} from "@uac/database";
import {
  buildingsQuerySchema,
  createReportBodySchema,
  loginBodySchema,
  nearbyQuerySchema,
  registerBodySchema,
  reportsQuerySchema,
  routeRequestSchema,
  updatePresenceBodySchema,
  updatePrivacyBodySchema,
  verifyBuildingBodySchema,
  updateProfileBodySchema,
} from "@uac/contracts";
import { AuthenticationError, buildPaginationMeta } from "@uac/shared";
import { parseBody, parseQuery, requireAuthOrNull, clientIp, idempotencyKey } from "../common/request.js";
import { hashIp, maskMatricule } from "../common/security.js";
import { AuthService } from "../modules/identity/auth.service.js";
import { PresenceService } from "../modules/presence/presence.service.js";
import { BuildingsService } from "../modules/buildings/buildings.service.js";
import { ReportsService } from "../modules/reports/reports.service.js";
import { NavigationService } from "../modules/navigation/navigation.service.js";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;
  const auth = new AuthService(db, app.jwt as never);
  const presence = new PresenceService(db);
  const buildingsService = new BuildingsService(db);
  const reportsService = new ReportsService(db);
  const navigation = new NavigationService(db);

  // =========================================================================
  // Santé
  // =========================================================================
  app.get("/health", async () => {
    let database = "down";
    let postgis: string | null = null;
    try {
      await db.execute(sql`SELECT 1`);
      database = "up";
      const rows = await db.execute<{ v: string }>(sql`SELECT PostGIS_Version() AS v`);
      postgis = (rows as unknown as Array<{ v: string }>)[0]?.v?.split(" ")[0] ?? null;
    } catch {
      database = "down";
    }

    return {
      status: database === "up" ? "ok" : "degraded",
      service: "uac-live-3d-api",
      version: "1.0.0",
      database,
      postgis,
      redis: app.cache?.backend ?? "memory",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  });

  // =========================================================================
  // Authentification
  // =========================================================================
  app.post("/api/v1/auth/register", {
    config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    const body = parseBody(request, registerBodySchema);
    const result = await auth.register(body);
    return reply.status(201).send({
      data: { user: result.user, tokens: result.tokens },
      requestId: request.id,
    });
  });

  app.post("/api/v1/auth/login", {
    config: { rateLimit: { max: 12, timeWindow: "5 minutes" } },
  }, async (request) => {
    const body = parseBody(request, loginBodySchema);
    const result = await auth.login(body);
    return { data: { user: result.user, tokens: result.tokens }, requestId: request.id };
  });

  app.post("/api/v1/auth/refresh", async (request) => {
    const body = request.body as { refreshToken?: string } | undefined;
    if (!body?.refreshToken) {
      throw new AuthenticationError("Jeton de rafraîchissement manquant.");
    }
    const tokens = await auth.refresh(body.refreshToken);
    return { data: { tokens }, requestId: request.id };
  });

  app.post("/api/v1/auth/logout", async (request) => {
    const current = requireAuthOrNull(request);
    const body = request.body as { refreshToken?: string } | undefined;
    await auth.logout(body?.refreshToken, current?.userId);
    return { data: { loggedOut: true }, requestId: request.id };
  });

  app.get("/api/v1/auth/me", { preHandler: [app.authenticate] }, async (request) => {
    const current = requireAuthOrNull(request)!;
    const rows = await db
      .select({ user: users, facultyName: faculties.name })
      .from(users)
      .leftJoin(faculties, eq(faculties.id, users.facultyId))
      .where(eq(users.id, current.userId))
      .limit(1);

    if (rows.length === 0) throw new AuthenticationError("Compte introuvable.");
    const { user, facultyName } = rows[0]!;

    return {
      data: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarSeed: user.avatarSeed,
        facultyId: user.facultyId,
        facultyName,
        department: user.department,
        level: user.level,
        bio: user.bio,
        role: user.role,
        karma: user.karma,
        matriculeMasked: maskMatricule(user.matricule),
        matricule: user.matricule,
        privacyMode: user.privacyMode,
        createdAt: user.createdAt.toISOString(),
        isVerified: user.isVerified,
        onboardingCompleted: user.onboardingCompleted,
      },
      requestId: request.id,
    };
  });

  // =========================================================================
  // Utilisateurs
  // =========================================================================
  app.patch("/api/v1/users/me", { preHandler: [app.authenticate] }, async (request) => {
    const current = requireAuthOrNull(request)!;
    const body = parseBody(request, updateProfileBodySchema);

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.fullName !== undefined) updates.fullName = body.fullName;
    if (body.bio !== undefined) updates.bio = body.bio;
    if (body.avatarSeed !== undefined) updates.avatarSeed = body.avatarSeed;
    if (body.department !== undefined) updates.department = body.department;
    if (body.level !== undefined) updates.level = body.level;

    await db.update(users).set(updates).where(eq(users.id, current.userId));
    return { data: { updated: true }, requestId: request.id };
  });

  app.get("/api/v1/users/:id", async (request) => {
    const { id } = request.params as { id: string };
    const rows = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        avatarSeed: users.avatarSeed,
        facultyId: users.facultyId,
        facultyName: faculties.name,
        department: users.department,
        level: users.level,
        bio: users.bio,
        role: users.role,
        karma: users.karma,
        privacyMode: users.privacyMode,
        createdAt: users.createdAt,
        matricule: users.matricule,
      })
      .from(users)
      .leftJoin(faculties, eq(faculties.id, users.facultyId))
      .where(and(eq(users.id, id), eq(users.isActive, true)))
      .limit(1);

    if (rows.length === 0) {
      const { NotFoundError } = await import("@uac/shared");
      throw new NotFoundError("Utilisateur");
    }
    const row = rows[0]!;

    // Le matricule complet n'est JAMAIS renvoyé sur un profil public.
    return {
      data: {
        id: row.id,
        fullName: row.fullName,
        avatarSeed: row.avatarSeed,
        facultyId: row.facultyId,
        facultyName: row.facultyName,
        department: row.department,
        level: row.level,
        bio: row.bio,
        role: row.role,
        karma: row.karma,
        matriculeMasked: maskMatricule(row.matricule),
        privacyMode: row.privacyMode,
        createdAt: row.createdAt.toISOString(),
      },
      requestId: request.id,
    };
  });

  // =========================================================================
  // Bâtiments
  // =========================================================================
  app.get("/api/v1/buildings", async (request) => {
    const query = parseQuery(request, buildingsQuerySchema);
    const result = await buildingsService.list(query);
    return { data: result.items, meta: result.meta, requestId: request.id };
  });

  /**
   * Emprises pour la carte — toutes, sans pagination.
   *
   * Doit être déclarée AVANT `/api/v1/buildings/:id`, sinon Fastify
   * interpréterait « map » comme un identifiant de bâtiment.
   *
   * Une carte n'est pas une liste : paginer produisait des trous visuels
   * silencieux (100 emprises affichées sur 360).
   */
  app.get("/api/v1/buildings/map", async (request) => {
    const items = await buildingsService.mapFeatures();
    return {
      data: items,
      meta: {
        total: items.length,
        georeferenced: items.filter((b) => b.isGeoreferenced).length,
        // Aucune pagination : le champ est nommé explicitement pour qu'aucun
        // client ne croie à une page tronquée.
        paginated: false,
      },
      requestId: request.id,
    };
  });

  /**
   * Compteurs globaux du référentiel — agrégés en base, pas sur une page.
   *
   * Déclarée AVANT `/:id` pour la même raison que `/map` : sinon « stats »
   * serait interprété comme un identifiant de bâtiment.
   */
  app.get("/api/v1/buildings/stats", async (request) => {
    const stats = await buildingsService.stats();
    return { data: stats, requestId: request.id };
  });

  app.get("/api/v1/buildings/:id", async (request) => {
    const { id } = request.params as { id: string };
    return { data: await buildingsService.byId(id), requestId: request.id };
  });

  app.get("/api/v1/buildings/:id/rooms", async (request) => {
    const { id } = request.params as { id: string };
    return { data: await buildingsService.roomsOf(id), requestId: request.id };
  });

  app.get("/api/v1/buildings/:id/history", async (request) => {
    const { id } = request.params as { id: string };
    return { data: await buildingsService.history(id), requestId: request.id };
  });

  app.post("/api/v1/buildings/:id/verify", {
    preHandler: [app.requireRole("CONTRIBUTOR")],
  }, async (request) => {
    const current = requireAuthOrNull(request)!;
    const { id } = request.params as { id: string };
    const body = parseBody(request, verifyBuildingBodySchema);
    return {
      data: await buildingsService.verify(id, body, current.userId),
      requestId: request.id,
    };
  });

  // =========================================================================
  // Facultés
  // =========================================================================
  app.get("/api/v1/faculties", async (request) => {
    // Agrégation par jointure + GROUP BY plutôt qu'une sous-requête corrélée :
    // plus lisible et sans dépendance à la façon dont Drizzle qualifie les colonnes.
    const rows = await db
      .select({
        id: faculties.id,
        code: faculties.code,
        name: faculties.name,
        shortName: faculties.shortName,
        description: faculties.description,
        createdAt: faculties.createdAt,
        buildingCount: sql<number>`count(${buildings.id})::int`,
      })
      .from(faculties)
      .leftJoin(
        buildings,
        and(eq(buildings.facultyId, faculties.id), sql`${buildings.deletedAt} IS NULL`),
      )
      .groupBy(
        faculties.id,
        faculties.code,
        faculties.name,
        faculties.shortName,
        faculties.description,
        faculties.createdAt,
      )
      .orderBy(faculties.code);

    return {
      data: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      requestId: request.id,
    };
  });

  app.get("/api/v1/faculties/:id/buildings", async (request) => {
    const { id } = request.params as { id: string };
    const result = await buildingsService.list({
      page: 1,
      limit: 50,
      facultyId: id,
    } as never);
    return { data: result.items, meta: result.meta, requestId: request.id };
  });

  // =========================================================================
  // Navigation
  // =========================================================================
  app.post("/api/v1/navigation/routes", async (request) => {
    const body = parseBody(request, routeRequestSchema);
    return { data: await navigation.route(body), requestId: request.id };
  });

  /**
   * Graphe piéton complet. `?full=1` renvoie nœuds + arêtes (nécessaire au
   * calcul d'itinéraire côté client et au cache hors ligne) ; sans ce drapeau
   * on ne renvoie que les métadonnées, pour ne pas charger inutilement.
   */
  app.get("/api/v1/navigation/graph", async (request) => {
    const query = request.query as { full?: string };
    const wantsFull = query.full === "1" || query.full === "true";

    if (!wantsFull) {
      return { data: await navigation.graphMetadata(), requestId: request.id };
    }

    const graph = await navigation.fullGraph();
    return {
      data: {
        nodes: graph.nodes,
        edges: graph.edges,
        ...graph.metadata,
      },
      requestId: request.id,
    };
  });

  app.get("/api/v1/navigation/destinations", async (request) => ({
    data: await navigation.destinations(),
    requestId: request.id,
  }));

  // =========================================================================
  // Présence
  // =========================================================================
  /**
   * Proximité — AUTHENTIFICATION OBLIGATOIRE.
   *
   * La version précédente acceptait un appelant anonyme : n'importe qui pouvait
   * balayer le campus et obtenir les positions des étudiants en mode PUBLIC.
   * C'est exactement ce que l'ADR-006 interdit. La confidentialité ne peut pas
   * dépendre d'un identifiant absent : sans observateur identifié, il n'y a
   * aucune relation d'amitié possible, donc aucune divulgation légitime.
   */
  app.get("/api/v1/presence/nearby", { preHandler: [app.authenticate] }, async (request) => {
    const current = requireAuthOrNull(request)!;
    const query = parseQuery(request, nearbyQuerySchema);

    // Le demandeur ne doit pas pouvoir se voir lui-même dans les résultats :
    // `nearby` l'exclut déjà, on le vérifie dans les tests de régression.
    return {
      data: await presence.nearby(current.userId, query),
      requestId: request.id,
    };
  });

  app.patch("/api/v1/presence/privacy", { preHandler: [app.authenticate] }, async (request) => {
    const current = requireAuthOrNull(request)!;
    const body = parseBody(request, updatePrivacyBodySchema);
    await presence.updatePrivacy(current.userId, body.privacyMode);
    return { data: { privacyMode: body.privacyMode }, requestId: request.id };
  });

  app.patch("/api/v1/presence/status", { preHandler: [app.authenticate] }, async (request) => {
    const current = requireAuthOrNull(request)!;
    const body = parseBody(request, updatePresenceBodySchema);
    return {
      data: await presence.updatePresence(current.userId, body),
      requestId: request.id,
    };
  });

  // =========================================================================
  // Signalements
  // =========================================================================
  app.get("/api/v1/reports", async (request) => {
    const current = requireAuthOrNull(request);
    const query = parseQuery(request, reportsQuerySchema);
    const result = await reportsService.list(query, current?.userId ?? null);
    return { data: result.items, meta: result.meta, requestId: request.id };
  });

  app.get("/api/v1/reports/:id", async (request) => {
    const current = requireAuthOrNull(request);
    const { id } = request.params as { id: string };
    return { data: await reportsService.byId(id, current?.userId ?? null), requestId: request.id };
  });

  app.post("/api/v1/reports", { preHandler: [app.authenticate] }, async (request, reply) => {
    const current = requireAuthOrNull(request)!;
    const body = parseBody(request, createReportBodySchema);
    const opId = idempotencyKey(request);
    const result = await reportsService.create(body, current.userId, opId);

    // Journal d'audit avec idempotence (ADR-007).
    await db
      .insert(auditLogs)
      .values({
        actorId: current.userId,
        action: "REPORT_CREATED",
        targetType: "REPORT",
        targetId: result.report.id,
        operationId: opId,
        ipHash: hashIp(clientIp(request), app.config.ipHashSalt),
      })
      .onConflictDoNothing();

    // Diffusion temps réel : le hub filtre par room (staff + faculté du bâtiment).
    // Un duplicata n'est PAS rediffusé — sinon un rejeu hors ligne ferait clignoter
    // deux fois la carte de tous les étudiants.
    if (!result.wasDuplicate) {
      app.realtime?.broadcastReport(result.report);
    }

    return reply.status(result.wasDuplicate ? 200 : 201).send({
      data: result.report,
      meta: { duplicate: result.wasDuplicate },
      requestId: request.id,
    });
  });

  app.post("/api/v1/reports/:id/vote", { preHandler: [app.authenticate] }, async (request) => {
    const current = requireAuthOrNull(request)!;
    const { id } = request.params as { id: string };
    const body = parseBody(request, z.object({ vote: z.union([z.literal(1), z.literal(-1)]) }));
    return { data: await reportsService.vote(id, current.userId, body.vote), requestId: request.id };
  });

  app.post("/api/v1/reports/:id/resolve", { preHandler: [app.authenticate] }, async (request) => {
    const current = requireAuthOrNull(request)!;
    const { id } = request.params as { id: string };
    return {
      data: await reportsService.resolve(id, current.userId, current.role),
      requestId: request.id,
    };
  });

  app.get("/api/v1/reports/:id/comments", async (request) => {
    const { id } = request.params as { id: string };
    return { data: await reportsService.comments(id), requestId: request.id };
  });

  app.post("/api/v1/reports/:id/comments", { preHandler: [app.authenticate] }, async (request, reply) => {
    const current = requireAuthOrNull(request)!;
    const { id } = request.params as { id: string };
    const body = parseBody(request, z.object({ body: z.string().min(1).max(1000) }));
    const result = await reportsService.comment(id, current.userId, body.body);
    return reply.status(201).send({ data: result, requestId: request.id });
  });

  app.delete("/api/v1/reports/:id", { preHandler: [app.authenticate] }, async (request) => {
    const current = requireAuthOrNull(request)!;
    const { id } = request.params as { id: string };
    await reportsService.softDelete(id, current.userId, current.role);
    return { data: { deleted: true }, requestId: request.id };
  });

  // =========================================================================
  // Notifications
  // =========================================================================
  app.get("/api/v1/notifications", { preHandler: [app.authenticate] }, async (request) => {
    const current = requireAuthOrNull(request)!;
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, current.userId))
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    return {
      data: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        read: n.read,
        actionUrl: n.actionUrl,
        createdAt: n.createdAt.toISOString(),
      })),
      requestId: request.id,
    };
  });

  app.patch("/api/v1/notifications/read-all", { preHandler: [app.authenticate] }, async (request) => {
    const current = requireAuthOrNull(request)!;
    const result = await db
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(and(eq(notifications.userId, current.userId), eq(notifications.read, false)))
      .returning({ id: notifications.id });
    return { data: { updated: result.length }, requestId: request.id };
  });

  // =========================================================================
  // Administration
  // =========================================================================
  app.get("/api/v1/admin/dashboard", { preHandler: [app.requireRole("MODERATOR")] }, async (request) => {
    const [userCount, studentCount, buildingCount, verifiedCount, pendingContrib, activeSos] =
      await Promise.all([
        db.select({ v: count() }).from(users),
        db.select({ v: count() }).from(users).where(eq(users.role, "STUDENT")),
        db.execute<{ v: string }>(sql`SELECT count(*)::text AS v FROM buildings WHERE deleted_at IS NULL`),
        db.execute<{ v: string }>(sql`SELECT count(*)::text AS v FROM buildings WHERE verification_status = 'VERIFIED' AND deleted_at IS NULL`),
        db.select({ v: count() }).from(contributions).where(eq(contributions.status, "PENDING")),
        db.execute<{ v: string }>(sql`SELECT count(*)::text AS v FROM sos_alerts WHERE status = 'ACTIVE'`),
      ]);

    const activeReports = await reportsService.activeCount();
    const breakdown = await presence.privacyBreakdown();

    const recentAudit = await db
      .select({
        at: auditLogs.createdAt,
        action: auditLogs.action,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        actorName: users.fullName,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(10);

    const raw = (r: unknown): number => Number((r as Array<{ v: string }>)[0]?.v ?? 0);

    return {
      data: {
        totals: {
          users: Number(userCount[0]?.v ?? 0),
          students: Number(studentCount[0]?.v ?? 0),
          buildings: raw(buildingCount),
          verifiedBuildings: raw(verifiedCount),
          activeReports,
          activeSos: raw(activeSos),
          pendingContributions: Number(pendingContrib[0]?.v ?? 0),
        },
        presence: breakdown,
        recent: recentAudit.map((r) => ({
          at: r.at.toISOString(),
          actor: r.actorName ?? "système",
          action: r.action,
          target: r.targetId,
        })),
      },
      requestId: request.id,
    };
  });

  app.get("/api/v1/admin/contributions", { preHandler: [app.requireRole("MODERATOR")] }, async (request) => {
    const rows = await db
      .select({
        id: contributions.id,
        targetType: contributions.targetType,
        targetId: contributions.targetId,
        status: contributions.status,
        payload: contributions.payload,
        createdAt: contributions.createdAt,
        authorName: users.fullName,
      })
      .from(contributions)
      .innerJoin(users, eq(users.id, contributions.authorId))
      .orderBy(desc(contributions.createdAt))
      .limit(50);

    return {
      data: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      requestId: request.id,
    };
  });

  app.get("/api/v1/admin/audit-logs", { preHandler: [app.requireRole("ADMIN")] }, async (request) => {
    const rows = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        createdAt: auditLogs.createdAt,
        ipHash: auditLogs.ipHash,
        actorName: users.fullName,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);

    return {
      data: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), metadata: null })),
      requestId: request.id,
    };
  });

  // =========================================================================
  // Divers
  // =========================================================================
  app.get("/api/v1/rooms", async (request) => {
    const rows = await db.select().from(rooms).limit(100);
    return {
      data: rows.map((r) => ({
        id: r.id,
        buildingId: r.buildingId,
        code: r.code,
        name: r.name,
        capacity: r.capacity,
        floor: r.floor,
        roomType: r.roomType,
        isAccessible: r.isAccessible,
        isOpen: r.isOpen,
        createdAt: r.createdAt.toISOString(),
      })),
      requestId: request.id,
    };
  });

  app.get("/api/v1/stats/overview", async (request) => {
    const rows = await db.execute<{ students: string; buildings: string; active: string }>(sql`
      SELECT
        (SELECT count(*)::text FROM users WHERE is_active) AS students,
        (SELECT count(*)::text FROM buildings WHERE deleted_at IS NULL) AS buildings,
        (SELECT count(*)::text FROM user_presence WHERE share_expires_at > now()) AS active
    `);
    const row = (rows as unknown as Array<{ students: string; buildings: string; active: string }>)[0];
    return {
      data: {
        students: Number(row?.students ?? 0),
        buildings: Number(row?.buildings ?? 0),
        activePresences: Number(row?.active ?? 0),
      },
      requestId: request.id,
    };
  });

  void buildPaginationMeta;
  void reportsQuerySchema;
}
