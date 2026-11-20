/**
 * Erreurs applicatives typées — @uac/shared
 *
 * Chaque erreur porte un `code` stable (contrat machine) et un `statusCode` HTTP.
 * Le message est destiné à l'affichage ; `details` porte les précisions de validation.
 *
 * Règle : aucun `Error` brut ne doit traverser la couche presentation. Le
 * `errorHandler` Fastify convertit toute exception inconnue en InternalServerError
 * SANS exposer la stack ni le message d'origine en production.
 */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMIT"
  | "EXTERNAL_SERVICE_ERROR"
  | "INTERNAL_SERVER_ERROR"
  | "SERVICE_UNAVAILABLE";

export interface SerializedError {
  code: ErrorCode;
  message: string;
  details?: unknown;
  requestId: string;
  /** Champs de formulaire en erreur, quand pertinent (validation). */
  fields?: Record<string, string>;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;
  /** `true` ⇒ le message est sûr à montrer au client final. */
  readonly isOperational: boolean;

  constructor(
    code: ErrorCode,
    statusCode: number,
    message: string,
    options?: { details?: unknown; isOperational?: boolean; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = options?.details;
    this.isOperational = options?.isOperational ?? true;
    Error.captureStackTrace?.(this, new.target);
  }

  toJSON(requestId: string): SerializedError {
    return {
      code: this.code,
      message: this.message,
      requestId,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export class ValidationError extends AppError {
  constructor(message = "Les données envoyées sont invalides.", details?: unknown) {
    super("VALIDATION_ERROR", 422, message, { details });
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Authentification requise.") {
    super("AUTHENTICATION_ERROR", 401, message);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "Vous n'avez pas les droits pour cette action.") {
    super("AUTHORIZATION_ERROR", 403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(entity = "Ressource", message?: string) {
    super("NOT_FOUND", 404, message ?? `${entity} introuvable.`);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Cette opération entre en conflit avec l'état actuel.") {
    super("CONFLICT", 409, message);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Trop de requêtes. Réessayez dans quelques instants.") {
    super("RATE_LIMIT", 429, message);
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, cause?: unknown) {
    super("EXTERNAL_SERVICE_ERROR", 502, `Le service ${service} est momentanément indisponible.`, {
      cause,
    });
  }
}

export class InternalServerError extends AppError {
  constructor(cause?: unknown, message = "Une erreur interne est survenue.") {
    super("INTERNAL_SERVER_ERROR", 500, message, { cause, isOperational: false });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "Service temporairement indisponible.") {
    super("SERVICE_UNAVAILABLE", 503, message);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
