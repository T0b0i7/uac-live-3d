/**
 * Gestion centralisée des erreurs — apps/server/src/common/error-handler.ts
 *
 * Exigence : ne JAMAIS renvoyer de stack trace ou de message interne en
 * production. Toute erreur non `AppError` devient un 500 générique ; le détail
 * est journalisé côté serveur avec le `requestId` pour corrélation.
 */

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError, InternalServerError, isAppError, ValidationError } from "@uac/shared";

const REQUEST_ID_HEADER = "x-request-id";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: FastifyError | AppError | Error, request: FastifyRequest, reply: FastifyReply) => {
      const requestId = (request.id as string) ?? "unknown";
      reply.header(REQUEST_ID_HEADER, requestId);

      // 1. Erreurs applicatives : message sûr, statut connu.
      if (isAppError(error)) {
        if (error.statusCode >= 500) {
          request.log.error({ err: error, requestId }, "Erreur applicative 5xx");
        } else {
          request.log.warn(
            { code: error.code, statusCode: error.statusCode, requestId },
            error.message,
          );
        }
        const body = error.toJSON(requestId);
        const fields = extractFields(error);
        return reply.status(error.statusCode).send({
          error: fields ? { ...body, fields } : body,
        });
      }

      // 2. Erreurs de validation Fastify/AJV (schémas de route natifs).
      if ((error as FastifyError).validation) {
        const fastifyError = error as FastifyError;
        request.log.warn({ requestId, validation: fastifyError.validation }, "Validation échouée");
        return reply.status(422).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Certains champs sont invalides.",
            requestId,
            details: fastifyError.validation,
          },
        });
      }

      // 3. Erreurs de taux de requêtes (@fastify/rate-limit).
      if ((error as FastifyError).statusCode === 429) {
        return reply.status(429).send({
          error: {
            code: "RATE_LIMIT",
            message: "Trop de requêtes. Réessayez dans quelques instants.",
            requestId,
          },
        });
      }

      // 4. Erreurs de payload trop volumineux.
      if ((error as FastifyError).statusCode === 413) {
        return reply.status(413).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Le corps de la requête est trop volumineux.",
            requestId,
          },
        });
      }

      // 5. Tout le reste : 500 générique, détail uniquement dans les logs.
      const internal = new InternalServerError(error);
      request.log.error({ err: error, requestId }, "Erreur non gérée");

      return reply.status(500).send({
        error: {
          code: internal.code,
          message: internal.message,
          requestId,
          ...(process.env.NODE_ENV !== "production" && error instanceof Error
            ? { details: { hint: error.message } }
            : {}),
        },
      });
    },
  );

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const requestId = (request.id as string) ?? "unknown";
    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: `La route ${request.method} ${request.url} n'existe pas.`,
        requestId,
      },
    });
  });
}

function extractFields(error: AppError): Record<string, string> | null {
  if (!(error instanceof ValidationError)) return null;
  const details = error.details as { fields?: Record<string, string> } | undefined;
  return details?.fields ?? null;
}
