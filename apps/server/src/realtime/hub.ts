/**
 * Hub temps réel — apps/server/src/realtime/hub.ts
 *
 * Responsabilités :
 *  1. Authentifier le handshake (JWT) et charger un état FRAIS depuis la base
 *     (rôle, faculté, activation) plutôt que de faire confiance au jeton.
 *  2. Gérer les rooms (privée, zone, faculté, staff).
 *  3. Diffuser les positions **filtrées par destinataire**.
 *
 * Règle non négociable : on n'émet JAMAIS `presence:update` en broadcast de
 * room. Chaque socket reçoit sa propre projection de la position, calculée par
 * `applyPrivacyPolicy`. Une room Socket.IO ne contient donc jamais de données
 * qui ne soient pas déjà autorisées pour tous ses membres.
 */

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Server as HttpServer } from "node:http";
import type { FastifyBaseLogger } from "fastify";
import { Server as SocketServer, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import type { Redis as RedisClient } from "ioredis";
import type { Database } from "@uac/database";
import { buildings, faculties, friends, userPresence, users } from "@uac/database";
import { hasRole, type PrivacyMode, type PresenceStatus, type Role } from "@uac/shared";
import type { Notification, Report, SosAlert } from "@uac/contracts";
import type { AppConfig } from "../config/env.js";
import { NotificationsService, type NotifyInput } from "../modules/notifications/notifications.service.js";
import { PresenceService } from "../modules/presence/presence.service.js";
import { applyPrivacyPolicy, isPresenceHidden } from "../modules/presence/privacy.policy.js";
import { SosService, SOS_DISCLAIMER } from "../modules/sos/sos.service.js";
import {
  facultyRoom,
  neighbourZoneKeys,
  ROOM_STAFF,
  userRoom,
  zoneKeyOf,
  type ClientToServerEvents,
  type HeartbeatAck,
  type InterServerEvents,
  type PresenceBroadcastEntry,
  type PresenceSnapshot,
  type ServerToClientEvents,
  type SocketData,
  type SosAck,
} from "./protocol.js";

type IoServer = SocketServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/** Socket authentifié du hub — typé sur notre protocole, pas sur `any`. */
type HubSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export interface RealtimeHubOptions {
  db: Database;
  config: AppConfig;
  logger: FastifyBaseLogger;
  pubClient: RedisClient | null;
  subClient: RedisClient | null;
  /**
   * Vérificateur de jeton fourni par l'application (`app.jwt.verify`).
   * On ne réimplémente PAS la vérification HS256 ici : une seule implémentation
   * de la validation des jetons doit exister dans le système, sinon les deux
   * finissent par diverger (algorithmes acceptés, marge d'horloge, audience).
   */
  verifyToken: (token: string) => { sub: string; role: string; email: string } | null;
  /** Intervalle de purge/expiration, en ms. 0 désactive le worker. */
  expirySweepMs?: number;
}

export class RealtimeHub {
  readonly io: IoServer;
  private readonly presence: PresenceService;
  private readonly sos: SosService;
  private readonly notifications: NotificationsService;
  private readonly db: Database;
  private sweepTimer: NodeJS.Timeout | null = null;
  private readonly logger: FastifyBaseLogger;

  constructor(private readonly options: RealtimeHubOptions) {
    this.db = options.db;
    this.logger = options.logger;
    this.presence = new PresenceService(options.db);
    this.sos = new SosService(options.db);
    this.notifications = new NotificationsService(options.db);

    this.io = new SocketServer<
      ClientToServerEvents,
      ServerToClientEvents,
      InterServerEvents,
      SocketData
    >({
      path: options.config.socketPath,
      serveClient: false,
      cors: {
        origin: options.config.corsOrigins,
        credentials: true,
      },
      // Le handshake doit être authentifié : on laisse 20 s au client pour
      // présenter un jeton, au-delà la connexion est coupée.
      connectTimeout: 20_000,
      pingInterval: 25_000,
      pingTimeout: 20_000,
      maxHttpBufferSize: 1e5,
    });

    // Adaptateur Redis : sans lui, deux instances du serveur ne se voient pas
    // et un utilisateur connecté sur l'instance B ne recevrait pas les alertes
    // émises depuis l'instance A (ADR-008).
    if (options.pubClient && options.subClient) {
      this.io.adapter(createAdapter(options.pubClient, options.subClient));
      this.logger.info("Socket.IO : adaptateur Redis branché (multi-instance).");
    } else {
      this.logger.warn(
        "Socket.IO : sans Redis, le temps réel est limité à cette instance. " +
          "Une diffusion entre instances ne fonctionnera pas.",
      );
    }

    this.registerHandlers();
  }

  // =========================================================================
  // Cycle de vie
  // =========================================================================

  attach(httpServer: HttpServer): void {
    this.io.attach(httpServer);

    const sweepMs = this.options.expirySweepMs ?? 60_000;
    if (sweepMs > 0) {
      this.sweepTimer = setInterval(() => {
        void this.sweepExpired();
      }, sweepMs);
      this.sweepTimer.unref?.();
    }
  }

  async close(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    await new Promise<void>((resolve) => {
      void this.io.close(() => resolve());
    });
  }

  /** Nombre de sockets actuellement connectés (diagnostic, tests). */
  get onlineCount(): number {
    return this.io.sockets.sockets.size;
  }

  // =========================================================================
  // Authentification du handshake
  // =========================================================================

  private registerHandlers(): void {
    this.io.use(async (socket, next) => {
      try {
        const token = extractToken(socket);
        if (!token) {
          next(new Error("AUTH_REQUIRED"));
          return;
        }

        // Signature vérifiée par `app.jwt.verify` — même implémentation que l'API HTTP.
        const payload = this.options.verifyToken(token);
        if (!payload) {
          next(new Error("INVALID_TOKEN"));
          return;
        }

        // État relu en base : un rôle rétrogradé ou un compte désactivé doit
        // perdre l'accès immédiatement, sans attendre l'expiration du jeton.
        const rows = await this.db
          .select({
            id: users.id,
            role: users.role,
            email: users.email,
            facultyId: users.facultyId,
            isActive: users.isActive,
          })
          .from(users)
          .where(eq(users.id, payload.sub))
          .limit(1);

        const user = rows[0];
        if (!user || !user.isActive) {
          next(new Error("ACCOUNT_INACTIVE"));
          return;
        }

        socket.data = {
          userId: user.id,
          role: user.role as Role,
          email: user.email,
          facultyId: user.facultyId,
          connectedAt: Date.now(),
        };

        next();
      } catch {
        next(new Error("AUTH_FAILED"));
      }
    });

    this.io.on("connection", (socket) => {
      const { userId, role, facultyId } = socket.data;

      // Rooms systématiques.
      void socket.join(userRoom(userId));
      if (facultyId) void socket.join(facultyRoom(facultyId));
      if (hasRole(role, "MODERATOR")) void socket.join(ROOM_STAFF);

      this.logger.debug?.(`Socket ${socket.id} connecté (user ${userId}, rôle ${role}).`);

      socket.on("presence:subscribe", (payload) => {
        void this.handleSubscribe(socket, payload);
      });

      socket.on("presence:unsubscribe", () => {
        void this.handleUnsubscribe(socket);
      });

      socket.on("presence:heartbeat", (ack) => {
        void this.handleHeartbeat(userId, socket.id, ack);
      });

      socket.on("report:subscribe", () => {
        // Les signalements ne contiennent aucune donnée personnelle : on peut
        // les diffuser par room de faculté sans filtrage individuel.
        if (facultyId) void socket.join(facultyRoom(facultyId));
      });

      socket.on("sos:create", (payload, ack) => {
        void this.handleSosCreate(socket, payload, ack);
      });

      socket.on("disconnect", (reason) => {
        this.logger.debug?.(`Socket ${socket.id} déconnecté (${reason}).`);
        // La position n'est PAS effacée à la déconnexion : elle expire selon sa
        // propre durée de partage. Couper le réseau ne doit pas révéler une
        // intention, mais on signale l'absence aux observateurs de la zone.
        void this.broadcastOffline(userId);
      });
    });
  }

  // =========================================================================
  // Présence
  // =========================================================================

  private async handleSubscribe(
    socket: HubSocket,
    payload: { lat: number; lng: number },
  ): Promise<void> {
    const { lat, lng } = payload ?? { lat: NaN, lng: NaN };
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    // On quitte les cellules précédentes pour ne pas accumuler les abonnements
    // au fil des déplacements (une session longue traverserait tout le campus).
    for (const room of socket.rooms) {
      if (room.startsWith("zone:")) void socket.leave(room);
    }
    for (const room of neighbourZoneKeys(lat, lng)) {
      void socket.join(room);
    }

    const snapshot = await this.buildSnapshot(socket.data.userId, lat, lng);
    socket.emit("presence:snapshot", snapshot);
  }

  private async handleUnsubscribe(
    socket: HubSocket,
  ): Promise<void> {
    for (const room of socket.rooms) {
      if (room.startsWith("zone:")) void socket.leave(room);
    }
  }

  private async handleHeartbeat(
    userId: string,
    socketId: string,
    ack?: (payload: HeartbeatAck) => void,
  ): Promise<void> {
    const now = new Date();
    const rows = await this.db
      .select({ shareExpiresAt: userPresence.shareExpiresAt })
      .from(userPresence)
      .where(eq(userPresence.userId, userId))
      .limit(1);

    const expiresAt = rows[0]?.shareExpiresAt ?? null;

    if (expiresAt && expiresAt.getTime() > now.getTime()) {
      await this.db
        .update(userPresence)
        .set({ lastSeenAt: now, updatedAt: now })
        .where(eq(userPresence.userId, userId));
    }

    ack?.({
      serverTime: now.toISOString(),
      expiresInSeconds: expiresAt
        ? Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000))
        : 0,
      onlineCount: this.onlineCount,
    });

    // Rafraîchit la projection des observateurs de la zone.
    await this.broadcastPresenceOf(userId, socketId);
  }

  /** Construit la projection de proximité pour un utilisateur donné. */
  private async buildSnapshot(
    requesterId: string,
    lat: number,
    lng: number,
  ): Promise<PresenceSnapshot> {
    const entries = await this.presence.nearby(requesterId, {
      lat,
      lng,
      radius: 2000,
      limit: 50,
    });

    return {
      zone: zoneKeyOf(lat, lng),
      entries: entries.map((entry) => ({
        userId: entry.userId,
        fullName: entry.fullName,
        avatarSeed: entry.avatarSeed,
        status: entry.status,
        privacyMode: entry.privacyMode,
        location: entry.location,
        approximate: entry.approximate,
        distanceMeters: entry.distanceMeters,
        buildingId: entry.buildingId,
        buildingName: entry.buildingName,
        isFriend: entry.isFriend,
        updatedAt: entry.updatedAt,
      })),
      serverTime: new Date().toISOString(),
    };
  }

  /**
   * Diffuse la présence d'un utilisateur aux observateurs de sa zone.
   * Chaque destinataire reçoit SA projection : aucune room ne transporte de
   * coordonnées exactes vers un membre non autorisé.
   */
  async broadcastPresenceOf(userId: string, exceptSocketId?: string): Promise<void> {
    const actor = await this.loadPresenceRow(userId);
    if (!actor) return;

    // GHOST : aucune diffusion, pas même une cellule de zone.
    if (isPresenceHidden(actor.privacyMode as PrivacyMode)) {
      await this.broadcastOffline(userId);
      return;
    }

    const observerIds = await this.friendIdsOf(userId);

    const zoneRooms = neighbourZoneKeys(actor.lat, actor.lng);
    const sockets = await this.io.in(zoneRooms).fetchSockets();

    for (const socket of sockets) {
      if (socket.id === exceptSocketId) continue;

      const observerId = socket.data.userId;
      if (observerId === userId) continue;

      // Note : pas de filtrage réciproque. L'ADR-006 définit GHOST comme
      // « je ne suis pas visible », PAS « je ne vois personne ». Un étudiant en
      // GHOST conserve donc la navigation et la visibilité de ses amis.
      // (La présence `nearby` applique déjà cette même sémantique.)

      const disclosure = applyPrivacyPolicy({
        ownerMode: actor.privacyMode as PrivacyMode,
        isFriend: observerIds.has(observerId),
        actual: { lat: actor.lat, lng: actor.lng },
        ownerId: userId,
      });

      const entry: PresenceBroadcastEntry = {
        userId,
        fullName: actor.fullName,
        avatarSeed: actor.avatarSeed,
        status: actor.status as PresenceStatus,
        privacyMode: actor.privacyMode as PrivacyMode,
        location: disclosure.location,
        approximate: disclosure.approximate,
        distanceMeters: disclosure.distanceMeters,
        buildingId: actor.buildingId,
        buildingName: actor.buildingName,
        isFriend: observerIds.has(observerId),
        updatedAt: actor.updatedAt.toISOString(),
      };

      socket.emit("presence:update", entry);
    }
  }

  private async loadPresenceRow(userId: string): Promise<{
    fullName: string;
    avatarSeed: string;
    status: string;
    privacyMode: string;
    buildingId: string | null;
    buildingName: string | null;
    updatedAt: Date;
    lat: number;
    lng: number;
  } | null> {
    const rows = await this.db
      .select({
        fullName: users.fullName,
        avatarSeed: users.avatarSeed,
        status: userPresence.status,
        privacyMode: userPresence.privacyMode,
        buildingId: userPresence.buildingId,
        buildingName: buildings.name,
        updatedAt: userPresence.updatedAt,
        lat: sql<number>`ST_Y(${userPresence.location}::geometry)`,
        lng: sql<number>`ST_X(${userPresence.location}::geometry)`,
        hasLocation: sql<boolean>`${userPresence.location} IS NOT NULL`,
        expired: sql<boolean>`${userPresence.shareExpiresAt} <= now()`,
      })
      .from(userPresence)
      .innerJoin(users, eq(users.id, userPresence.userId))
      .leftJoin(buildings, eq(buildings.id, userPresence.buildingId))
      .where(eq(userPresence.userId, userId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    if (!row.hasLocation || row.expired) return null;
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return null;

    return {
      fullName: row.fullName,
      avatarSeed: row.avatarSeed,
      status: row.status,
      privacyMode: row.privacyMode,
      buildingId: row.buildingId,
      buildingName: row.buildingName,
      updatedAt: row.updatedAt,
      lat: Number(row.lat),
      lng: Number(row.lng),
    };
  }

  private async privacyModeOf(userId: string): Promise<PrivacyMode | null> {
    const rows = await this.db
      .select({ privacyMode: users.privacyMode })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return (rows[0]?.privacyMode as PrivacyMode | undefined) ?? null;
  }

  private async friendIdsOf(userId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ requesterId: friends.requesterId, addresseeId: friends.addresseeId })
      .from(friends)
      .where(
        and(
          eq(friends.status, "ACCEPTED"),
          sql`(${friends.requesterId} = ${userId} OR ${friends.addresseeId} = ${userId})`,
        ),
      );

    const ids = new Set<string>();
    for (const row of rows) {
      ids.add(row.requesterId === userId ? row.addresseeId : row.requesterId);
    }
    return ids;
  }

  /** Signale la disparition d'un utilisateur à sa zone — sans coordonnées. */
  async broadcastOffline(userId: string): Promise<void> {
    const row = await this.loadPresenceRow(userId);
    const at = new Date().toISOString();

    if (!row) {
      // Position déjà purgée : on ne sait plus où chercher, on prévient le staff.
      this.io.to(ROOM_STAFF).emit("presence:offline", { userId, at });
      return;
    }

    const sockets = await this.io.in(neighbourZoneKeys(row.lat, row.lng)).fetchSockets();
    for (const socket of sockets) {
      if (socket.data.userId === userId) continue;
      socket.emit("presence:offline", { userId, at });
    }
  }

  /** Purge des positions expirées puis notification des zones concernées. */
  async sweepExpired(): Promise<number> {
    try {
      const expired = (await this.db.execute<{ user_id: string }>(sql`
        SELECT user_id FROM user_presence
        WHERE location IS NOT NULL AND share_expires_at <= now()
      `)) as unknown as Array<{ user_id: string }>;

      if (expired.length === 0) return 0;

      const purged = await this.presence.purgeExpired();
      const ids = expired.map((r) => r.user_id);

      // On prévient les intéressés (leur propre écran) et le staff modérateur.
      for (const id of ids) {
        this.io.to(userRoom(id)).emit("presence:expired", {
          userIds: [id],
          at: new Date().toISOString(),
        });
      }
      this.io.to(ROOM_STAFF).emit("presence:expired", {
        userIds: ids,
        at: new Date().toISOString(),
      });

      this.logger.info(`Présences expirées purgées : ${purged}.`);
      return purged;
    } catch (error) {
      this.logger.error(
        `Échec de la purge des présences : ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  // =========================================================================
  // Signalements
  // =========================================================================

  /**
   * Diffuse un nouveau signalement. Aucune donnée personnelle : titre, catégorie,
   * gravité et position approximative du lieu (jamais celle de l'auteur).
   */
  broadcastReport(report: Report): void {
    const targets = new Set<string>([ROOM_STAFF]);
    // On diffuse à la faculté du bâtiment concerné lorsqu'il est connu.
    if (report.buildingId) {
      void this.facultyOfBuilding(report.buildingId).then((facultyId) => {
        if (facultyId) {
          this.io.to([...targets, facultyRoom(facultyId)]).emit("report:created", report);
        } else {
          this.io.to([...targets]).emit("report:created", report);
        }
      });
      return;
    }
    this.io.to([...targets]).emit("report:created", report);
  }

  private async facultyOfBuilding(buildingId: string): Promise<string | null> {
    const rows = await this.db
      .select({ facultyId: buildings.facultyId })
      .from(buildings)
      .where(eq(buildings.id, buildingId))
      .limit(1);
    return rows[0]?.facultyId ?? null;
  }

  broadcastReportUpdate(payload: { reportId: string; status: string; confirmations: number }): void {
    this.io.to(ROOM_STAFF).emit("report:updated", payload);
  }

  // =========================================================================
  // Notifications
  // =========================================================================

  /** Pousse une notification déjà persistée sur la room privée du destinataire. */
  pushNotification(userId: string, notification: Notification): void {
    this.io.to(userRoom(userId)).emit("notification:new", notification);
  }

  /** Crée puis pousse une notification. */
  async notify(userId: string, input: Omit<NotifyInput, "userId">): Promise<Notification> {
    const notification = await this.notifications.notify({ ...input, userId });
    this.pushNotification(userId, notification);
    return notification;
  }

  // =========================================================================
  // SOS
  // =========================================================================

  private async handleSosCreate(
    socket: HubSocket,
    payload: Parameters<ClientToServerEvents["sos:create"]>[0],
    ack?: (payload: SosAck | { error: { code: string; message: string } }) => void,
  ): Promise<void> {
    try {
      const operationId = randomUUID();
      const { alert } = await this.sos.create(socket.data.userId, payload, operationId);

      const notified = await this.fanOutSos(alert);
      ack?.({ alert, disclaimer: SOS_DISCLAIMER, notifiedModerators: notified });
    } catch (error) {
      ack?.({
        error: {
          code: "SOS_FAILED",
          message: error instanceof Error ? error.message : "Création de l'alerte impossible.",
        },
      });
    }
  }

  /**
   * Diffuse une alerte SOS aux modérateurs connectés et notifie l'auteur.
   * IMPORTANT : la position exacte n'est envoyée QU'AU STAFF. L'auteur reçoit
   * sa propre alerte ; les autres étudiants ne voient rien.
   */
  async fanOutSos(alert: SosAlert): Promise<number> {
    const staffSockets = await this.io.in(ROOM_STAFF).fetchSockets();
    this.io.to(ROOM_STAFF).emit("sos:created", alert);

    // Notification persistée pour les modérateurs hors ligne (ils la verront
    // à la reconnexion) : c'est ce qui distingue un vrai canal d'alerte d'un
    // simple événement éphémère.
    for (const socket of staffSockets) {
      if (socket.data.userId === alert.userId) continue;
      await this.notify(socket.data.userId, {
        type: "SOS",
        title: "Alerte SOS reçue",
        body: `Alerte ${alert.kind}${alert.buildingName ? ` — ${alert.buildingName}` : ""}. Prise en charge requise.`,
        actionUrl: "/admin/moderation",
        entityType: "SOS",
        entityId: alert.id,
      });
    }

    this.io.to(userRoom(alert.userId)).emit("sos:created", alert);

    return staffSockets.filter((s) => s.data.userId !== alert.userId).length;
  }

  broadcastSosAcknowledged(payload: { alertId: string; byUserId: string; at: string }): void {
    this.io.to(ROOM_STAFF).emit("sos:acknowledged", payload);
  }

  /** Facultés connues — utile aux tests d'isolation par room. */
  async allFacultyIds(): Promise<string[]> {
    const rows = await this.db.select({ id: faculties.id }).from(faculties);
    return rows.map((r) => r.id);
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

function extractToken(socket: { handshake: { auth?: unknown; headers: Record<string, unknown> } }): string | null {
  const auth = socket.handshake.auth as { token?: unknown } | undefined;
  if (auth && typeof auth.token === "string" && auth.token.trim().length > 0) {
    return auth.token.trim();
  }

  const header = socket.handshake.headers["authorization"];
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  return null;
}

