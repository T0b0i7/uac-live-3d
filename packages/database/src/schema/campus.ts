/**
 * Domaine Campus Geography / Building Registry / Rooms.
 *
 * Tables : buildings, building_verifications, building_history, rooms, walkways.
 *
 * Toute colonne géométrique est en SRID 4326 (WGS84). Les distances métriques
 * s'obtiennent avec `::geography` (voir ADR-003). Index GIST sur chaque colonne
 * spatiale, sans quoi les requêtes `ST_DWithin` font un seq scan.
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { geometry, primaryUuid, timestamps } from "./_helpers.js";
import { faculties, users } from "./identity.js";

export const buildings = pgTable(
  "buildings",
  {
    id: primaryUuid(),
    /** Code institutionnel court et stable, ex. `IFRI`. */
    code: varchar("code", { length: 24 }).notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    shortName: varchar("short_name", { length: 32 }),
    category: varchar("category", { length: 24 }).notNull(),
    facultyId: uuid("faculty_id").references(() => faculties.id, { onDelete: "set null" }),
    description: text("description"),
    floors: integer("floors").notNull().default(1),

    /** Emprise au sol réelle. Aire calculée par le serveur en m². */
    footprint: geometry("footprint", { type: "Polygon", srid: 4326 }),
    /** Point d'entrée pour la navigation. */
    entrance: geometry("entrance", { type: "Point", srid: 4326 }),
    centroid: geometry("centroid", { type: "Point", srid: 4326 }),
    footprintAreaM2: real("footprint_area_m2"),

    /** OSM | INSTITUTIONAL | STUDENT — traçabilité de la provenance. */
    source: varchar("source", { length: 16 }).notNull().default("STUDENT"),
    verificationStatus: varchar("verification_status", { length: 16 }).notNull().default("UNVERIFIED"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    lastVerifiedBy: uuid("last_verified_by").references(() => users.id, { onDelete: "set null" }),
    verificationCount: integer("verification_count").notNull().default(0),

    /** Nombre de places assises déclarées, si pertinent. */
    capacity: integer("capacity"),
    isAccessible: boolean("is_accessible").notNull().default(false),
    isOpen: boolean("is_open").notNull().default(true),
    openingHours: varchar("opening_hours", { length: 64 }),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("buildings_code_uq").on(t.code),
    index("buildings_category_idx").on(t.category),
    index("buildings_faculty_idx").on(t.facultyId),
    index("buildings_verification_idx").on(t.verificationStatus),
    index("buildings_footprint_gist").using("gist", sql`${t.footprint}`),
    index("buildings_entrance_gist").using("gist", sql`${t.entrance}`),
    index("buildings_centroid_gist").using("gist", sql`${t.centroid}`),
    index("buildings_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
    check("buildings_floors_positive", sql`${t.floors} >= 1 AND ${t.floors} <= 60`),
    check(
      "buildings_category_valid",
      sql`${t.category} IN ('ACADEMIC','AMPHITHEATER','ADMINISTRATIVE','LIBRARY','RESTAURANT','RESIDENCE','SPORT','HEALTH','SERVICE','OTHER')`,
    ),
    check(
      "buildings_status_valid",
      sql`${t.verificationStatus} IN ('UNVERIFIED','PENDING','VERIFIED','REJECTED','OUTDATED')`,
    ),
    check("buildings_source_valid", sql`${t.source} IN ('OSM','INSTITUTIONAL','STUDENT')`),
  ],
);

export const buildingVerifications = pgTable(
  "building_verifications",
  {
    id: primaryUuid(),
    buildingId: uuid("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 24 }).notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("building_verifications_building_idx").on(t.buildingId),
    index("building_verifications_user_idx").on(t.userId),
    /** Un utilisateur ne peut voter qu'une fois par bâtiment (anti-bourrage). */
    uniqueIndex("building_verifications_unique_vote").on(t.buildingId, t.userId),
    check(
      "building_verifications_action_valid",
      sql`${t.action} IN ('VERIFY','REJECT','REPORT_OUTDATED')`,
    ),
  ],
);

export const buildingHistory = pgTable(
  "building_history",
  {
    id: primaryUuid(),
    buildingId: uuid("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    changeType: varchar("change_type", { length: 32 }).notNull(),
    /** Diff JSON des champs modifiés : { field: { from, to } }. */
    diff: text("diff").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("building_history_building_idx").on(t.buildingId, t.createdAt)],
);

export const rooms = pgTable(
  "rooms",
  {
    id: primaryUuid(),
    buildingId: uuid("building_id")
      .notNull()
      .references(() => buildings.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 24 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    capacity: integer("capacity").notNull().default(0),
    floor: integer("floor").notNull().default(0),
    roomType: varchar("room_type", { length: 16 }).notNull().default("CLASSROOM"),
    isAccessible: boolean("is_accessible").notNull().default(false),
    isOpen: boolean("is_open").notNull().default(true),
    /** Emprise optionnelle de la salle, utile pour la navigation indoor. */
    footprint: geometry("footprint", { type: "Polygon", srid: 4326 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("rooms_building_code_uq").on(t.buildingId, t.code),
    index("rooms_building_idx").on(t.buildingId),
    index("rooms_room_footprint_gist").using("gist", sql`${t.footprint}`),
    check("rooms_capacity_bounds", sql`${t.capacity} >= 0 AND ${t.capacity} <= 5000`),
    check(
      "rooms_type_valid",
      sql`${t.roomType} IN ('AMPHI','CLASSROOM','LAB','OFFICE','LIBRARY','OTHER')`,
    ),
  ],
);

/**
 * Arêtes du graphe piéton. `distance_meters` est stockée : c'est la longueur
 * RÉELLE de l'allée au sol, qui n'est pas égale à la distance Haversine entre
 * ses extrémités (une allée peut être courbe, ou faire un détour).
 */
export const walkways = pgTable(
  "walkways",
  {
    id: primaryUuid(),
    code: varchar("code", { length: 48 }).notNull(),
    path: geometry("path", { type: "LineString", srid: 4326 }).notNull(),
    fromNodeId: varchar("from_node_id", { length: 64 }),
    toNodeId: varchar("to_node_id", { length: 64 }),
    distanceMeters: real("distance_meters").notNull(),
    isAccessible: boolean("is_accessible").notNull().default(true),
    restrictions: text("restrictions"),
    surface: varchar("surface", { length: 16 }).notNull().default("UNKNOWN"),
    source: varchar("source", { length: 16 }).notNull().default("STUDENT"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("walkways_code_uq").on(t.code),
    index("walkways_path_gist").using("gist", sql`${t.path}`),
    check("walkways_distance_positive", sql`${t.distanceMeters} > 0`),
    check(
      "walkways_surface_valid",
      sql`${t.surface} IN ('PAVED','GRAVEL','DIRT','UNKNOWN')`,
    ),
  ],
);

export const buildingsRelations = relations(buildings, ({ one, many }) => ({
  faculty: one(faculties, { fields: [buildings.facultyId], references: [faculties.id] }),
  rooms: many(rooms),
  verifications: many(buildingVerifications),
  history: many(buildingHistory),
}));

export const roomsRelations = relations(rooms, ({ one }) => ({
  building: one(buildings, { fields: [rooms.buildingId], references: [buildings.id] }),
}));

export const buildingVerificationsRelations = relations(buildingVerifications, ({ one }) => ({
  building: one(buildings, { fields: [buildingVerifications.buildingId], references: [buildings.id] }),
  user: one(users, { fields: [buildingVerifications.userId], references: [users.id] }),
}));

export type BuildingRow = typeof buildings.$inferSelect;
export type NewBuildingRow = typeof buildings.$inferInsert;
export type RoomRow = typeof rooms.$inferSelect;
export type WalkwayRow = typeof walkways.$inferSelect;
export type BuildingVerificationRow = typeof buildingVerifications.$inferSelect;
