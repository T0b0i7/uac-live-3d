/**
 * Domaines Notifications / Gamification / Moderation / Audit.
 *
 * Tables : notifications, karma_transactions, contributions, audit_logs,
 *          study_groups, study_group_members.
 *
 * `audit_logs` est en append-only : aucune mise à jour, aucune suppression
 * applicative. C'est la piste d'audit et aussi la table d'idempotence des
 * opérations hors ligne (ADR-007).
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
import { primaryUuid, timestamps } from "./_helpers.js";
import { buildings } from "./campus.js";
import { users } from "./identity.js";

export const notifications = pgTable(
  "notifications",
  {
    id: primaryUuid(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 24 }).notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    body: text("body"),
    read: boolean("read").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    actionUrl: varchar("action_url", { length: 256 }),
    /** Référence libre vers l'entité source (report, sos, friend…). */
    entityType: varchar("entity_type", { length: 32 }),
    entityId: uuid("entity_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.createdAt),
    index("notifications_unread_idx").on(t.userId, t.read),
    check(
      "notifications_type_valid",
      sql`${t.type} IN ('ALERT','FRIEND_REQUEST','FRIEND_ACCEPTED','REPORT','SOS','STUDY_GROUP','SYSTEM','KARMA')`,
    ),
  ],
);

export const karmaTransactions = pgTable(
  "karma_transactions",
  {
    id: primaryUuid(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Delta signé appliqué au solde de l'utilisateur. */
    delta: integer("delta").notNull(),
    reason: varchar("reason", { length: 48 }).notNull(),
    entityType: varchar("entity_type", { length: 32 }),
    entityId: uuid("entity_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("karma_user_idx").on(t.userId, t.createdAt),
    check("karma_delta_nonzero", sql`${t.delta} <> 0`),
    check("karma_delta_bounds", sql`${t.delta} >= -500 AND ${t.delta} <= 500`),
  ],
);

export const contributions = pgTable(
  "contributions",
  {
    id: primaryUuid(),
    targetType: varchar("target_type", { length: 16 }).notNull(),
    targetId: uuid("target_id").notNull(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Charge utile proposée (JSON sérialisé) : géométrie, salle, horaires… */
    payload: text("payload").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("PENDING"),
    reviewerId: uuid("reviewer_id").references(() => users.id, { onDelete: "set null" }),
    reviewerNote: text("reviewer_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("contributions_status_idx").on(t.status),
    index("contributions_target_idx").on(t.targetType, t.targetId),
    index("contributions_author_idx").on(t.authorId),
    check("contributions_target_valid", sql`${t.targetType} IN ('BUILDING','ROOM','WALKWAY')`),
    check("contributions_status_valid", sql`${t.status} IN ('PENDING','APPROVED','REJECTED')`),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: primaryUuid(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 64 }).notNull(),
    targetType: varchar("target_type", { length: 32 }),
    targetId: varchar("target_id", { length: 64 }),
    /**
     * Clé d'idempotence fournie par le client. Unique par acteur : un rejeu
     * réseau ne crée pas de doublon (ADR-007).
     */
    operationId: uuid("operation_id"),
    /** IP hachée (SHA-256 salé) — jamais l'IP en clair. */
    ipHash: varchar("ip_hash", { length: 64 }),
    userAgent: varchar("user_agent", { length: 256 }),
    /** Métadonnées non sensibles (jamais de coordonnées GPS brutes). */
    metadata: text("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_actor_idx").on(t.actorId, t.createdAt),
    index("audit_logs_action_idx").on(t.action),
    index("audit_logs_created_idx").on(t.createdAt),
    uniqueIndex("audit_logs_idempotency_uq").on(t.actorId, t.operationId),
  ],
);

export const studyGroups = pgTable(
  "study_groups",
  {
    id: primaryUuid(),
    name: varchar("name", { length: 140 }).notNull(),
    subject: varchar("subject", { length: 64 }).notNull(),
    description: text("description"),
    buildingId: uuid("building_id").references(() => buildings.id, { onDelete: "set null" }),
    roomId: uuid("room_id"),
    capacity: integer("capacity").notNull().default(8),
    /** Séance planifiée. */
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    durationMinutes: integer("duration_minutes").notNull().default(90),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("study_groups_subject_idx").on(t.subject),
    index("study_groups_scheduled_idx").on(t.scheduledAt),
    check("study_groups_capacity_bounds", sql`${t.capacity} >= 2 AND ${t.capacity} <= 100`),
  ],
);

export const studyGroupMembers = pgTable(
  "study_group_members",
  {
    id: primaryUuid(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => studyGroups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("study_group_members_unique").on(t.groupId, t.userId),
    index("study_group_members_user_idx").on(t.userId),
  ],
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const karmaTransactionsRelations = relations(karmaTransactions, ({ one }) => ({
  user: one(users, { fields: [karmaTransactions.userId], references: [users.id] }),
}));

export const contributionsRelations = relations(contributions, ({ one }) => ({
  author: one(users, { fields: [contributions.authorId], references: [users.id] }),
}));

export const studyGroupsRelations = relations(studyGroups, ({ one, many }) => ({
  creator: one(users, { fields: [studyGroups.creatorId], references: [users.id] }),
  building: one(buildings, { fields: [studyGroups.buildingId], references: [buildings.id] }),
  members: many(studyGroupMembers),
}));

export const studyGroupMembersRelations = relations(studyGroupMembers, ({ one }) => ({
  group: one(studyGroups, { fields: [studyGroupMembers.groupId], references: [studyGroups.id] }),
  user: one(users, { fields: [studyGroupMembers.userId], references: [users.id] }),
}));

export type NotificationRow = typeof notifications.$inferSelect;
export type KarmaTransactionRow = typeof karmaTransactions.$inferSelect;
export type ContributionRow = typeof contributions.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
export type StudyGroupRow = typeof studyGroups.$inferSelect;
export type StudyGroupMemberRow = typeof studyGroupMembers.$inferSelect;
