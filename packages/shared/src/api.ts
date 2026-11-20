/**
 * Enveloppes de réponse API — @uac/shared
 *
 * Un seul format pour tous les endpoints (voir ADR-010). Le client peut donc
 * traiter succès et erreurs de façon générique.
 */

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface ApiSuccess<T> {
  data: T;
  meta?: PaginationMeta;
  /** Identifiant de corrélation, présent sur toutes les réponses. */
  requestId?: string;
}

export interface ApiFailure {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
    fields?: Record<string, string>;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function isApiFailure<T>(response: ApiResponse<T>): response is ApiFailure {
  return typeof response === "object" && response !== null && "error" in response;
}

export function isApiSuccess<T>(response: ApiResponse<T>): response is ApiSuccess<T> {
  return typeof response === "object" && response !== null && "data" in response;
}

/** Construit une métadonnée de pagination cohérente. */
export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    total,
    totalPages,
    hasMore: page < totalPages,
  };
}
