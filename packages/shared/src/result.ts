/**
 * Type Result — @uac/shared
 *
 * Utilisé aux frontières où l'on veut éviter les exceptions pour un échec attendu
 * (ex. parsing d'un GeoJSON externe, calcul de route sans chemin possible).
 * Pour les erreurs HTTP, préférer `AppError`.
 */

export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
