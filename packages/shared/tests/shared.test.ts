import { describe, expect, it } from "vitest";
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  ValidationError,
  isAppError,
} from "../src/errors.js";
import { buildPaginationMeta } from "../src/api.js";
import { hasRole } from "../src/constants.js";

describe("hiérarchie d'erreurs", () => {
  it("expose un code et un statut HTTP stables", () => {
    const cases: Array<[AppError, string, number]> = [
      [new ValidationError(), "VALIDATION_ERROR", 422],
      [new AuthenticationError(), "AUTHENTICATION_ERROR", 401],
      [new AuthorizationError(), "AUTHORIZATION_ERROR", 403],
      [new NotFoundError("Bâtiment"), "NOT_FOUND", 404],
      [new ConflictError(), "CONFLICT", 409],
      [new InternalServerError(), "INTERNAL_SERVER_ERROR", 500],
    ];
    for (const [error, code, status] of cases) {
      expect(error.code).toBe(code);
      expect(error.statusCode).toBe(status);
    }
  });

  it("marque les erreurs internes comme non opérationnelles", () => {
    expect(new InternalServerError().isOperational).toBe(false);
    expect(new NotFoundError().isOperational).toBe(true);
  });

  it("sérialise sans exposer la stack", () => {
    const serialized = new NotFoundError("Bâtiment").toJSON("req-1");
    expect(serialized).toEqual({
      code: "NOT_FOUND",
      message: "Bâtiment introuvable.",
      requestId: "req-1",
    });
    expect(serialized).not.toHaveProperty("stack");
  });

  it("identifie correctement une AppError", () => {
    expect(isAppError(new NotFoundError())).toBe(true);
    expect(isAppError(new Error("brut"))).toBe(false);
  });
});

describe("métadonnées de pagination", () => {
  it("calcule totalPages et hasMore", () => {
    expect(buildPaginationMeta(1, 20, 45)).toEqual({
      page: 1,
      limit: 20,
      total: 45,
      totalPages: 3,
      hasMore: true,
    });
    expect(buildPaginationMeta(3, 20, 45).hasMore).toBe(false);
  });

  it("gère une collection vide sans division par zéro", () => {
    expect(buildPaginationMeta(1, 20, 0)).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
      hasMore: false,
    });
    expect(buildPaginationMeta(1, 0, 10).totalPages).toBe(0);
  });
});

describe("hiérarchie RBAC", () => {
  it("respecte l'ordre STUDENT < CONTRIBUTOR < MODERATOR < ADMIN", () => {
    expect(hasRole("ADMIN", "MODERATOR")).toBe(true);
    expect(hasRole("MODERATOR", "MODERATOR")).toBe(true);
    expect(hasRole("CONTRIBUTOR", "MODERATOR")).toBe(false);
    expect(hasRole("STUDENT", "CONTRIBUTOR")).toBe(false);
  });
});
