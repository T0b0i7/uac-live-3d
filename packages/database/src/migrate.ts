/**
 * Runner de migrations — @uac/database
 *
 * Pourquoi un runner maison plutôt que `drizzle-kit migrate` :
 *  - il applique des fichiers SQL explicites (extensions avant géométrie) ;
 *  - il enregistre un checksum, ce qui détecte une migration modifiée après coup ;
 *  - il refuse silencieusement de rejouer une migration déjà appliquée.
 *
 * Utilisation : `pnpm --filter @uac/database migrate`
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

function checksum(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 64);
}

async function ensureMigrationsTable(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         varchar(120) PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now(),
      checksum   varchar(64) NOT NULL
    )
  `;
}

export async function runMigrations(databaseUrl?: string): Promise<{
  applied: string[];
  skipped: string[];
}> {
  const url =
    databaseUrl ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/uac_live";

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await ensureMigrationsTable(sql);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const content = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      const hash = checksum(content);

      const existing = await sql<{ checksum: string }[]>`
        SELECT checksum FROM _migrations WHERE id = ${file}
      `;

      if (existing.length > 0) {
        if (existing[0]!.checksum !== hash) {
          throw new Error(
            `La migration "${file}" a été modifiée après application (checksum différent). ` +
              `Créez une nouvelle migration au lieu de modifier une migration déjà appliquée.`,
          );
        }
        skipped.push(file);
        continue;
      }

      // Le SQL est exécuté tel quel ; les fichiers gèrent leur propre BEGIN/COMMIT.
      await sql.unsafe(content);
      await sql`INSERT INTO _migrations (id, checksum) VALUES (${file}, ${hash})`;
      applied.push(file);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  return { applied, skipped };
}

// Exécution directe (tsx src/migrate.ts)
const isDirectRun =
  process.argv[1]?.endsWith("migrate.ts") || process.argv[1]?.endsWith("migrate.js");

if (isDirectRun) {
  runMigrations()
    .then(({ applied, skipped }) => {
      if (applied.length === 0) {
        console.log(`Migrations : aucune nouvelle (${skipped.length} déjà appliquée(s)).`);
      } else {
        console.log(`Migrations appliquées : ${applied.join(", ")}`);
        if (skipped.length > 0) console.log(`Déjà présentes : ${skipped.join(", ")}`);
      }
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error("Échec des migrations :", error);
      process.exit(1);
    });
}
