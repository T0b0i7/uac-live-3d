/**
 * Schéma de base — colonnes partagées et helpers PostGIS.
 *
 * Drizzle n'a pas de type natif pour `geometry(Polygon, 4326)` : on déclare la
 * colonne avec `customType`, ce qui préserve le typage TypeScript tout en
 * laissant PostgreSQL/PostGIS gérer la géométrie réelle.
 */

import { customType, timestamp, uuid } from "drizzle-orm/pg-core";

/** Type PostGIS générique — la géométrie reste gérée par PostgreSQL. */
export const geometry = customType<{
  data: string;
  driverData: string;
  config: { type: string; srid: number };
}>({
  dataType(config) {
    const type = config?.type ?? "Geometry";
    const srid = config?.srid ?? 4326;
    return `geometry(${type},${srid})`;
  },
});

export const geography = customType<{
  data: string;
  driverData: string;
  config: { type: string };
}>({
  dataType(config) {
    const type = config?.type ?? "Point";
    return `geography(${type},4326)`;
  },
});

/** Colonnes d'audit minimales, présentes sur la plupart des tables. */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** Identifiant UUID v4 par défaut, généré côté base. */
export const primaryUuid = () => uuid("id").primaryKey().defaultRandom();
