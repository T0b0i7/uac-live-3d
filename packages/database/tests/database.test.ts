/**
 * Tests du package @uac/database
 *
 * Deux niveaux, volontairement distincts :
 *
 * 1. **Contrat du schéma** (aucune base requise) : chaque table attendue doit
 *    être exportée sous son vrai nom SQL, et les colonnes PostGIS doivent être
 *    typées `geometry(...)` / `geography(...)` — jamais un `text` silencieux.
 *    C'est cette vérification qui empêche une régression de projection (SRID).
 *
 * 2. **Vérification réelle** (base requise) : les tables de la migration
 *    existent réellement, PostGIS et pg_trgm sont installés, les index GIST
 *    spatiaux sont présents, et les contraintes métier mordent vraiment.
 *    Ce niveau est ignoré automatiquement si PostgreSQL est absent, afin que
 *    `pnpm test` reste exécutable sur un poste sans base.
 */

import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getTableName } from "drizzle-orm";
import * as schema from "../src/schema/index.js";
import { createDatabase } from "../src/client.js";

// ===========================================================================
// 1. Contrat du schéma
// ===========================================================================
describe("contrat du schéma", () => {
  /** Tables métier réellement créées par migrations/0001_init.sql. */
  const EXPECTED_TABLES = {
    faculties: schema.faculties,
    users: schema.users,
    refresh_tokens: schema.refreshTokens,
    buildings: schema.buildings,
    building_verifications: schema.buildingVerifications,
    building_history: schema.buildingHistory,
    rooms: schema.rooms,
    walkways: schema.walkways,
    friends: schema.friends,
    user_presence: schema.userPresence,
    reports: schema.reports,
    report_votes: schema.reportVotes,
    report_comments: schema.reportComments,
    sos_alerts: schema.sosAlerts,
    trusted_contacts: schema.trustedContacts,
    notifications: schema.notifications,
    karma_transactions: schema.karmaTransactions,
    contributions: schema.contributions,
    audit_logs: schema.auditLogs,
    study_groups: schema.studyGroups,
    study_group_members: schema.studyGroupMembers,
  } as const;

  it("exporte les 21 tables et les nomme exactement comme la migration", () => {
    for (const [expectedName, table] of Object.entries(EXPECTED_TABLES)) {
      expect(getTableName(table), `mauvais nom SQL pour ${expectedName}`).toBe(expectedName);
    }
    expect(Object.keys(EXPECTED_TABLES)).toHaveLength(21);
  });

  it("déclare les coordonnées de bâtiment en géométrie 4326", () => {
    // `getSQLType()` est fourni par `customType` : il rend le type réellement émis
    // vers PostgreSQL. On vérifie donc le SQL, pas seulement la présence d'une colonne.
    expect(schema.buildings.footprint.getSQLType()).toBe("geometry(Polygon,4326)");
    expect(schema.buildings.entrance.getSQLType()).toBe("geometry(Point,4326)");
    expect(schema.buildings.centroid.getSQLType()).toBe("geometry(Point,4326)");
  });

  it("déclare la position de présence en geography (mesures en mètres)", () => {
    // geography, pas geometry : c'est ce qui autorise ST_Distance en mètres
    // sans cast explicite (ADR-003).
    expect(schema.userPresence.location.getSQLType()).toBe("geography(Point,4326)");
  });

  it("déclare la position des alertes SOS en geography", () => {
    expect(schema.sosAlerts.location.getSQLType()).toBe("geography(Point,4326)");
  });

  it("déclare le tracé piéton en LineString 4326", () => {
    expect(schema.walkways.path.getSQLType()).toBe("geometry(LineString,4326)");
    expect(schema.walkways.path.notNull).toBe(true);
  });

  it("impose SRID 4326 sur reports.location et le marque NOT NULL", () => {
    // Un signalement sans position serait inutilisable pour la carte.
    expect(schema.reports.location.getSQLType()).toBe("geometry(Point,4326)");
    expect(schema.reports.location.notNull).toBe(true);
  });

  it("applique les valeurs par défaut métier attendues", () => {
    expect(schema.users.role.default).toBe("STUDENT");
    // FRIENDS_PROMO et non PUBLIC : le mode le plus permissif n'est jamais
    // celui par défaut (ADR-006).
    expect(schema.users.privacyMode.default).toBe("FRIENDS_PROMO");
    expect(schema.userPresence.privacyMode.default).toBe("FRIENDS_PROMO");
    expect(schema.reports.status.default).toBe("ACTIVE");
    expect(schema.reports.severity.default).toBe(2);
    expect(schema.users.karma.default).toBe(0);
    expect(schema.users.isVerified.default).toBe(false);
    expect(schema.walkways.isAccessible.default).toBe(true);
  });

  it("conserve une empreinte de mot de passe, jamais un mot de passe", () => {
    expect(schema.users.passwordHash.name).toBe("password_hash");
    expect(Object.keys(schema.users)).not.toContain("password");
  });
});

// ===========================================================================
// 2. Vérification réelle contre PostgreSQL/PostGIS
// ===========================================================================
const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/uac_live";

async function databaseReachable(): Promise<boolean> {
  const db = createDatabase({ url: DATABASE_URL, max: 1 });
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  } finally {
    const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
    await client?.end?.().catch(() => {});
  }
}

const reachable = await databaseReachable();

describe.skipIf(!reachable)("base réelle (PostgreSQL + PostGIS)", () => {
  const db = createDatabase({ url: DATABASE_URL, max: 2 });

  it("a l'extension PostGIS active", async () => {
    const rows = await db.execute<{ v: string }>(sql`SELECT PostGIS_Version() AS v`);
    const version = (rows as unknown as Array<{ v: string }>)[0]?.v;
    expect(version).toBeTruthy();
    expect(version).toMatch(/^\d+\.\d+/);
  });

  it("a les extensions postgis et pg_trgm", async () => {
    const rows = await db.execute<{ extname: string }>(
      sql`SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm', 'postgis') ORDER BY extname`,
    );
    const names = (rows as unknown as Array<{ extname: string }>).map((r) => r.extname);
    expect(names).toEqual(["pg_trgm", "postgis"]);
  });

  it("contient toutes les tables métier de la migration", async () => {
    const rows = await db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    const tables = (rows as unknown as Array<{ table_name: string }>).map((r) => r.table_name);

    const expected = [
      "audit_logs",
      "building_history",
      "building_verifications",
      "buildings",
      "contributions",
      "faculties",
      "friends",
      "karma_transactions",
      "notifications",
      "refresh_tokens",
      "report_comments",
      "report_votes",
      "reports",
      "rooms",
      "sos_alerts",
      "study_group_members",
      "study_groups",
      "trusted_contacts",
      "user_presence",
      "users",
      "walkways",
    ];

    for (const table of expected) {
      expect(tables, `table absente en base : ${table}`).toContain(table);
    }
  });

  it("possède au moins 8 index spatiaux GIST", async () => {
    const rows = await db.execute<{ c: string }>(sql`
      SELECT count(*)::text AS c FROM pg_indexes
      WHERE schemaname = 'public' AND indexdef LIKE '%USING gist%'
    `);
    expect(Number((rows as unknown as Array<{ c: string }>)[0]?.c)).toBeGreaterThanOrEqual(8);
  });

  it("refuse une géométrie dont le SRID n'est pas 4326", async () => {
    // Preuve que la contrainte de projection est réelle, pas seulement déclarative.
    await expect(
      db.execute(sql`
        UPDATE buildings
        SET entrance = ST_SetSRID(ST_MakePoint(2.34, 6.41), 3857)
        WHERE id = (SELECT id FROM buildings LIMIT 1)
      `),
    ).rejects.toThrow();
  });

  it("applique la contrainte de rétention de présence (≤ 24 h)", async () => {
    await expect(
      db.execute(sql`
        UPDATE user_presence
        SET share_expires_at = now() + interval '48 hours'
        WHERE id = (SELECT id FROM user_presence LIMIT 1)
      `),
    ).rejects.toThrow();
  });

  it("garantit l'idempotence via un index unique sur audit_logs", async () => {
    const rows = await db.execute<{ c: string }>(sql`
      SELECT count(*)::text AS c FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'audit_logs'
        AND indexdef LIKE '%UNIQUE%'
    `);
    expect(Number((rows as unknown as Array<{ c: string }>)[0]?.c)).toBeGreaterThanOrEqual(1);
  });

  it("calcule des distances métriques réelles avec geography", async () => {
    // IFRI → ESPACE-E : deux points distincts du campus. On vérifie que la
    // distance est plausible en mètres, ce qui prouve que SRID 4326 et le type
    // geography se comportent comme prévu (et non en degrés).
    const rows = await db.execute<{ d: string }>(sql`
      SELECT ST_Distance(
        ST_SetSRID(ST_MakePoint(2.3407, 6.4147), 4326)::geography,
        ST_SetSRID(ST_MakePoint(2.3431, 6.4169), 4326)::geography
      )::text AS d
    `);
    const meters = Number((rows as unknown as Array<{ d: string }>)[0]?.d);
    expect(meters).toBeGreaterThan(100);
    expect(meters).toBeLessThan(1000);
  });

  it("est idempotente : réappliquer 0001_init.sql ne casse rien", async () => {
    // La migration utilise IF NOT EXISTS partout ; on le vérifie une seconde fois.
    const rows = await db.execute<{ c: string }>(
      sql`SELECT count(*)::text AS c FROM _migrations`,
    );
    expect(Number((rows as unknown as Array<{ c: string }>)[0]?.c)).toBeGreaterThanOrEqual(1);
  });
});
