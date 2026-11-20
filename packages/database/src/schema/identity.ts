/**
 * Domaine Identity & Access Management + User Profiles.
 *
 * Tables : users, refresh_tokens, faculties.
 *
 * Décisions notables :
 *  - `password_hash` contient l'Argon2id complet (sel + paramètres inclus).
 *  - Le matricule est unique mais jamais exposé en clair (masqué à la lecture).
 *  - `refresh_token_hash` : on ne stocke JAMAIS le jeton en clair (ADR-005).
 *  - `token_family_id` permet de révoquer toute une lignée en cas de rejeu.
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
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

export const faculties = pgTable(
  "faculties",
  {
    id: primaryUuid(),
    code: varchar("code", { length: 24 }).notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    shortName: varchar("short_name", { length: 32 }),
    description: text("description"),
    ...timestamps,
  },
  (t) => [uniqueIndex("faculties_code_uq").on(t.code)],
);

export const users = pgTable(
  "users",
  {
    id: primaryUuid(),
    email: varchar("email", { length: 254 }).notNull(),
    /** Argon2id : `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>` */
    passwordHash: text("password_hash").notNull(),
    fullName: varchar("full_name", { length: 120 }).notNull(),
    /** Unique, mais masqué en sortie publique. */
    matricule: varchar("matricule", { length: 32 }).notNull(),
    facultyId: uuid("faculty_id").references(() => faculties.id, { onDelete: "set null" }),
    department: varchar("department", { length: 120 }),
    level: varchar("level", { length: 8 }),

    role: varchar("role", { length: 16 }).notNull().default("STUDENT"),
    avatarSeed: varchar("avatar_seed", { length: 64 }).notNull(),
    bio: text("bio"),

    karma: integer("karma").notNull().default(0),
    isVerified: boolean("is_verified").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    onboardingCompleted: boolean("onboarding_completed").notNull().default(false),

    /** Mode de confidentialité courant — voir ADR-006. */
    privacyMode: varchar("privacy_mode", { length: 20 }).notNull().default("FRIENDS_PROMO"),

    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),

    /** Soft delete : un compte « supprimé » est anonymisé, pas retiré. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_uq").on(sql`lower(${t.email})`),
    uniqueIndex("users_matricule_uq").on(t.matricule),
    index("users_faculty_idx").on(t.facultyId),
    index("users_role_idx").on(t.role),
    index("users_fullname_trgm_idx").using("gin", sql`${t.fullName} gin_trgm_ops`),
  ],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: primaryUuid(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 du jeton opaque. Jamais le jeton lui-même. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    /**
     * Identifiant de la lignée de jetons issue d'une même authentification.
     * Un rejeu détecté révoque toute la famille (ADR-005).
     */
    tokenFamilyId: uuid("token_family_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: varchar("revoked_reason", { length: 64 }),
    replacedByTokenId: uuid("replaced_by_token_id"),
    userAgent: varchar("user_agent", { length: 256 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("refresh_tokens_hash_uq").on(t.tokenHash),
    index("refresh_tokens_user_idx").on(t.userId),
    index("refresh_tokens_family_idx").on(t.tokenFamilyId),
    index("refresh_tokens_expires_idx").on(t.expiresAt),
  ],
);

export const facultiesRelations = relations(faculties, ({ many }) => ({
  users: many(users),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  faculty: one(faculties, { fields: [users.facultyId], references: [faculties.id] }),
  refreshTokens: many(refreshTokens),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type FacultyRow = typeof faculties.$inferSelect;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
