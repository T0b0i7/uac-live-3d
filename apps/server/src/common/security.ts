/**
 * Utilitaires de sécurité — apps/server/src/common/security.ts
 *
 * Tout ce qui touche aux secrets vit ici, et nulle part ailleurs : hachage de
 * mot de passe, génération de jetons opaques, hachage d'IP, masquage d'email.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { AUTH } from "@uac/shared";

/** Hache un mot de passe avec Argon2id (paramètres de `AUTH.ARGON2`). */
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, {
    type: argon2.argon2id,
    memoryCost: AUTH.ARGON2.memoryCost,
    timeCost: AUTH.ARGON2.timeCost,
    parallelism: AUTH.ARGON2.parallelism,
  });
}

/**
 * Vérifie un mot de passe. Ne lève jamais : renvoie `false` si le hash est
 * corrompu, ce qui évite de distinguer « hash invalide » de « mot de passe faux »
 * et empêche une fuite d'information par la forme de l'erreur.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Jeton opaque cryptographiquement sûr (refresh token). */
export function generateOpaqueToken(): string {
  return randomBytes(AUTH.REFRESH_TOKEN_BYTES).toString("base64url");
}

/**
 * SHA-256 d'un jeton. On stocke le hash, jamais le jeton : un dump de base ne
 * permet donc pas de rejouer les sessions (ADR-005).
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Hache une adresse IP avec un sel serveur. Permet de corréler des requêtes
 * pour l'audit sans conserver l'IP en clair (RGPD : minimisation).
 */
export function hashIp(ip: string | undefined, salt: string): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 64);
}

/** Masque un matricule : `UAC-2026-0042` → `UAC-****-0042`. */
export function maskMatricule(matricule: string): string {
  if (matricule.length <= 6) return "***";
  const head = matricule.slice(0, 3);
  const tail = matricule.slice(-4);
  return `${head}${"*".repeat(Math.max(2, matricule.length - 7))}${tail}`;
}

/** Masque un email : `kokou.adjovi@uac.bj` → `ko***@uac.bj`. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (local.length <= 2) return `**@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

/** Comparaison à temps constant (évite les attaques temporelles). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Liste courte de mots de passe notoirement compromis. Un contrôle exhaustif
 * nécessiterait une base téléchargée ; cette liste bloque les évidences sans
 * ajouter de dépendance réseau.
 */
const WEAK_PASSWORDS = new Set([
  "password", "password1", "password123", "1234567890", "qwertyuiop",
  "azertyuiop", "motdepasse", "motdepasse1", "uaclive2026", "campus2026",
  "admin12345", "welcome123", "letmein123", "iloveyou1", "sunshine1",
]);

export function isWeakPassword(plain: string): boolean {
  const lowered = plain.toLowerCase();
  if (WEAK_PASSWORDS.has(lowered)) return true;
  // Motif trivial : un seul caractère répété ou une suite croissante.
  if (/^(.)\1+$/.test(plain)) return true;
  if ("0123456789abcdefghijklmnopqrstuvwxyz".includes(lowered) && lowered.length <= 12) return true;
  return false;
}
