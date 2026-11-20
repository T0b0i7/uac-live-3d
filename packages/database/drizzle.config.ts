import { defineConfig } from "drizzle-kit";

/**
 * Configuration Drizzle Kit.
 *
 * Le schéma est généré en SQL pur puis appliqué par notre propre runner
 * (`src/migrate.ts`), ce qui nous laisse la main sur l'ordre d'exécution des
 * extensions PostGIS et sur la journalisation.
 */
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5432/uac_live",
  },
  verbose: true,
  strict: true,
});
