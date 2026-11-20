/**
 * Service des bâtiments — apps/server/src/modules/buildings/buildings.service.ts
 *
 * Les géométries sont manipulées via PostGIS : PostGIS calcule l'aire réelle
 * (`ST_Area(::geography)`) et le centroïde, jamais l'application. C'est le seul
 * moyen d'obtenir des m² corrects en SRID 4326.
 */

import { and, count, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "@uac/database";
import {
  buildingHistory,
  buildingVerifications,
  buildings,
  faculties,
  rooms,
} from "@uac/database";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  buildPaginationMeta,
  type VerificationStatus,
} from "@uac/shared";
import type {
  Building,
  BuildingsQuery,
  CreateBuildingBody,
  RouteStep,
  UpdateBuildingBody,
  VerifyBuildingBody,
} from "@uac/contracts";

export class BuildingsService {
  constructor(private readonly db: Database) {}

  async list(query: BuildingsQuery): Promise<{
    items: Building[];
    meta: ReturnType<typeof buildPaginationMeta>;
  }> {
    const conditions: SQL[] = [sql`${buildings.deletedAt} IS NULL`];

    if (query.category) conditions.push(eq(buildings.category, query.category));
    if (query.facultyId) conditions.push(eq(buildings.facultyId, query.facultyId));
    if (query.verificationStatus) {
      conditions.push(eq(buildings.verificationStatus, query.verificationStatus));
    }
    if (query.search) {
      const term = `%${query.search}%`;
      const searchCondition = or(
        ilike(buildings.name, term),
        ilike(buildings.code, term),
        sql`${buildings.shortName} ILIKE ${term}`,
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    if (query.bbox) {
      const [minLng, minLat, maxLng, maxLat] = query.bbox.split(",").map(Number) as [
        number, number, number, number,
      ];
      // Filtre spatial réel : on ne charge que ce qui intersecte la vue.
      conditions.push(
        sql`ST_Intersects(${buildings.centroid}, ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326))`,
      );
    }

    const where = and(...conditions);
    const offset = (query.page - 1) * query.limit;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          building: buildings,
          facultyName: faculties.name,
        })
        .from(buildings)
        .leftJoin(faculties, eq(faculties.id, buildings.facultyId))
        .where(where)
        .orderBy(buildings.name)
        .limit(query.limit)
        .offset(offset),
      this.db.select({ value: count() }).from(buildings).where(where),
    ]);

    return {
      items: rows.map((r) => this.toDto(r.building, r.facultyName)),
      meta: buildPaginationMeta(query.page, query.limit, Number(totalRows[0]?.value ?? 0)),
    };
  }

  async byId(id: string): Promise<Building> {
    const rows = await this.db
      .select({ building: buildings, facultyName: faculties.name })
      .from(buildings)
      .leftJoin(faculties, eq(faculties.id, buildings.facultyId))
      .where(and(eq(buildings.id, id), sql`${buildings.deletedAt} IS NULL`))
      .limit(1);

    if (rows.length === 0) throw new NotFoundError("Bâtiment");
    return this.toDto(rows[0]!.building, rows[0]!.facultyName);
  }

  async create(body: CreateBuildingBody, authorId: string): Promise<Building> {
    const existing = await this.db
      .select({ id: buildings.id })
      .from(buildings)
      .where(eq(buildings.code, body.code))
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictError(`Un bâtiment avec le code « ${body.code} » existe déjà.`);
    }

    const geometrySql = body.geometry
      ? sql`ST_GeomFromGeoJSON(${JSON.stringify(body.geometry)})`
      : sql`NULL`;

    const inserted = await this.db
      .insert(buildings)
      .values({
        code: body.code,
        name: body.name,
        shortName: body.shortName ?? null,
        category: body.category,
        facultyId: body.facultyId ?? null,
        description: body.description ?? null,
        floors: body.floors,
        footprint: body.geometry ? ("stub" as never) : null,
        centroid: body.centroid ? ("stub" as never) : null,
        source: "STUDENT",
        verificationStatus: "PENDING",
        createdBy: authorId,
      })
      .returning();

    const row = inserted[0]!;

    // Compléments géométriques calculés par PostGIS.
    if (body.geometry || body.centroid) {
      await this.db.execute(sql`
        UPDATE buildings SET
          footprint = ${geometrySql},
          footprint_area_m2 = CASE WHEN ${geometrySql} IS NULL THEN NULL
            ELSE ST_Area((${geometrySql})::geography) END,
          centroid = CASE WHEN ${geometrySql} IS NULL THEN
            ${body.centroid ? sql`ST_SetSRID(ST_MakePoint(${body.centroid.lng}, ${body.centroid.lat}), 4326)` : sql`NULL`}
          ELSE ST_Centroid(${geometrySql}) END
        WHERE id = ${row.id}
      `);
    }

    return this.byId(row.id);
  }

  async update(id: string, body: UpdateBuildingBody, authorId: string): Promise<Building> {
    const before = await this.byId(id);

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.shortName !== undefined) updates.shortName = body.shortName;
    if (body.category !== undefined) updates.category = body.category;
    if (body.facultyId !== undefined) updates.facultyId = body.facultyId;
    if (body.description !== undefined) updates.description = body.description;
    if (body.floors !== undefined) updates.floors = body.floors;

    await this.db.update(buildings).set(updates).where(eq(buildings.id, id));

    if (body.geometry !== undefined) {
      const geom = body.geometry ? sql`ST_GeomFromGeoJSON(${JSON.stringify(body.geometry)})` : sql`NULL`;
      await this.db.execute(sql`
        UPDATE buildings SET
          footprint = ${geom},
          footprint_area_m2 = CASE WHEN ${geom} IS NULL THEN NULL ELSE ST_Area((${geom})::geography) END,
          centroid = CASE WHEN ${geom} IS NULL THEN NULL ELSE ST_Centroid(${geom}) END,
          verification_status = 'PENDING',
          updated_at = now()
        WHERE id = ${id}
      `);
    }

    // Historique : trace du diff, en JSON.
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(body) as Array<keyof UpdateBuildingBody>) {
      const previous = (before as unknown as Record<string, unknown>)[key];
      const next = (body as Record<string, unknown>)[key];
      if (next !== undefined && previous !== next) {
        diff[key] = { from: previous, to: next };
      }
    }
    if (Object.keys(diff).length > 0) {
      await this.db.insert(buildingHistory).values({
        buildingId: id,
        changedBy: authorId,
        changeType: "UPDATE",
        diff: JSON.stringify(diff),
      });
    }

    return this.byId(id);
  }

  /**
   * Vote de vérification. Un utilisateur ne peut voter qu'une fois par bâtiment
   * (index unique). Trois votes VERIFY consécutifs promeuvent en VERIFIED ;
   * trois REJECT passent en REJECTED.
   */
  async verify(
    id: string,
    body: VerifyBuildingBody,
    userId: string,
  ): Promise<{ verificationStatus: VerificationStatus; totals: { verify: number; reject: number } }> {
    const building = await this.byId(id);

    const already = await this.db
      .select({ id: buildingVerifications.id })
      .from(buildingVerifications)
      .where(
        and(eq(buildingVerifications.buildingId, id), eq(buildingVerifications.userId, userId)),
      )
      .limit(1);

    if (already.length > 0) {
      throw new ConflictError("Vous avez déjà voté pour ce bâtiment.");
    }

    await this.db.insert(buildingVerifications).values({
      buildingId: id,
      userId,
      action: body.action,
      comment: body.comment ?? null,
    });

    const totals = await this.db
      .select({ action: buildingVerifications.action, value: count() })
      .from(buildingVerifications)
      .where(eq(buildingVerifications.buildingId, id))
      .groupBy(buildingVerifications.action);

    const verifyCount = Number(totals.find((t) => t.action === "VERIFY")?.value ?? 0);
    const rejectCount = Number(totals.find((t) => t.action === "REJECT")?.value ?? 0);

    let nextStatus: VerificationStatus = building.verificationStatus as VerificationStatus;
    if (verifyCount >= 3 && verifyCount > rejectCount * 2) nextStatus = "VERIFIED";
    else if (rejectCount >= 3 && rejectCount > verifyCount) nextStatus = "REJECTED";
    else if (body.action === "REPORT_OUTDATED") nextStatus = "OUTDATED";

    await this.db
      .update(buildings)
      .set({
        verificationStatus: nextStatus,
        verificationCount: verifyCount,
        lastVerifiedAt: nextStatus === "VERIFIED" ? new Date() : building.lastVerifiedAt ? new Date(building.lastVerifiedAt) : null,
        lastVerifiedBy: nextStatus === "VERIFIED" ? userId : null,
        updatedAt: new Date(),
      })
      .where(eq(buildings.id, id));

    return { verificationStatus: nextStatus, totals: { verify: verifyCount, reject: rejectCount } };
  }

  async history(id: string): Promise<
    Array<{ id: string; changeType: string; diff: unknown; changedBy: string | null; createdAt: string }>
  > {
    const rows = await this.db
      .select()
      .from(buildingHistory)
      .where(eq(buildingHistory.buildingId, id))
      .orderBy(sql`${buildingHistory.createdAt} DESC`)
      .limit(50);

    return rows.map((row) => ({
      id: row.id,
      changeType: row.changeType,
      diff: safeParseJson(row.diff),
      changedBy: row.changedBy,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** Salles d'un bâtiment. */
  async roomsOf(buildingId: string): Promise<
    Array<{
      id: string;
      code: string;
      name: string;
      capacity: number;
      floor: number;
      roomType: string;
      isAccessible: boolean;
      isOpen: boolean;
    }>
  > {
    await this.byId(buildingId); // 404 si le bâtiment n'existe pas
    const rows = await this.db
      .select()
      .from(rooms)
      .where(eq(rooms.buildingId, buildingId))
      .orderBy(rooms.floor, rooms.code);

    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      capacity: r.capacity,
      floor: r.floor,
      roomType: r.roomType,
      isAccessible: r.isAccessible,
      isOpen: r.isOpen,
    }));
  }

  /** Nœuds du graphe piéton exposés à la navigation. */
  async navigationNodes(): Promise<Array<{ id: string; lat: number; lng: number; label: string }>> {
    const rows = await this.db
      .select({
        id: buildings.id,
        code: buildings.code,
        name: buildings.name,
        lat: sql<number>`ST_Y(${buildings.entrance}::geometry)`,
        lng: sql<number>`ST_X(${buildings.entrance}::geometry)`,
      })
      .from(buildings)
      .where(and(sql`${buildings.entrance} IS NOT NULL`, sql`${buildings.deletedAt} IS NULL`));

    return rows.map((r) => ({
      id: r.code,
      lat: r.lat,
      lng: r.lng,
      label: r.name,
    }));
  }

  /** Interdit la modification par un non-propriétaire non-modérateur. */
  assertCanEdit(authorRole: string, authorId: string, createdBy: string | null): void {
    if (authorRole === "ADMIN" || authorRole === "MODERATOR") return;
    if (createdBy && createdBy === authorId) return;
    throw new AuthorizationError(
      "Seuls le créateur du bâtiment ou un modérateur peuvent le modifier.",
    );
  }

  private toDto(row: typeof buildings.$inferSelect, facultyName: string | null): Building {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      shortName: row.shortName,
      category: row.category as Building["category"],
      facultyId: row.facultyId,
      facultyName,
      description: row.description,
      floors: row.floors,
      footprintAreaM2: row.footprintAreaM2,
      centroid: row.centroid ? safeParsePoint(row.centroid) : null,
      geometry: null, // chargé à la demande via /buildings/:id/geometry
      source: row.source as Building["source"],
      verificationStatus: row.verificationStatus as VerificationStatus,
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
      isGeoreferenced: row.source === "INSTITUTIONAL" && row.verificationStatus === "VERIFIED",
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/** Parse un POINT(x y) renvoyé par PostGIS en { lat, lng }. */
function safeParsePoint(value: unknown): { type: "Point"; coordinates: [number, number] } | null {
  if (typeof value !== "string") return null;
  // PostGIS renvoie du WKB hex ou du EWKT selon le driver ; on gère l'EWKT.
  const match = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(value);
  if (!match) return null;
  const lng = Number(match[1]);
  const lat = Number(match[2]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { type: "Point", coordinates: [lng, lat] };
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export type { RouteStep };
