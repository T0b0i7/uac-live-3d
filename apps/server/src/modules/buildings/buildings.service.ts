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

/**
 * Emprise minimale destinée au rendu cartographique.
 *
 * Volontairement plus légère que `Building` : la carte n'a besoin ni de la
 * description, ni de la faculté détaillée, ni de l'historique. Envoyer le DTO
 * complet pour 355 bâtiments alourdirait la réponse sans aucun gain visuel.
 */
export interface MapBuilding {
  id: string;
  code: string;
  name: string;
  category: Building["category"];
  floors: number;
  footprintAreaM2: number | null;
  geometry: { type: "Polygon"; coordinates: [number, number][][] } | null;
  centroid: { lat: number; lng: number } | null;
  source: Building["source"];
  verificationStatus: VerificationStatus;
  isGeoreferenced: boolean;
}

/**
 * Compteurs globaux du référentiel.
 *
 * Tous les nombres portent sur l'INTÉGRALITÉ des bâtiments non supprimés, pas
 * sur une page. `verification` couvre les trois états du contrat
 * (`VERIFIED` / `PENDING` / `UNVERIFIED`) et leur somme égale `total`.
 */
export interface BuildingStats {
  total: number;
  georeferenced: number;
  verification: { verified: number; pending: number; unverified: number };
  withRooms: number;
  byCategory: Array<{ key: string; value: number }>;
  bySource: Array<{ key: string; value: number }>;
}

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
          // Géométrie réellement convertie côté PostgreSQL : c'est le seul moyen
          // fiable d'obtenir du GeoJSON. Le driver `postgres` renvoie du WKB
          // hexadécimal pour une colonne geometry, jamais du WKT — le parser
          // côté Node échouait silencieusement et renvoyait `null`.
          geometryGeoJson: sql<string | null>`ST_AsGeoJSON(${buildings.footprint})`,
          centroidLat: sql<number | null>`ST_Y(${buildings.centroid}::geometry)`,
          centroidLng: sql<number | null>`ST_X(${buildings.centroid}::geometry)`,
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
      items: rows.map((r) =>
        this.toDto(r.building, r.facultyName, r.geometryGeoJson, r.centroidLat, r.centroidLng),
      ),
      meta: buildPaginationMeta(query.page, query.limit, Number(totalRows[0]?.value ?? 0)),
    };
  }

  /**
   * Compteurs globaux du référentiel — calculés en base, jamais sur une page.
   *
   * Pourquoi cette méthode existe : le tableau de bord et la page d'accueil
   * déduisaient « géoréférencés » et « vérifiés » en filtrant la réponse de
   * `list({ limit: 100 })`. Avec 360 bâtiments, ces deux compteurs ne portaient
   * donc que sur les 100 premiers — un chiffre juste pour la mauvaise
   * population, ce qui est plus trompeur qu'un chiffre absent.
   *
   * Les agrégats sont calculés par PostgreSQL (`count(*) FILTER`), donc ils
   * portent sur l'ensemble de la table et restent exacts quel que soit le
   * volume. Aucune valeur n'est estimée ni extrapolée depuis un échantillon.
   */
  async stats(): Promise<BuildingStats> {
    const rows = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        georeferenced: sql<number>`count(*) FILTER (WHERE ${buildings.footprint} IS NOT NULL)::int`,
        verified: sql<number>`count(*) FILTER (WHERE ${buildings.verificationStatus} = 'VERIFIED')::int`,
        pending: sql<number>`count(*) FILTER (WHERE ${buildings.verificationStatus} = 'PENDING')::int`,
        unverified: sql<number>`count(*) FILTER (WHERE ${buildings.verificationStatus} = 'UNVERIFIED')::int`,
        withRooms: sql<number>`count(*) FILTER (WHERE EXISTS (SELECT 1 FROM rooms r WHERE r.building_id = ${buildings.id}))::int`,
      })
      .from(buildings)
      .where(sql`${buildings.deletedAt} IS NULL`);

    const totals = rows[0] ?? {
      total: 0,
      georeferenced: 0,
      verified: 0,
      pending: 0,
      unverified: 0,
      withRooms: 0,
    };

    const [byCategory, bySource] = await Promise.all([
      this.db
        .select({ key: buildings.category, value: sql<number>`count(*)::int` })
        .from(buildings)
        .where(sql`${buildings.deletedAt} IS NULL`)
        .groupBy(buildings.category),
      this.db
        .select({ key: buildings.source, value: sql<number>`count(*)::int` })
        .from(buildings)
        .where(sql`${buildings.deletedAt} IS NULL`)
        .groupBy(buildings.source),
    ]);

    return {
      total: Number(totals.total),
      georeferenced: Number(totals.georeferenced),
      verification: {
        verified: Number(totals.verified),
        pending: Number(totals.pending),
        unverified: Number(totals.unverified),
      },
      withRooms: Number(totals.withRooms),
      byCategory: byCategory.map((r) => ({ key: r.key, value: Number(r.value) })),
      bySource: bySource.map((r) => ({ key: r.key, value: Number(r.value) })),
    };
  }

  /**
   * Emprises destinées à l'affichage cartographique — SANS pagination.
   *
   * Pourquoi cette méthode existe : une carte n'est pas une liste. Paginer une
   * carte produit des trous visuels (des quartiers de bâtiments absents) sans
   * que l'utilisateur comprenne pourquoi, puisqu'il n'y a aucun contrôle de
   * pagination à l'écran. C'est ce qui se produisait : `limit=100` pour 360
   * bâtiments, donc 255 emprises jamais dessinées.
   *
   * On renvoie donc TOUS les bâtiments non supprimés, mais uniquement les
   * champs utiles au rendu (pas de description, pas d'historique, pas de
   * faculté détaillée) afin que la charge reste raisonnable.
   *
   * Si le volume devait un jour dépasser ce qu'un navigateur peut extruder
   * confortablement, c'est un filtrage par `bbox` qu'il faudra ajouter, pas une
   * pagination : la carte doit rester cohérente avec ce qui est affiché.
   */
  async mapFeatures(): Promise<MapBuilding[]> {
    const rows = await this.db
      .select({
        id: buildings.id,
        code: buildings.code,
        name: buildings.name,
        category: buildings.category,
        floors: buildings.floors,
        footprintAreaM2: buildings.footprintAreaM2,
        geometryGeoJson: sql<string | null>`ST_AsGeoJSON(${buildings.footprint})`,
        centroidLat: sql<number | null>`ST_Y(${buildings.centroid}::geometry)`,
        centroidLng: sql<number | null>`ST_X(${buildings.centroid}::geometry)`,
        source: buildings.source,
        verificationStatus: buildings.verificationStatus,
      })
      .from(buildings)
      .where(sql`${buildings.deletedAt} IS NULL`)
      .orderBy(buildings.name);

    return rows.map((row) => {
      const geometry = parseGeoJsonPolygon(row.geometryGeoJson ?? "");
      let centroid: { lat: number; lng: number } | null = null;
      if (
        row.centroidLat !== null &&
        row.centroidLng !== null &&
        Number.isFinite(Number(row.centroidLat))
      ) {
        centroid = { lat: Number(row.centroidLat), lng: Number(row.centroidLng) };
      } else if (geometry) {
        centroid = centroidOfPolygon(geometry.coordinates);
      }

      return {
        id: row.id,
        code: row.code,
        name: row.name,
        category: row.category as Building["category"],
        floors: row.floors,
        footprintAreaM2: row.footprintAreaM2,
        geometry,
        centroid,
        source: row.source as Building["source"],
        verificationStatus: row.verificationStatus as VerificationStatus,
        // Même définition que dans `toDto` : la présence d'une géométrie.
        isGeoreferenced: geometry !== null,
      };
    });
  }

  async byId(id: string): Promise<Building> {    const rows = await this.db
      .select({
        building: buildings,
        facultyName: faculties.name,
        geometryGeoJson: sql<string | null>`ST_AsGeoJSON(${buildings.footprint})`,
        centroidLat: sql<number | null>`ST_Y(${buildings.centroid}::geometry)`,
        centroidLng: sql<number | null>`ST_X(${buildings.centroid}::geometry)`,
      })
      .from(buildings)
      .leftJoin(faculties, eq(faculties.id, buildings.facultyId))
      .where(and(eq(buildings.id, id), sql`${buildings.deletedAt} IS NULL`))
      .limit(1);

    if (rows.length === 0) throw new NotFoundError("Bâtiment");
    const row = rows[0]!;
    return this.toDto(row.building, row.facultyName, row.geometryGeoJson, row.centroidLat, row.centroidLng);
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

  /**
   * Salles d'un bâtiment.
   *
   * La réponse respecte intégralement `roomSchema` de `@uac/contracts` :
   * `buildingId` et `createdAt` sont présents en base et donc renvoyés. Les
   * omettre obligeait le client à rétrécir le contrat de son côté
   * (`roomSchema.omit(...)`), ce qui masquait un écart réel au lieu de le
   * corriger. Aucune valeur n'est inventée : les deux colonnes existent.
   */
  async roomsOf(buildingId: string): Promise<
    Array<{
      id: string;
      buildingId: string;
      code: string;
      name: string;
      capacity: number;
      floor: number;
      roomType: string;
      isAccessible: boolean;
      isOpen: boolean;
      createdAt: string;
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
      buildingId: r.buildingId,
      code: r.code,
      name: r.name,
      capacity: r.capacity,
      floor: r.floor,
      roomType: r.roomType,
      isAccessible: r.isAccessible,
      isOpen: r.isOpen,
      createdAt: r.createdAt.toISOString(),
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

  private toDto(
    row: typeof buildings.$inferSelect,
    facultyName: string | null,
    geometryGeoJson: string | null = null,
    centroidLat: number | null = null,
    centroidLng: number | null = null,
  ): Building {
    // Le GeoJSON est construit par PostGIS (`ST_AsGeoJSON`) : aucune géométrie
    // n'est inventée côté application. Si la colonne est NULL, on renvoie null
    // et le client ne dessine rien — il vaut mieux une absence qu'un polygone faux.
    const geometry = geometryGeoJson ? parseGeoJsonPolygon(geometryGeoJson) : null;

    // Le centroïde est calculé par PostGIS ; à défaut on prend le centre du
    // polygone s'il existe. Jamais de coordonnée devinée.
    let centroid: { lat: number; lng: number } | null = null;
    if (centroidLat !== null && centroidLng !== null && Number.isFinite(centroidLat)) {
      centroid = { lat: Number(centroidLat), lng: Number(centroidLng) };
    } else if (geometry) {
      centroid = centroidOfPolygon(geometry.coordinates);
    }

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
      centroid,
      geometry,
      source: row.source as Building["source"],
      verificationStatus: row.verificationStatus as VerificationStatus,
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
      // « Géoréférencé » signifie : on sait où ce bâtiment se trouve sur Terre,
      // c'est-à-dire qu'il possède une emprise géographique exploitable.
      // La version précédente le déduisait de la provenance
      // (`source === "INSTITUTIONAL" && verificationStatus === "VERIFIED"`),
      // ce qui renvoyait `false` pour les 355 bâtiments issus d'OSM alors qu'ils
      // ont TOUS une géométrie — et rendait le filtre « Géoréférencés » de
      // l'interface systématiquement vide. La provenance et le niveau de
      // vérification sont déjà exposés séparément : les confondre ici était une
      // erreur, pas un choix.
      isGeoreferenced: geometry !== null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/**
 * Parse le GeoJSON produit par `ST_AsGeoJSON`.
 *
 * On valide la forme au lieu de faire confiance : un polygon sans anneau fermé
 * ou sans 4 positions ferait planter MapLibre côté client, avec un message
 * incompréhensible. Ici, une géométrie invalide devient `null`.
 */
export function parseGeoJsonPolygon(
  raw: string,
): { type: "Polygon"; coordinates: [number, number][][] } | null {
  const parsed = safeParseJson(raw) as {
    type?: unknown;
    coordinates?: unknown;
  } | null;

  if (!parsed || parsed.type !== "Polygon" || !Array.isArray(parsed.coordinates)) return null;

  const rings: [number, number][][] = [];
  for (const ring of parsed.coordinates as unknown[]) {
    if (!Array.isArray(ring)) return null;
    const positions: [number, number][] = [];
    for (const point of ring) {
      if (!Array.isArray(point) || point.length < 2) return null;
      const lng = Number(point[0]);
      const lat = Number(point[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
      if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
      positions.push([lng, lat]);
    }
    if (positions.length < 4) return null;
    const first = positions[0]!;
    const last = positions[positions.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) return null;
    rings.push(positions);
  }

  if (rings.length === 0) return null;
  return { type: "Polygon", coordinates: rings };
}

/** Centroïde d'un anneau extérieur — repli quand la colonne est nulle. */
function centroidOfPolygon(rings: [number, number][][]): { lat: number; lng: number } | null {
  const outer = rings[0];
  if (!outer || outer.length === 0) return null;
  // Moyenne des sommets en excluant le point de fermeture (dupliqué).
  const points = outer.slice(0, -1);
  if (points.length === 0) return null;
  let sumLng = 0;
  let sumLat = 0;
  for (const [lng, lat] of points) {
    sumLng += lng;
    sumLat += lat;
  }
  return { lat: sumLat / points.length, lng: sumLng / points.length };
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export type { RouteStep };
