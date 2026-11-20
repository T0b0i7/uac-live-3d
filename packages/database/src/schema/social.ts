/**
 * Domaine Social Presence / Reports / SOS.
 *
 * Tables : friends, user_presence, reports, report_votes, report_comments,
 *          sos_alerts, trusted_contacts.
 *
 * Points de sécurité :
 *  - `user_presence.location` est en geography(Point) : distances métriques directes.
 *  - `share_expires_at` borne la rétention ; une position expirée n'est jamais diffusée.
 *  - `reports` porte un index GIST : on cherche « les signalements autour de moi ».
 *  - `sos_alerts` n'est JAMAIS supprimée automatiquement avant 90 jours (audit).
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { geography, geometry, primaryUuid, timestamps } from "./_helpers.js";
import { buildings } from "./campus.js";
import { users } from "./identity.js";

export const friends = pgTable(
  "friends",
  {
    id: primaryUuid(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addresseeId: uuid("addressee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 16 }).notNull().default("PENDING"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    /** Empêche les doublons dans les deux sens via une clé triée. */
    uniqueIndex("friends_pair_uq").on(
      sql`least(${t.requesterId}, ${t.addresseeId})`,
      sql`greatest(${t.requesterId}, ${t.addresseeId})`,
    ),
    index("friends_requester_idx").on(t.requesterId),
    index("friends_addressee_idx").on(t.addresseeId),
    check("friends_status_valid", sql`${t.status} IN ('PENDING','ACCEPTED','DECLINED','BLOCKED')`),
    check("friends_not_self", sql`${t.requesterId} <> ${t.addresseeId}`),
  ],
);

export const userPresence = pgTable(
  "user_presence",
  {
    id: primaryUuid(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 24 }).notNull().default("OFFLINE"),
    /**
     * Position réelle. Toujours stockée (sauf mode GHOST où elle reste nulle),
     * mais JAMAIS diffusée telle quelle pour BLURRED_ZONE (ADR-006).
     */
    location: geography("location", { type: "Point" }),
    accuracyMeters: integer("accuracy_meters"),
    buildingId: uuid("building_id").references(() => buildings.id, { onDelete: "set null" }),

    privacyMode: varchar("privacy_mode", { length: 20 }).notNull().default("FRIENDS_PROMO"),
    /** Preuve de consentement explicite au partage — obligatoire. */
    consentGivenAt: timestamp("consent_given_at", { withTimezone: true }).notNull().defaultNow(),
    shareExpiresAt: timestamp("share_expires_at", { withTimezone: true }).notNull(),

    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Une seule ligne de présence par utilisateur : upsert simple. */
    uniqueIndex("user_presence_user_uq").on(t.userId),
    index("user_presence_location_gist").using("gist", sql`${t.location}`),
    index("user_presence_building_idx").on(t.buildingId),
    index("user_presence_expires_idx").on(t.shareExpiresAt),
    check(
      "user_presence_status_valid",
      sql`${t.status} IN ('ON_CAMPUS','IN_BUILDING','IN_CLASS','STUDYING','BREAK','LEAVING','OFFLINE')`,
    ),
    check(
      "user_presence_privacy_valid",
      sql`${t.privacyMode} IN ('PUBLIC','FRIENDS_PROMO','BLURRED_ZONE','GHOST')`,
    ),
    /** Une position n'est jamais partagée plus de 24 h (règle de rétention). */
    check(
      "user_presence_retention",
      sql`${t.shareExpiresAt} <= ${t.consentGivenAt} + interval '24 hours'`,
    ),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: primaryUuid(),
    title: varchar("title", { length: 140 }).notNull(),
    body: text("body"),
    category: varchar("category", { length: 24 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("ACTIVE"),
    severity: integer("severity").notNull().default(2),

    location: geometry("location", { type: "Point", srid: 4326 }).notNull(),
    buildingId: uuid("building_id").references(() => buildings.id, { onDelete: "set null" }),

    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    confirmations: integer("confirmations").notNull().default(0),
    rejections: integer("rejections").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),

    expiresAt: timestamp("expires_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** Clé d'idempotence côté client (ADR-007) : empêche les doublons de rejeu. */
    operationId: uuid("operation_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("reports_location_gist").using("gist", sql`${t.location}`),
    index("reports_building_idx").on(t.buildingId),
    index("reports_status_idx").on(t.status),
    index("reports_category_idx").on(t.category),
    index("reports_created_idx").on(t.createdAt),
    uniqueIndex("reports_operation_uq").on(t.operationId),
    check("reports_severity_bounds", sql`${t.severity} >= 1 AND ${t.severity} <= 5`),
    check(
      "reports_status_valid",
      sql`${t.status} IN ('ACTIVE','CONFIRMED','RESOLVED','EXPIRED','REJECTED')`,
    ),
    check(
      "reports_category_valid",
      sql`${t.category} IN ('MAINTENANCE','SAFETY','CLEANLINESS','CROWD','ACCESSIBILITY','EVENT','LOST_ITEM','OTHER')`,
    ),
    /** Le créateur ne peut pas confirmer son propre signalement (contrainte applicative miroir). */
    check("reports_counts_positive", sql`${t.confirmations} >= 0 AND ${t.rejections} >= 0`),
  ],
);

export const reportVotes = pgTable(
  "report_votes",
  {
    id: primaryUuid(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    vote: integer("vote").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Un seul vote par utilisateur et par signalement. */
    uniqueIndex("report_votes_unique").on(t.reportId, t.userId),
    index("report_votes_report_idx").on(t.reportId),
    check("report_votes_value", sql`${t.vote} IN (-1, 1)`),
  ],
);

export const reportComments = pgTable(
  "report_comments",
  {
    id: primaryUuid(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: varchar("body", { length: 1000 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("report_comments_report_idx").on(t.reportId, t.createdAt)],
);

export const sosAlerts = pgTable(
  "sos_alerts",
  {
    id: primaryUuid(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: varchar("kind", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("ACTIVE"),
    location: geography("location", { type: "Point" }),
    buildingId: uuid("building_id").references(() => buildings.id, { onDelete: "set null" }),
    message: varchar("message", { length: 500 }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: uuid("acknowledged_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    operationId: uuid("operation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sos_alerts_user_idx").on(t.userId, t.createdAt),
    index("sos_alerts_status_idx").on(t.status),
    index("sos_alerts_location_gist").using("gist", sql`${t.location}`),
    uniqueIndex("sos_alerts_operation_uq").on(t.operationId),
    check("sos_alerts_kind_valid", sql`${t.kind} IN ('MEDICAL','SECURITY','HARASSMENT','FIRE','OTHER')`),
    check(
      "sos_alerts_status_valid",
      sql`${t.status} IN ('ACTIVE','ACKNOWLEDGED','CANCELLED','RESOLVED')`,
    ),
  ],
);

export const trustedContacts = pgTable(
  "trusted_contacts",
  {
    id: primaryUuid(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    /** Relation déclarée : parent, ami, tuteur… */
    relationship: varchar("relationship", { length: 48 }),
    phone: varchar("phone", { length: 32 }),
    email: varchar("email", { length: 254 }),
    notifyOnSos: boolean("notify_on_sos").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("trusted_contacts_user_idx").on(t.userId),
    check("trusted_contacts_has_channel", sql`${t.phone} IS NOT NULL OR ${t.email} IS NOT NULL`),
  ],
);

export const friendsRelations = relations(friends, ({ one }) => ({
  requester: one(users, { fields: [friends.requesterId], references: [users.id] }),
  addressee: one(users, { fields: [friends.addresseeId], references: [users.id] }),
}));

export const userPresenceRelations = relations(userPresence, ({ one }) => ({
  user: one(users, { fields: [userPresence.userId], references: [users.id] }),
  building: one(buildings, { fields: [userPresence.buildingId], references: [buildings.id] }),
}));

export const reportsRelations = relations(reports, ({ one, many }) => ({
  author: one(users, { fields: [reports.authorId], references: [users.id] }),
  building: one(buildings, { fields: [reports.buildingId], references: [buildings.id] }),
  votes: many(reportVotes),
  comments: many(reportComments),
}));

export const reportVotesRelations = relations(reportVotes, ({ one }) => ({
  report: one(reports, { fields: [reportVotes.reportId], references: [reports.id] }),
  user: one(users, { fields: [reportVotes.userId], references: [users.id] }),
}));

export const sosAlertsRelations = relations(sosAlerts, ({ one }) => ({
  user: one(users, { fields: [sosAlerts.userId], references: [users.id] }),
  building: one(buildings, { fields: [sosAlerts.buildingId], references: [buildings.id] }),
}));

export type FriendRow = typeof friends.$inferSelect;
export type UserPresenceRow = typeof userPresence.$inferSelect;
export type ReportRow = typeof reports.$inferSelect;
export type NewReportRow = typeof reports.$inferInsert;
export type ReportVoteRow = typeof reportVotes.$inferSelect;
export type SosAlertRow = typeof sosAlerts.$inferSelect;
export type TrustedContactRow = typeof trustedContacts.$inferSelect;
