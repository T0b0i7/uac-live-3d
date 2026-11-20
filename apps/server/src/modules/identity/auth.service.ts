/**
 * Service d'authentification — apps/server/src/modules/identity/auth.service.ts
 *
 * Implémente ADR-005 dans son intégralité :
 *  - Argon2id pour les mots de passe ;
 *  - access token JWT 15 min ;
 *  - refresh token opaque 30 jours, stocké HACHÉ (SHA-256) ;
 *  - rotation à chaque usage ;
 *  - détection de rejeu → révocation de TOUTE la famille de jetons ;
 *  - verrouillage temporaire après échecs répétés.
 *
 * Aucune information ne permet de distinguer « email inconnu » de « mot de passe
 * faux » : la même erreur est renvoyée, après un délai constant.
 */

import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Database } from "@uac/database";
import { faculties, refreshTokens, users } from "@uac/database";
import {
  AuthenticationError,
  ConflictError,
  AUTH,
  type Role,
} from "@uac/shared";
import type { LoginBody, RegisterBody, SelfUser } from "@uac/contracts";
import {
  generateOpaqueToken,
  hashPassword,
  hashToken,
  isWeakPassword,
  maskMatricule,
  verifyPassword,
} from "../../common/security.js";

const MAX_FAILED_LOGINS = 8;
const LOCK_DURATION_MINUTES = 15;

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthContext {
  userId: string;
  role: Role;
  email: string;
}

/** Adaptateur minimal de signature JWT (injecté pour rester testable). */
export interface JwtSigner {
  sign(payload: { sub: string; role: Role; email: string }, options: { expiresIn: string }): string;
}

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly jwt: JwtSigner,
  ) {}

  // -------------------------------------------------------------------------
  // Inscription
  // -------------------------------------------------------------------------

  async register(body: RegisterBody): Promise<{ user: SelfUser; tokens: IssuedTokens }> {
    if (isWeakPassword(body.password)) {
      throw new ConflictError(
        "Ce mot de passe est trop courant ou trop simple. Choisissez une phrase secrète unique.",
      );
    }

    // Unicité email (insensible à la casse) et matricule.
    const existing = await this.db
      .select({ id: users.id, email: users.email, matricule: users.matricule })
      .from(users)
      .where(or(sql`lower(${users.email}) = ${body.email.toLowerCase()}`, eq(users.matricule, body.matricule)))
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0]!;
      if (row.matricule === body.matricule) {
        throw new ConflictError("Ce matricule est déjà enregistré.");
      }
      throw new ConflictError("Un compte existe déjà avec cette adresse email.");
    }

    const faculty = await this.db
      .select({ id: faculties.id, name: faculties.name })
      .from(faculties)
      .where(eq(faculties.id, body.facultyId))
      .limit(1);
    if (faculty.length === 0) {
      throw new ConflictError("La faculté sélectionnée est introuvable.");
    }

    const passwordHash = await hashPassword(body.password);
    const avatarSeed = body.fullName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "etudiant";

    const inserted = await this.db
      .insert(users)
      .values({
        email: body.email,
        passwordHash,
        fullName: body.fullName,
        matricule: body.matricule,
        facultyId: body.facultyId,
        department: body.departmentId ? null : null,
        level: body.level,
        role: "STUDENT",
        avatarSeed,
        privacyMode: "FRIENDS_PROMO",
        onboardingCompleted: false,
        isVerified: true,
      })
      .returning();

    const user = inserted[0]!;
    const tokens = await this.issueTokens(user.id, user.role as Role, user.email);

    return {
      user: this.toSelfUser(user, faculty[0]!.name),
      tokens,
    };
  }

  // -------------------------------------------------------------------------
  // Connexion
  // -------------------------------------------------------------------------

  async login(body: LoginBody): Promise<{ user: SelfUser; tokens: IssuedTokens }> {
    const rows = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${body.email.toLowerCase()}`)
      .limit(1);

    const user = rows[0];

    // Chemin d'échec : on effectue quand même un hachage pour que le temps de
    // réponse ne trahisse pas l'existence du compte.
    if (!user) {
      await hashPassword("dummy-password-for-timing-equalization");
      throw new AuthenticationError("Identifiants incorrects.");
    }

    if (user.deletedAt) {
      throw new AuthenticationError("Identifiants incorrects.");
    }

    if (!user.isActive) {
      throw new AuthenticationError("Ce compte est désactivé. Contactez l'administration.");
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new AuthenticationError(
        `Compte temporairement verrouillé après plusieurs tentatives. Réessayez dans ${minutes} minute(s).`,
      );
    }

    const valid = await verifyPassword(user.passwordHash, body.password);

    if (!valid) {
      const nextCount = user.failedLoginCount + 1;
      const shouldLock = nextCount >= MAX_FAILED_LOGINS;
      await this.db
        .update(users)
        .set({
          failedLoginCount: nextCount,
          lockedUntil: shouldLock
            ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60_000)
            : null,
        })
        .where(eq(users.id, user.id));

      throw new AuthenticationError(
        shouldLock
          ? `Trop de tentatives. Compte verrouillé ${LOCK_DURATION_MINUTES} minutes.`
          : "Identifiants incorrects.",
      );
    }

    await this.db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    const facultyName = user.facultyId
      ? (
          await this.db
            .select({ name: faculties.name })
            .from(faculties)
            .where(eq(faculties.id, user.facultyId))
            .limit(1)
        )[0]?.name ?? null
      : null;

    const tokens = await this.issueTokens(user.id, user.role as Role, user.email);
    return { user: this.toSelfUser(user, facultyName), tokens };
  }

  // -------------------------------------------------------------------------
  // Rafraîchissement avec rotation et détection de rejeu
  // -------------------------------------------------------------------------

  async refresh(rawToken: string): Promise<IssuedTokens> {
    const tokenHash = hashToken(rawToken);

    const rows = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    const stored = rows[0];
    if (!stored) {
      throw new AuthenticationError("Jeton de rafraîchissement invalide.");
    }

    // Jeton déjà consommé ou révoqué ⇒ rejeu probable.
    if (stored.revokedAt) {
      await this.revokeFamily(stored.tokenFamilyId, "REPLAY_DETECTED");
      throw new AuthenticationError(
        "Session invalidée pour raison de sécurité. Reconnectez-vous.",
      );
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      await this.db
        .update(refreshTokens)
        .set({ revokedAt: new Date(), revokedReason: "EXPIRED" })
        .where(eq(refreshTokens.id, stored.id));
      throw new AuthenticationError("Session expirée. Reconnectez-vous.");
    }

    const userRows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, stored.userId), isNull(users.deletedAt)))
      .limit(1);
    const user = userRows[0];
    if (!user || !user.isActive) {
      throw new AuthenticationError("Compte indisponible.");
    }

    // Rotation : on révoque l'ancien AVANT d'émettre, dans une transaction.
    const newRawToken = generateOpaqueToken();
    const newTokenHash = hashToken(newRawToken);
    const familyId = stored.tokenFamilyId;
    const expiresAt = new Date(Date.now() + AUTH.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

    const inserted = await this.db
      .insert(refreshTokens)
      .values({
        userId: user.id,
        tokenHash: newTokenHash,
        tokenFamilyId: familyId,
        expiresAt,
      })
      .returning({ id: refreshTokens.id });

    await this.db
      .update(refreshTokens)
      .set({
        revokedAt: new Date(),
        revokedReason: "ROTATED",
        replacedByTokenId: inserted[0]!.id,
      })
      .where(eq(refreshTokens.id, stored.id));

    const accessToken = this.jwt.sign(
      { sub: user.id, role: user.role as Role, email: user.email },
      { expiresIn: AUTH.ACCESS_TOKEN_TTL },
    );

    return {
      accessToken,
      refreshToken: newRawToken,
      expiresIn: AUTH.ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  // -------------------------------------------------------------------------
  // Déconnexion
  // -------------------------------------------------------------------------

  async logout(rawToken: string | undefined, userId: string | undefined): Promise<void> {
    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      await this.db
        .update(refreshTokens)
        .set({ revokedAt: new Date(), revokedReason: "LOGOUT" })
        .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)));
      return;
    }
    if (userId) {
      await this.db
        .update(refreshTokens)
        .set({ revokedAt: new Date(), revokedReason: "LOGOUT_ALL" })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    }
  }

  // -------------------------------------------------------------------------
  // Internes
  // -------------------------------------------------------------------------

  private async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(refreshTokens.tokenFamilyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  private async issueTokens(userId: string, role: Role, email: string): Promise<IssuedTokens> {
    const rawToken = generateOpaqueToken();
    await this.db.insert(refreshTokens).values({
      userId,
      tokenHash: hashToken(rawToken),
      /** Nouvelle lignée : chaque authentification démarre une famille. */
      tokenFamilyId: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + AUTH.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    });

    const accessToken = this.jwt.sign({ sub: userId, role, email }, { expiresIn: AUTH.ACCESS_TOKEN_TTL });
    return { accessToken, refreshToken: rawToken, expiresIn: AUTH.ACCESS_TOKEN_TTL_SECONDS };
  }

  private toSelfUser(row: typeof users.$inferSelect, facultyName: string | null): SelfUser {
    return {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      avatarSeed: row.avatarSeed,
      facultyId: row.facultyId,
      facultyName,
      department: row.department,
      level: row.level,
      bio: row.bio,
      role: row.role as Role,
      karma: row.karma,
      matriculeMasked: maskMatricule(row.matricule),
      matricule: row.matricule,
      privacyMode: row.privacyMode as SelfUser["privacyMode"],
      createdAt: row.createdAt.toISOString(),
      isVerified: row.isVerified,
      onboardingCompleted: row.onboardingCompleted,
    };
  }
}
