/**
 * Service de présence — apps/server/src/modules/presence/presence.service.ts
 *
 * C'est le module où la politique de confidentialité (ADR-006) devient du code.
 * Règle centrale : le FILTRAGE EST SERVEUR. On ne renvoie jamais de coordonnées
 * auxquelles l'appelant n'a pas droit, et on ne compte pas sur le client.
 *
 * Ordre d'exécution de `nearby()` :
 *   1. requête spatiale PostGIS sur les positions RÉELLES et non expirées ;
 *   2. calcul de la distance réelle ;
 *   3. filtrage/dégradation selon (mode du propriétaire × lien d'amitié) ;
 *   4. tri par distance croissante ;
 *   5. jamais de lat/lng exacts pour BLURRED_ZONE.
 */

import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { Database } from "@uac/database";
import { buildings, friends, userPresence, users } from "@uac/database";
import { blurPosition } from "@uac/geospatial";
import {
  AuthorizationError,
  LIMITS,
  NotFoundError,
  type PrivacyMode,
  type PresenceStatus,
} from "@uac/shared";
import type { NearbyPresence, UpdatePresenceBody } from "@uac/contracts";

export class PresenceService {
  constructor(private readonly db: Database) {}

  /**
   * Met à jour la présence de l'utilisateur courant.
   * `shareExpiresAt` est borné côté serveur, jamais confié au client.
   */
  async updatePresence(
    userId: string,
    body: UpdatePresenceBody,
  ): Promise<{ status: PresenceStatus; privacyMode: PrivacyMode; shareExpiresAt: string }> {
    const consentGivenAt = new Date();
    const shareExpiresAt = new Date(
      Math.min(
        consentGivenAt.getTime() + body.shareForMinutes * 60_000,
        consentGivenAt.getTime() + LIMITS.PRESENCE_MAX_RETENTION_HOURS * 3_600_000,
      ),
    );

    const userRows = await this.db
      .select({ privacyMode: users.privacyMode })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (userRows.length === 0) throw new NotFoundError("Utilisateur");

    const privacyMode = userRows[0]!.privacyMode as PrivacyMode;

    // Mode GHOST : on n'enregistre AUCUNE position, même si le client en envoie une.
    const shouldStoreLocation = privacyMode !== "GHOST" && body.location !== null && body.location !== undefined;
    const locationExpr = shouldStoreLocation
      ? sql`ST_SetSRID(ST_MakePoint(${body.location!.lng}, ${body.location!.lat}), 4326)::geography`
      : sql`NULL`;

    await this.db
      .insert(userPresence)
      .values({
        userId,
        status: body.status,
        location: shouldStoreLocation ? "stub" : null,
        accuracyMeters: shouldStoreLocation ? (body.accuracyMeters ?? null) : null,
        buildingId: body.buildingId ?? null,
        privacyMode,
        consentGivenAt,
        shareExpiresAt,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userPresence.userId,
        set: {
          status: body.status,
          location: locationExpr as never,
          accuracyMeters: shouldStoreLocation ? (body.accuracyMeters ?? null) : null,
          buildingId: body.buildingId ?? null,
          privacyMode,
          consentGivenAt,
          shareExpiresAt,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      });

    return {
      status: body.status,
      privacyMode,
      shareExpiresAt: shareExpiresAt.toISOString(),
    };
  }

  /** Change le mode de confidentialité et purge la position si GHOST. */
  async updatePrivacy(userId: string, privacyMode: PrivacyMode): Promise<void> {
    await this.db
      .update(users)
      .set({ privacyMode, updatedAt: new Date() })
      .where(eq(users.id, userId));

    if (privacyMode === "GHOST") {
      // Suppression immédiate de la position : le mode ghost doit être effectif
      // dès la réponse, pas à la prochaine mise à jour de présence.
      await this.db
        .update(userPresence)
        .set({ location: null, privacyMode, updatedAt: new Date() })
        .where(eq(userPresence.userId, userId));
      return;
    }

    await this.db
      .update(userPresence)
      .set({ privacyMode, updatedAt: new Date() })
      .where(eq(userPresence.userId, userId));
  }

  /**
   * Présences à proximité, filtrées selon la politique de confidentialité.
   *
   * @param requesterId utilisateur qui interroge (null = anonyme)
   */
  async nearby(
    requesterId: string | null,
    options: { lat: number; lng: number; radius: number; limit: number },
  ): Promise<NearbyPresence[]> {
    const point = sql`ST_SetSRID(ST_MakePoint(${options.lng}, ${options.lat}), 4326)::geography`;

    // 1. Requête spatiale : positions réelles, non expirées, non ghost.
    const rows = await this.db
      .select({
        userId: userPresence.userId,
        fullName: users.fullName,
        avatarSeed: users.avatarSeed,
        status: userPresence.status,
        privacyMode: userPresence.privacyMode,
        buildingId: userPresence.buildingId,
        buildingName: buildings.name,
        updatedAt: userPresence.updatedAt,
        distance: sql<number>`ST_Distance(${userPresence.location}, ${point})`,
        lng: sql<number>`ST_X(${userPresence.location}::geometry)`,
        lat: sql<number>`ST_Y(${userPresence.location}::geometry)`,
      })
      .from(userPresence)
      .innerJoin(users, eq(users.id, userPresence.userId))
      .leftJoin(buildings, eq(buildings.id, userPresence.buildingId))
      .where(
        and(
          sql`${userPresence.location} IS NOT NULL`,
          gt(userPresence.shareExpiresAt, new Date()),
          sql`ST_DWithin(${userPresence.location}, ${point}, ${options.radius})`,
          sql`${userPresence.privacyMode} <> 'GHOST'`,
          eq(users.isActive, true),
          requesterId ? sql`${userPresence.userId} <> ${requesterId}` : sql`true`,
        ),
      )
      .orderBy(sql`ST_Distance(${userPresence.location}, ${point})`)
      .limit(Math.min(options.limit * 2, 200));

    // 2. Amitiés de l'appelant (une seule requête, pas de N+1).
    const friendIds = requesterId ? await this.friendIdsOf(requesterId) : new Set<string>();

    // 3. Dégradation selon le mode du propriétaire.
    const results: NearbyPresence[] = [];
    for (const row of rows) {
      const ownerMode = row.privacyMode as PrivacyMode;
      const isFriend = friendIds.has(row.userId);

      let location: { lat: number; lng: number } | null = null;
      let approximate = false;
      let distanceMeters: number | null = Math.round(row.distance);

      switch (ownerMode) {
        case "PUBLIC":
          location = { lat: row.lat, lng: row.lng };
          break;

        case "FRIENDS_PROMO":
          if (isFriend) {
            location = { lat: row.lat, lng: row.lng };
          } else {
            // Non-ami : aucune coordonnée, mais on garde la distance estimée ?
            // Non : la distance exacte permettrait de trianguler. On arrondit
            // grossièrement pour rester utile sans être exploitable.
            location = null;
            distanceMeters = distanceMeters === null ? null : Math.round(distanceMeters / 100) * 100;
          }
          break;

        case "BLURRED_ZONE": {
          // Dégradation y compris pour les amis : c'est le sens du mode.
          const blurred = blurPosition(
            { lat: row.lat, lng: row.lng },
            row.userId,
            60 * 60 * 1000,
            LIMITS.BLURRED_ZONE_RADIUS_M,
          );
          location = blurred;
          approximate = true;
          distanceMeters = null; // une distance calculée sur une position floue serait fausse
          break;
        }

        case "GHOST":
        default:
          // Défense en profondeur : déjà exclu par le WHERE, mais on ne prend
          // aucun risque si la requête évoluait.
          continue;
      }

      results.push({
        userId: row.userId,
        fullName: row.fullName,
        avatarSeed: row.avatarSeed,
        status: row.status as PresenceStatus,
        privacyMode: ownerMode,
        location,
        approximate,
        distanceMeters,
        buildingId: row.buildingId,
        buildingName: row.buildingName,
        isFriend,
        updatedAt: row.updatedAt.toISOString(),
      });

      if (results.length >= options.limit) break;
    }

    return results;
  }

  /** Identifiants des amis acceptés (dans les deux sens). */
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

  /** Purge des positions expirées (appelée par le worker périodique). */
  async purgeExpired(): Promise<number> {
    const result = await this.db
      .update(userPresence)
      .set({ location: null, status: "OFFLINE", updatedAt: new Date() })
      .where(and(sql`${userPresence.location} IS NOT NULL`, sql`${userPresence.shareExpiresAt} <= now()`))
      .returning({ id: userPresence.id });
    return result.length;
  }

  /** Compte les présences par mode (tableau de bord admin). */
  async privacyBreakdown(): Promise<{ sharing: number; ghost: number; blurred: number }> {
    const rows = await this.db
      .select({ mode: users.privacyMode, count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.isActive, true))
      .groupBy(users.privacyMode);

    let sharing = 0;
    let ghost = 0;
    let blurred = 0;
    for (const row of rows) {
      if (row.mode === "PUBLIC" || row.mode === "FRIENDS_PROMO") sharing += row.count;
      else if (row.mode === "GHOST") ghost += row.count;
      else if (row.mode === "BLURRED_ZONE") blurred += row.count;
    }
    return { sharing, ghost, blurred };
  }

  /** Vérifie qu'un utilisateur peut voir la position d'un autre (tests). */
  async canSeeExactPosition(viewerId: string, targetId: string): Promise<boolean> {
    const rows = await this.db
      .select({ privacyMode: users.privacyMode, shareExpiresAt: userPresence.shareExpiresAt })
      .from(users)
      .leftJoin(userPresence, eq(userPresence.userId, users.id))
      .where(eq(users.id, targetId))
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundError("Utilisateur");
    if (row.privacyMode === "PUBLIC") return true;
    if (row.privacyMode === "GHOST" || row.privacyMode === "BLURRED_ZONE") return false;
    // FRIENDS_PROMO : dépend de l'amitié et de la fraîcheur.
    if (!row.shareExpiresAt || row.shareExpiresAt.getTime() <= Date.now()) return false;
    const ids = await this.friendIdsOf(viewerId);
    return ids.has(targetId);
  }

  /** Interdit à un utilisateur de forcer la présence d'un autre. */
  assertSelf(userId: string, targetUserId: string): void {
    if (userId !== targetUserId) {
      throw new AuthorizationError("Vous ne pouvez modifier que votre propre présence.");
    }
  }
}

export { inArray };
