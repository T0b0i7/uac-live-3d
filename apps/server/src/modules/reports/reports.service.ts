/**
 * Service des signalements — apps/server/src/modules/reports/reports.service.ts
 *
 * Règles métier :
 *  - un auteur ne peut pas confirmer son propre signalement ;
 *  - un seul vote par utilisateur (index unique en base, plus contrôle applicatif
 *    pour renvoyer un message clair) ;
 *  - les compteurs sont recalculés depuis `report_votes` (source de vérité),
 *    jamais incrémentés à l'aveugle ;
 *  - `operationId` rend la création idempotente (ADR-007) ;
 *  - un signalement expiré n'apparaît plus dans les listes actives.
 */

import { and, count, eq, gt, isNull, sql, type SQL } from "drizzle-orm";
import type { Database } from "@uac/database";
import { buildings, reportComments, reportVotes, reports, users } from "@uac/database";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  buildPaginationMeta,
  type ReportCategory,
  type ReportStatus,
} from "@uac/shared";
import type { CreateReportBody, Report, ReportsQuery } from "@uac/contracts";

export class ReportsService {
  constructor(private readonly db: Database) {}

  async list(
    query: ReportsQuery,
    viewerId: string | null,
  ): Promise<{ items: Report[]; meta: ReturnType<typeof buildPaginationMeta> }> {
    const conditions: SQL[] = [
      isNull(reports.deletedAt),
      sql`${reports.status} IN ('ACTIVE','CONFIRMED')`,
    ];
    if (query.category) conditions.push(eq(reports.category, query.category));
    if (query.status) conditions.push(eq(reports.status, query.status));
    if (query.buildingId) conditions.push(eq(reports.buildingId, query.buildingId));

    const where = and(...conditions);
    const orderBy =
      query.sort === "confirmations"
        ? sql`${reports.confirmations} DESC, ${reports.createdAt} DESC`
        : query.sort === "severity"
          ? sql`${reports.severity} DESC, ${reports.createdAt} DESC`
          : sql`${reports.createdAt} DESC`;

    const offset = (query.page - 1) * query.limit;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          report: reports,
          authorName: users.fullName,
          buildingName: buildings.name,
          myVote: viewerId
            ? sql<number>`COALESCE((SELECT rv.vote FROM report_votes rv WHERE rv.report_id = ${reports.id} AND rv.user_id = ${viewerId}), 0)`
            : sql<number>`0`,
        })
        .from(reports)
        .innerJoin(users, eq(users.id, reports.authorId))
        .leftJoin(buildings, eq(buildings.id, reports.buildingId))
        .where(where)
        .orderBy(orderBy)
        .limit(query.limit)
        .offset(offset),
      this.db.select({ value: count() }).from(reports).where(where),
    ]);

    return {
      items: rows.map((r) => this.toDto(r.report, r.authorName, r.buildingName, Number(r.myVote))),
      meta: buildPaginationMeta(query.page, query.limit, Number(totalRows[0]?.value ?? 0)),
    };
  }

  async byId(id: string, viewerId: string | null): Promise<Report> {
    const rows = await this.db
      .select({
        report: reports,
        authorName: users.fullName,
        buildingName: buildings.name,
        myVote: viewerId
          ? sql<number>`COALESCE((SELECT rv.vote FROM report_votes rv WHERE rv.report_id = ${reports.id} AND rv.user_id = ${viewerId}), 0)`
          : sql<number>`0`,
      })
      .from(reports)
      .innerJoin(users, eq(users.id, reports.authorId))
      .leftJoin(buildings, eq(buildings.id, reports.buildingId))
      .where(and(eq(reports.id, id), isNull(reports.deletedAt)))
      .limit(1);

    if (rows.length === 0) throw new NotFoundError("Signalement");
    const row = rows[0]!;
    return this.toDto(row.report, row.authorName, row.buildingName, Number(row.myVote));
  }

  /**
   * Crée un signalement. Si `operationId` est fourni et déjà présent, on renvoie
   * l'enregistrement existant au lieu d'en créer un second (idempotence).
   */
  async create(
    body: CreateReportBody,
    authorId: string,
    operationId: string | null,
  ): Promise<{ report: Report; wasDuplicate: boolean }> {
    if (operationId) {
      const existing = await this.db
        .select({ id: reports.id })
        .from(reports)
        .where(eq(reports.operationId, operationId))
        .limit(1);
      if (existing.length > 0) {
        return { report: await this.byId(existing[0]!.id, authorId), wasDuplicate: true };
      }
    }

    const inserted = await this.db
      .insert(reports)
      .values({
        title: body.title,
        body: body.body ?? null,
        category: body.category,
        severity: body.severity,
        location: "stub" as never,
        buildingId: body.buildingId ?? null,
        authorId,
        status: "ACTIVE",
        operationId,
        // Durée de vie : 12 h pour les signalements standards, 48 h pour la sécurité.
        expiresAt: new Date(
          Date.now() + (body.category === "SAFETY" ? 48 : 12) * 3_600_000,
        ),
      })
      .returning({ id: reports.id });

    const id = inserted[0]!.id;

    // Géométrie posée par PostGIS (jamais assemblée en chaîne côté app).
    await this.db.execute(sql`
      UPDATE reports
      SET location = ST_SetSRID(ST_MakePoint(${body.location.lng}, ${body.location.lat}), 4326)
      WHERE id = ${id}
    `);

    return { report: await this.byId(id, authorId), wasDuplicate: false };
  }

  /** Vote : +1 confirme, -1 signale comme non fondé. Recalcul depuis la table. */
  async vote(reportId: string, userId: string, vote: 1 | -1): Promise<Report> {
    const target = await this.byId(reportId, userId);

    if (target.authorId === userId) {
      throw new AuthorizationError("Vous ne pouvez pas voter sur votre propre signalement.");
    }
    if (target.status === "RESOLVED" || target.status === "EXPIRED") {
      throw new ConflictError("Ce signalement est clôturé, le vote n'est plus possible.");
    }

    const existing = await this.db
      .select({ id: reportVotes.id, vote: reportVotes.vote })
      .from(reportVotes)
      .where(and(eq(reportVotes.reportId, reportId), eq(reportVotes.userId, userId)))
      .limit(1);

    if (existing.length > 0) {
      if (existing[0]!.vote === vote) {
        // Annulation du vote : même valeur renvoyée = on retire.
        await this.db.delete(reportVotes).where(eq(reportVotes.id, existing[0]!.id));
      } else {
        await this.db.update(reportVotes).set({ vote }).where(eq(reportVotes.id, existing[0]!.id));
      }
    } else {
      await this.db.insert(reportVotes).values({ reportId, userId, vote });
    }

    // Recalcul des compteurs depuis la source de vérité (pas d'incrément aveugle).
    const tallies = await this.db
      .select({ vote: reportVotes.vote, value: count() })
      .from(reportVotes)
      .where(eq(reportVotes.reportId, reportId))
      .groupBy(reportVotes.vote);

    const confirmations = Number(tallies.find((t) => t.vote === 1)?.value ?? 0);
    const rejections = Number(tallies.find((t) => t.vote === -1)?.value ?? 0);

    let status: ReportStatus = target.status as ReportStatus;
    if (confirmations >= 5 && confirmations > rejections * 2) status = "CONFIRMED";
    if (rejections >= 5 && rejections > confirmations) status = "REJECTED";

    await this.db
      .update(reports)
      .set({ confirmations, rejections, status, updatedAt: new Date() })
      .where(eq(reports.id, reportId));

    return this.byId(reportId, userId);
  }

  /** Commentaire sur un signalement (auteur, ou tout utilisateur authentifié). */
  async comment(reportId: string, authorId: string, body: string): Promise<{ id: string }> {
    await this.byId(reportId, authorId);
    const inserted = await this.db
      .insert(reportComments)
      .values({ reportId, authorId, body })
      .returning({ id: reportComments.id });

    await this.db
      .update(reports)
      .set({ commentCount: sql`${reports.commentCount} + 1` })
      .where(eq(reports.id, reportId));

    return { id: inserted[0]!.id };
  }

  async comments(
    reportId: string,
  ): Promise<Array<{ id: string; authorName: string; body: string; createdAt: string }>> {
    const rows = await this.db
      .select({
        id: reportComments.id,
        authorName: users.fullName,
        body: reportComments.body,
        createdAt: reportComments.createdAt,
      })
      .from(reportComments)
      .innerJoin(users, eq(users.id, reportComments.authorId))
      .where(eq(reportComments.reportId, reportId))
      .orderBy(reportComments.createdAt);

    return rows.map((r) => ({
      id: r.id,
      authorName: r.authorName,
      body: r.body,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Clôture : auteur ou modérateur. */
  async resolve(reportId: string, actorId: string, actorRole: string): Promise<Report> {
    const target = await this.byId(reportId, actorId);
    if (target.authorId !== actorId && actorRole !== "MODERATOR" && actorRole !== "ADMIN") {
      throw new AuthorizationError(
        "Seul l'auteur du signalement ou un modérateur peut le clôturer.",
      );
    }

    await this.db
      .update(reports)
      .set({ status: "RESOLVED", resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(reports.id, reportId));

    return this.byId(reportId, actorId);
  }

  /** Suppression logique : auteur ou modérateur. */
  async softDelete(reportId: string, actorId: string, actorRole: string): Promise<void> {
    const target = await this.byId(reportId, actorId);
    if (target.authorId !== actorId && actorRole !== "MODERATOR" && actorRole !== "ADMIN") {
      throw new AuthorizationError("Vous ne pouvez pas supprimer ce signalement.");
    }
    await this.db
      .update(reports)
      .set({ deletedAt: new Date(), status: "REJECTED" })
      .where(eq(reports.id, reportId));
  }

  /** Purge des signalements expirés (worker). */
  async expireStale(): Promise<number> {
    const result = await this.db
      .update(reports)
      .set({ status: "EXPIRED", updatedAt: new Date() })
      .where(
        and(
          sql`${reports.status} IN ('ACTIVE','CONFIRMED')`,
          sql`${reports.expiresAt} IS NOT NULL AND ${reports.expiresAt} <= now()`,
        ),
      )
      .returning({ id: reports.id });
    return result.length;
  }

  /** Compte des signalements actifs (KPI admin). */
  async activeCount(): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(reports)
      .where(
        and(
          isNull(reports.deletedAt),
          gt(reports.expiresAt, new Date()),
          sql`${reports.status} IN ('ACTIVE','CONFIRMED')`,
        ),
      );
    return Number(rows[0]?.value ?? 0);
  }

  private toDto(
    row: typeof reports.$inferSelect,
    authorName: string,
    buildingName: string | null,
    myVote: number,
  ): Report {
    const point = parsePoint(row.location);
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      category: row.category as ReportCategory,
      status: row.status as ReportStatus,
      severity: row.severity,
      location: point ?? { lat: 0, lng: 0 },
      buildingId: row.buildingId,
      buildingName,
      authorId: row.authorId,
      authorName,
      confirmations: row.confirmations,
      rejections: row.rejections,
      commentCount: row.commentCount,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      myVote: myVote === 1 ? 1 : myVote === -1 ? -1 : 0,
    };
  }
}

function parsePoint(value: unknown): { lat: number; lng: number } | null {
  if (typeof value !== "string") return null;
  const match = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(value);
  if (!match) return null;
  return { lng: Number(match[1]), lat: Number(match[2]) };
}
