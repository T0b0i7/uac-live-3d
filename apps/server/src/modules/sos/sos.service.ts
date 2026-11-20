/**
 * Service SOS — apps/server/src/modules/sos/sos.service.ts
 *
 * AVERTISSEMENT PRODUIT, à conserver mot pour mot :
 * cette fonctionnalité N'EST PAS un dispositif d'urgence officiel. Aucun appel
 * n'est passé, aucun service de secours n'est contacté, aucun message n'est
 * transmis aux autorités. L'alerte est stockée et diffusée aux modérateurs
 * actuellement connectés. L'UAC-Live 3D n'est pas raccordé aux secours publics.
 *
 * L'API renvoie systématiquement un `disclaimer` pour que le client ne puisse
 * pas afficher un message de sécurité trompeur.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@uac/database";
import { buildings, sosAlerts, users } from "@uac/database";
import { AuthorizationError, NotFoundError, type SosKind, type SosStatus } from "@uac/shared";
import type { CreateSosBody, SosAlert } from "@uac/contracts";

export const SOS_DISCLAIMER =
  "UAC-Live 3D n'est pas un service d'urgence. Cette alerte est visible uniquement " +
  "par les modérateurs connectés à l'application. En cas de danger immédiat, " +
  "contactez les secours (117 police, 118 pompiers) ou le service de sécurité du campus.";

interface SosRow {
  id: string;
  userId: string;
  userName: string;
  kind: string;
  status: string;
  buildingId: string | null;
  buildingName: string | null;
  message: string | null;
  createdAt: Date;
  cancelledAt: Date | null;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  lat: number | null;
  lng: number | null;
}

export class SosService {
  constructor(private readonly db: Database) {}

  /**
   * Crée une alerte. `operationId` rend l'opération idempotente : un renvoi
   * depuis la file hors ligne (ADR-007) ne crée pas de doublon.
   */
  async create(
    userId: string,
    body: CreateSosBody,
    operationId: string | null,
  ): Promise<{ alert: SosAlert; wasDuplicate: boolean }> {
    if (operationId) {
      const existing = await this.db
        .select({ id: sosAlerts.id })
        .from(sosAlerts)
        .where(eq(sosAlerts.operationId, operationId))
        .limit(1);
      if (existing.length > 0) {
        return { alert: await this.byId(existing[0]!.id), wasDuplicate: true };
      }
    }

    // Insertion SQL natif : `location` est geography(Point,4326) et nullable.
    // Passer un `Date` dans un template brut déclenche ERR_INVALID_ARG_TYPE
    // côté driver `postgres` — on envoie donc du texte ISO casté.
    const geometry = body.location
      ? sql`ST_SetSRID(ST_MakePoint(${body.location.lng}, ${body.location.lat}), 4326)::geography`
      : sql`NULL`;

    const inserted = await this.db.execute<{ id: string }>(sql`
      INSERT INTO sos_alerts (
        user_id, kind, status, location, building_id, message, operation_id
      ) VALUES (
        ${userId}, ${body.kind}, 'ACTIVE',
        ${geometry},
        ${body.buildingId ?? null}, ${body.message ?? null}, ${operationId}
      )
      RETURNING id
    `);

    const id = (inserted as unknown as Array<{ id: string }>)[0]!.id;
    return { alert: await this.byId(id), wasDuplicate: false };
  }

  async byId(id: string): Promise<SosAlert> {
    const rows = await this.db
      .select({
        id: sosAlerts.id,
        userId: sosAlerts.userId,
        userName: users.fullName,
        kind: sosAlerts.kind,
        status: sosAlerts.status,
        buildingId: sosAlerts.buildingId,
        buildingName: buildings.name,
        message: sosAlerts.message,
        createdAt: sosAlerts.createdAt,
        cancelledAt: sosAlerts.cancelledAt,
        acknowledgedAt: sosAlerts.acknowledgedAt,
        acknowledgedBy: sosAlerts.acknowledgedBy,
        lat: sql<number | null>`ST_Y(${sosAlerts.location}::geometry)`,
        lng: sql<number | null>`ST_X(${sosAlerts.location}::geometry)`,
      })
      .from(sosAlerts)
      .innerJoin(users, eq(users.id, sosAlerts.userId))
      .leftJoin(buildings, eq(buildings.id, sosAlerts.buildingId))
      .where(eq(sosAlerts.id, id))
      .limit(1);

    const row = rows[0] as SosRow | undefined;
    if (!row) throw new NotFoundError("Alerte SOS");
    return toDto(row);
  }

  /** Alerte active la plus récente d'un utilisateur, s'il y en a une. */
  async activeOf(userId: string): Promise<SosAlert | null> {
    const rows = await this.db
      .select({ id: sosAlerts.id })
      .from(sosAlerts)
      .where(and(eq(sosAlerts.userId, userId), eq(sosAlerts.status, "ACTIVE")))
      .orderBy(desc(sosAlerts.createdAt))
      .limit(1);
    const row = rows[0];
    return row ? this.byId(row.id) : null;
  }

  /** Liste des alertes actives, pour la console de modération. */
  async active(limit = 50): Promise<SosAlert[]> {
    const rows = await this.db
      .select({ id: sosAlerts.id })
      .from(sosAlerts)
      .where(eq(sosAlerts.status, "ACTIVE"))
      .orderBy(desc(sosAlerts.createdAt))
      .limit(Math.min(limit, 100));

    const alerts: SosAlert[] = [];
    for (const row of rows) {
      alerts.push(await this.byId(row.id));
    }
    return alerts;
  }

  /**
   * Prise en charge par un modérateur. Seul un MODERATOR ou ADMIN peut le faire :
   * un étudiant ne peut pas « acquitter » l'alerte d'un autre.
   */
  async acknowledge(alertId: string, byUserId: string, byRole: string): Promise<SosAlert> {
    if (byRole !== "MODERATOR" && byRole !== "ADMIN") {
      throw new AuthorizationError("Seul un modérateur peut prendre en charge une alerte SOS.");
    }

    await this.db
      .update(sosAlerts)
      .set({ status: "ACKNOWLEDGED", acknowledgedAt: new Date(), acknowledgedBy: byUserId })
      .where(and(eq(sosAlerts.id, alertId), eq(sosAlerts.status, "ACTIVE")));

    return this.byId(alertId);
  }

  /** Annulation par le demandeur lui-même (faux départ). */
  async cancel(alertId: string, userId: string): Promise<SosAlert> {
    const rows = await this.db
      .select({ userId: sosAlerts.userId, status: sosAlerts.status })
      .from(sosAlerts)
      .where(eq(sosAlerts.id, alertId))
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundError("Alerte SOS");
    if (row.userId !== userId) {
      throw new AuthorizationError("Vous ne pouvez annuler que votre propre alerte.");
    }

    await this.db
      .update(sosAlerts)
      .set({ status: "CANCELLED", cancelledAt: new Date() })
      .where(eq(sosAlerts.id, alertId));

    return this.byId(alertId);
  }
}

function toDto(row: SosRow): SosAlert {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    kind: row.kind as SosKind,
    status: row.status as SosStatus,
    location:
      row.lat !== null && row.lng !== null && !Number.isNaN(row.lat)
        ? { lat: Number(row.lat), lng: Number(row.lng) }
        : null,
    buildingId: row.buildingId,
    buildingName: row.buildingName,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    acknowledgedBy: row.acknowledgedBy,
    pendingSync: false,
  };
}
