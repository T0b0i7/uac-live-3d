/**
 * Client API centralisé — apps/web/src/lib/api/client.ts
 *
 * Un seul point d'entrée pour tous les appels réseau. Ce qui y est traité :
 *  - typage des enveloppes `{data, meta, requestId}` / `{error:{code,...}}` ;
 *  - timeout avec `AbortController` (aucune requête ne peut pendre) ;
 *  - injection du jeton d'accès et rafraîchissement transparent sur 401 ;
 *  - normalisation des erreurs en `ApiError` unique, avec le `requestId` serveur
 *    conservé pour pouvoir corréler un incident avec les journaux ;
 *  - distinction explicite entre « aucun résultat » et « erreur ».
 *
 * Ce module ne fait AUCUNE supposition sur les données : il ne fabrique ni
 * valeur par défaut ni donnée de remplacement. Une réponse vide reste vide.
 */

import type { ZodType } from "zod";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Codes d'erreur renvoyés par le serveur (cf. @uac/shared ErrorCode). */
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMIT"
  | "INTERNAL_SERVER_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "INVALID_RESPONSE";

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode | string,
    message: string,
    readonly status: number,
    readonly requestId?: string,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Vrai si l'utilisateur peut réessayer sans changer sa saisie. */
  get isRetryable(): boolean {
    return (
      this.code === "NETWORK_ERROR" ||
      this.code === "TIMEOUT" ||
      this.code === "SERVICE_UNAVAILABLE" ||
      this.status >= 500
    );
  }

  /** Vrai si l'absence de résultat est un état normal (404 sur une recherche). */
  get isNotFound(): boolean {
    return this.code === "NOT_FOUND" || this.status === 404;
  }
}

// ---------------------------------------------------------------------------
// Gestion des jetons
// ---------------------------------------------------------------------------

const ACCESS_KEY = "uac.access";
const REFRESH_KEY = "uac.refresh";

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Stockage des jetons.
 *
 * `localStorage` est choisi volontairement : le jeton d'accès vit 15 minutes et
 * il est nécessaire au client de carte. Le jeton de rafraîchissement est opaque
 * et révocable côté serveur à chaque usage (rotation), donc un vol est détecté
 * et révoque toute la famille de jetons (ADR-005).
 *
 * Cette fonction est isolée pour permettre un remplacement par un cookie
 * httpOnly le jour où le déploiement le permettra — sans toucher au client.
 */
export const tokenStore = {
  get(): StoredTokens | null {
    if (typeof window === "undefined") return null;
    const accessToken = window.localStorage.getItem(ACCESS_KEY);
    const refreshToken = window.localStorage.getItem(REFRESH_KEY);
    if (!accessToken || !refreshToken) return null;
    return { accessToken, refreshToken };
  },

  set(tokens: StoredTokens): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    window.localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  },

  clear(): void {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
  },

  get accessToken(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(ACCESS_KEY);
  },
};

// ---------------------------------------------------------------------------
// Enveloppes serveur
// ---------------------------------------------------------------------------

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: PaginationMeta & Record<string, unknown>;
  requestId: string;
}

// ---------------------------------------------------------------------------
// Rafraîchissement transparent (single-flight)
// ---------------------------------------------------------------------------

/**
 * Une seule demande de rafraîchissement à la fois : sans cela, dix requêtes
 * simultanées recevant 401 déclencheraient dix rotations, dont neuf seraient
 * vues comme un rejeu et révoqueraient la famille de jetons.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const stored = tokenStore.get();
    if (!stored) return false;

    try {
      const response = await fetch(`${API_URL}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: stored.refreshToken }),
      });

      if (!response.ok) {
        tokenStore.clear();
        return false;
      }

      const body = (await response.json()) as {
        data?: { tokens?: { accessToken: string; refreshToken: string } };
      };
      const tokens = body.data?.tokens;
      if (!tokens?.accessToken || !tokens?.refreshToken) {
        tokenStore.clear();
        return false;
      }

      tokenStore.set(tokens);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

// ---------------------------------------------------------------------------
// Requête de base
// ---------------------------------------------------------------------------

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Jeton explicite, pour les appels avant que le store ne soit hydraté. */
  token?: string | null;
  /** Désactive l'injection du jeton (endpoints publics). */
  anonymous?: boolean;
  timeoutMs?: number;
  /** En-tête d'idempotence (ADR-007) : indispensable pour les créations. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Nombre de tentatives de rafraîchissement déjà effectuées (interne). */
  _retried?: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Exécute un appel et renvoie `{data, meta, requestId}`.
 *
 * Lève toujours `ApiError` en cas d'échec — jamais `undefined`, jamais `null`
 * implicite : l'appelant ne peut pas ignorer une erreur par distraction.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiEnvelope<T>> {
  const {
    method = "GET",
    body,
    token,
    anonymous = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    idempotencyKey,
    signal,
  } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // On combine le signal de l'appelant (annulation React Query) et le timeout.
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const authToken = anonymous ? null : (token ?? tokenStore.accessToken);
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof Error && error.name === "AbortError") {
      // Une annulation demandée par l'appelant n'est pas une erreur à afficher.
      if (signal?.aborted) throw new ApiError("TIMEOUT", "Requête annulée.", 0);
      throw new ApiError("TIMEOUT", "Le serveur n'a pas répondu dans les temps.", 0);
    }

    throw new ApiError(
      "NETWORK_ERROR",
      "Impossible de joindre le serveur. Vérifiez votre connexion.",
      0,
    );
  } finally {
    clearTimeout(timeout);
  }

  // --- 401 : une seule tentative de rafraîchissement ---
  if (response.status === 401 && !anonymous && !options._retried) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      return apiFetch<T>(path, { ...options, _retried: true });
    }
    throw new ApiError(
      "AUTHENTICATION_ERROR",
      "Session expirée. Reconnectez-vous.",
      401,
    );
  }

  // --- Corps éventuellement vide (204) ---
  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiError(
        "INVALID_RESPONSE",
        "Le serveur a renvoyé une réponse illisible.",
        response.status,
      );
    }
  }

  // --- Erreurs structurées ---
  if (!response.ok) {
    const envelope = parsed as {
      error?: { code?: string; message?: string; requestId?: string; fields?: Record<string, string[]> };
    } | null;
    const serverError = envelope?.error;

    throw new ApiError(
      serverError?.code ?? "INTERNAL_SERVER_ERROR",
      serverError?.message ?? `Échec de la requête (HTTP ${response.status}).`,
      response.status,
      serverError?.requestId,
      serverError?.fields,
    );
  }

  const envelope = parsed as ApiEnvelope<T> | null;
  if (!envelope || !("data" in envelope)) {
    throw new ApiError(
      "INVALID_RESPONSE",
      "Réponse inattendue du serveur (propriété `data` absente).",
      response.status,
    );
  }

  return envelope;
}

/**
 * Variante validée par un schéma Zod.
 *
 * Le serveur est la source de vérité, mais un contrat partagé qui n'est pas
 * vérifié à l'exécution finit par dériver silencieusement. Ici, un écart de
 * forme est signalé immédiatement au lieu de produire un écran cassé.
 */
export async function apiFetchValidated<T>(
  path: string,
  schema: ZodType<T>,
  options: RequestOptions = {},
): Promise<ApiEnvelope<T>> {
  const envelope = await apiFetch<unknown>(path, options);

  const result = schema.safeParse(envelope.data);
  if (!result.success) {
    throw new ApiError(
      "INVALID_RESPONSE",
      `La réponse de ${path} ne respecte pas le contrat attendu : ` +
        result.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "(racine)"} — ${i.message}`)
          .join(" ; "),
      200,
      envelope.requestId,
    );
  }

  return { ...envelope, data: result.data };
}

/** Construit une chaîne de requête en ignorant les valeurs vides. */
export function queryString(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs.length > 0 ? `?${qs}` : "";
}
