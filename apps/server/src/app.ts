/**
 * Construction de l'application Fastify — apps/server/src/app.ts
 *
 * Séparé de `main.ts` pour être testable via `app.inject()` sans ouvrir de port.
 */

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import type { Database } from "@uac/database";
import { loadConfig, type AppConfig } from "./config/env.js";
import { registerErrorHandler } from "./common/error-handler.js";
import { createLogger } from "./common/logger.js";
import { registerAuthDecorators } from "./plugins/auth.js";
import { registerRoutes } from "./routes/index.js";
import type { CacheStore } from "./infrastructure/redis.js";

export interface BuildAppOptions {
  config?: AppConfig;
  db: Database;
  /** Cache partagé (Redis ou mémoire). Optionnel : les tests s'en passent. */
  cache?: CacheStore;
}

export async function buildApp(options: BuildAppOptions) {
  const config = options.config ?? loadConfig();
  const logger = createLogger({
    level: config.isTest ? "silent" : config.logLevel,
    pretty: !config.isProduction && !config.isTest,
  });

  const app = Fastify({
    ...(config.isTest ? {} : { loggerInstance: logger }),
    bodyLimit: config.bodyLimit,
    requestIdHeader: "x-request-id",
    trustProxy: true,
    genReqId: () => crypto.randomUUID(),
  });

  // --- Sécurité des en-têtes ---
  await app.register(helmet, {
    contentSecurityPolicy: config.isProduction ? undefined : false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  // --- CORS strict (liste blanche, jamais '*') ---
  await app.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"],
    maxAge: 86_400,
  });

  // --- Rate limiting global ---
  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: () => ({
      error: {
        code: "RATE_LIMIT",
        message: "Trop de requêtes. Réessayez dans quelques instants.",
        requestId: "rate-limited",
      },
    }),
  });

  // --- JWT ---
  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: { expiresIn: "15m" },
  });

  registerAuthDecorators(app);
  registerErrorHandler(app);

  // --- Dépendances exposées au reste de l'app ---
  app.decorate("db", options.db);
  app.decorate("config", config);
  app.decorate("cache", options.cache ?? null);

  await registerRoutes(app);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
    config: AppConfig;
    cache: CacheStore | null;
  }
}
