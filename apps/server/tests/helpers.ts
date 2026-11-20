/**
 * Harnais de test d'intégration — apps/server/tests/helpers.ts
 *
 * Construit une vraie application Fastify contre la vraie base PostgreSQL/PostGIS
 * et le vrai Redis. Les tests tournent donc sur un schéma réel, pas sur des mocks :
 * c'est la seule façon de prouver que `app.inject` traverse réellement
 * validation → service → PostGIS → réponse.
 */

import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createDatabase, type Database } from "@uac/database";
import { buildApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config/env.js";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/uac_live";

export const DEMO_EMAIL = "demo@uac-live.bj";
export const DEMO_PASSWORD = "CampusUac2026";

export interface TestContext {
  app: FastifyInstance;
  db: Database;
  config: AppConfig;
  close(): Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
    JWT_REFRESH_SECRET: "test-refresh-secret-at-least-32-characters-long",
    IP_HASH_SALT: "test-ip-hash-salt-16chars",
    CORS_ORIGINS: "http://localhost:3000",
  });

  const db = createDatabase({ url: TEST_DATABASE_URL, max: 5 });
  const app = await buildApp({ config, db });
  await app.ready();

  return {
    app,
    db,
    config,
    async close() {
      await app.close();
    },
  };
}

/** Vérifie que la base contient bien les données de démonstration. */
export async function assertSeedPresent(db: Database): Promise<void> {
  const rows = await db.execute<{ c: string }>(
    sql`SELECT count(*)::text AS c FROM buildings WHERE deleted_at IS NULL`,
  );
  const count = Number((rows as unknown as Array<{ c: string }>)[0]?.c ?? 0);
  if (count === 0) {
    throw new Error(
      "La base de test ne contient aucun bâtiment. Exécutez d'abord :\n" +
        "  pnpm --filter @uac/database migrate && pnpm --filter @uac/database seed",
    );
  }
}

/** Connexion réelle du compte de démonstration, via l'API (pas de faux JWT). */
export async function loginAsDemo(
  app: FastifyInstance,
): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });

  if (response.statusCode !== 200) {
    throw new Error(
      `Connexion de démonstration impossible (HTTP ${response.statusCode}) : ${response.body}`,
    );
  }

  const body = response.json() as {
    data: { tokens: { accessToken: string; refreshToken: string }; user: { id: string } };
  };

  return {
    accessToken: body.data.tokens.accessToken,
    refreshToken: body.data.tokens.refreshToken,
    userId: body.data.user.id,
  };
}

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
