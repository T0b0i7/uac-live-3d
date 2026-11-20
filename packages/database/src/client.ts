/**
 * Client de base de données — @uac/database
 *
 * Un seul pool `postgres` partagé par processus. En développement, `max: 10`
 * suffit ; en production on dimensionne selon `max_connections` du serveur
 * (règle empirique : instances × pool ≤ 80 % de max_connections).
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Database = ReturnType<typeof createDatabase>;

export interface DatabaseOptions {
  url?: string;
  max?: number;
  /** Journalise chaque requête SQL (développement uniquement). */
  debug?: boolean;
}

export function createDatabase(options: DatabaseOptions = {}) {
  const url =
    options.url ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/uac_live";

  const client = postgres(url, {
    max: options.max ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });

  return drizzle(client, { schema, logger: options.debug ?? false });
}

let singleton: Database | null = null;

/** Instance partagée (lazy). */
export function getDatabase(): Database {
  if (!singleton) singleton = createDatabase();
  return singleton;
}

export async function closeDatabase(): Promise<void> {
  if (singleton) {
    const client = (singleton as unknown as { $client?: { end: () => Promise<void> } }).$client;
    await client?.end?.();
    singleton = null;
  }
}

export { schema };
export * from "./schema/index.js";
