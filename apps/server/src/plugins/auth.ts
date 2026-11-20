/**
 * Contextes Fastify et garde RBAC — apps/server/src/plugins/auth.ts
 *
 * Le décorateur `authenticate` valide le JWT et attache `request.auth`.
 * Le décorateur `requireRole` compose une garde hiérarchique.
 *
 * Important : un token valide prouve l'identité, pas l'autorisation. Chaque
 * handler vérifie ensuite la propriété de la ressource.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthenticationError, AuthorizationError, hasRole, type Role } from "@uac/shared";

export interface AuthUser {
  userId: string;
  role: Role;
  email: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthUser;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (role: Role) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export function requireAuth(request: FastifyRequest): AuthUser {
  if (!request.auth) {
    throw new AuthenticationError("Authentification requise.");
  }
  return request.auth;
}

export function requireRoleSync(auth: AuthUser, required: Role): void {
  if (!hasRole(auth.role, required)) {
    throw new AuthorizationError(
      `Cette action requiert le rôle ${required}. Votre rôle actuel est ${auth.role}.`,
    );
  }
}

export async function registerAuthDecorators(app: FastifyInstance): Promise<void> {
  app.decorate("authenticate", async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      const payload = await request.jwtVerify<{ sub: string; role: Role; email: string }>();
      request.auth = {
        userId: payload.sub,
        role: payload.role,
        email: payload.email,
      };
    } catch {
      throw new AuthenticationError("Jeton d'accès invalide ou expiré.");
    }
  });

  app.decorate(
    "requireRole",
    (role: Role) => async (request: FastifyRequest, _reply: FastifyReply) => {
      await app.authenticate(request, _reply);
      const auth = requireAuth(request);
      requireRoleSync(auth, role);
    },
  );
}
