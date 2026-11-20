/**
 * Validation Zod générique pour Fastify — apps/server/src/common/validation.ts
 *
 * Un seul helper, réutilisé partout : convertit un schéma Zod en validateur
 * Fastify, et transforme les erreurs Zod en `ValidationError` typée avec les
 * champs fautifs (exploitables directement par un formulaire).
 */

import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { ValidationError } from "@uac/shared";

export function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".") || "_root";
    if (!fields[path]) fields[path] = issue.message;
  }

  throw new ValidationError("Certains champs sont invalides.", { fields });
}

export function parseBody<T extends z.ZodType>(request: FastifyRequest, schema: T): z.infer<T> {
  return parseOrThrow(schema, request.body);
}

export function parseQuery<T extends z.ZodType>(request: FastifyRequest, schema: T): z.infer<T> {
  return parseOrThrow(schema, request.query);
}

export function parseParams<T extends z.ZodType>(request: FastifyRequest, schema: T): z.infer<T> {
  return parseOrThrow(schema, request.params);
}

/** Extrait l'IP réelle derrière un proxy de confiance. */
export function clientIp(request: FastifyRequest): string | undefined {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim();
  if (Array.isArray(forwarded)) return forwarded[0]?.split(",")[0]?.trim();
  return request.ip;
}

/** Extrait la clé d'idempotence de l'en-tête (ADR-007). Renvoie `null` si absente/invalide. */
export function idempotencyKey(request: FastifyRequest): string | null {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return z.string().uuid().safeParse(trimmed).success ? trimmed : null;
}
