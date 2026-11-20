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

import { and, eq, gt, sql } from "drizzle-orm";
import type { Database } from "@uac/database";
import { buildings, friends, userPresence, users } from "@uac/database";
import {
  AuthorizationError,
  LIMITS,
  NotFoundError,
  type PrivacyMode,
  type PresenceStatus,
} from "@uac/shared";
import type { NearbyPresence, UpdatePresenceBody } from "@uac/contracts";
import { applyPrivacyPolicy } from "./privacy.policy.js";

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
    const shouldStoreLocation =
      privacyMode !== "GHOST" && body.location !== null && body.location !== undefined;

    // Upsert en SQL natif : `location` est geography(Point,4326). On ne peut pas
    // y écrire une chaîne de remplacement (« stub ») — PostgreSQL rejetterait la
    // valeur, et un point fabriqué serait pire encore. La géométrie est donc
    // posée dans la même instruction que l'insertion.
    //
    // Les dates sont passées en ISO 8601 : le driver `postgres` refuse un objet
    // `Date` lié dans un template `sql` brut (ERR_INVALID_ARG_TYPE).
    const geometryExpr = shouldStoreLocation
      ? sql`ST_SetSRID(ST_MakePoint(${body.location!.lng}, ${body.location!.lat}), 4326)::geography`
      : sql`NULL`;

    await this.db.execute(sql`
      INSERT INTO user_presence (
        user_id, status, location, accuracy_meters, building_id, privacy_mode,
        consent_given_at, share_expires_at, last_seen_at, updated_at
      ) VALUES (
        ${userId}, ${body.status}, ${geometryExpr}, ${
          shouldStoreLocation ? (body.accuracyMeters ?? null) : null
        }, ${body.buildingId ?? null}, ${privacyMode},
        ${consentGivenAt.toISOString()}::timestamptz,
        ${shareExpiresAt.toISOString()}::timestamptz,
        ${consentGivenAt.toISOString()}::timestamptz,
        ${consentGivenAt.toISOString()}::timestamptz
      )
      ON CONFLICT (user_id) DO UPDATE SET
        status = EXCLUDED.status,
        location = EXCLUDED.location,
        accuracy_meters = EXCLUDED.accuracy_meters,
        building_id = EXCLUDED.building_id,
        privacy_mode = EXCLUDED.privacy_mode,
        consent_given_at = EXCLUDED.consent_given_at,
        share_expires_at = EXCLUDED.share_expires_at,
        last_seen_at = EXCLUDED.last_seen_at,
        updated_at = EXCLUDED.updated_at
    `);

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

      if (ownerMode === "GHOST") continue;

      const disclosure = applyPrivacyPolicy({
        ownerMode,
        isFriend,
        actual: { lat: row.lat, lng: row.lng },
        ownerId: row.userId,
        realDistanceMeters: row.distance,
      });

      results.push({
        userId: row.userId,
        fullName: row.fullName,
        avatarSeed: row.avatarSeed,
        status: row.status as PresenceStatus,
        privacyMode: ownerMode,
        location: disclosure.location,
        approximate: disclosure.approximate,
        distanceMeters: disclosure.distanceMeters,
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

