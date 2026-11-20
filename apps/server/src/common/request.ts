/**
 * Helpers de requête — apps/server/src/common/request.ts
 *
 * Réexporte les helpers de validation et ajoute la variante non bloquante de
 * l'authentification (routes publiques mais enrichies si connecté).
 */

import type { FastifyRequest } from "fastify";
import type { Role } from "@uac/shared";

export { parseBody, parseQuery, parseParams, clientIp, idempotencyKey } from "./validation.js";

/** Authentification optionnelle : renvoie null si non connecté, sans lever. */
export function requireAuthOrNull(
  request: FastifyRequest,
): { userId: string; role: Role; email: string } | null {
  return request.auth ?? null;
}
