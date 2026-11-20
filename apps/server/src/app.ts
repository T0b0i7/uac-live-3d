/**
 * Construction de l'application Fastify — apps/server/src/app.ts
 *
 * Séparé de `main.ts` pour être testable via `app.inject()` sans ouvrir de port.
 */

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { Database } from "@uac/database";
import type { Redis as RedisClient } from "ioredis";
import { loadConfig, type AppConfig } from "./config/env.js";
import { registerErrorHandler } from "./common/error-handler.js";
import { createLogger } from "./common/logger.js";
import { registerAuthDecorators } from "./plugins/auth.js";
import { registerRoutes } from "./routes/index.js";
import type { CacheStore } from "./infrastructure/redis.js";
import { RealtimeHub } from "./realtime/hub.js";

export interface BuildAppOptions {
  config?: AppConfig;
  db: Database;
  /** Cache partagé (Redis ou mémoire). Optionnel : les tests s'en passent. */
  cache?: CacheStore;
  /** Clients pub/sub Redis, pour l'adaptateur Socket.IO multi-instance. */
  redis?: { pubClient: RedisClient | null; subClient: RedisClient | null };
  /**
   * Crée (ou non) le hub temps réel. Activé par défaut ; `false` pour les tests
   * purement HTTP qui n'ont pas besoin d'un serveur Socket.IO.
   */
  realtime?: boolean;
  /** Désactive le worker de purge dans les tests (intervalles contrôlés). */
  realtimeSweepMs?: number;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const logger = createLogger({
    level: config.isTest ? "silent" : config.logLevel,
    pretty: !config.isProduction && !config.isTest,
  });

  const app = Fastify({
    // pino respecte l'interface FastifyBaseLogger : élargissement nominal explicite,
    // pas un cast de complaisance — les signatures sont structurellement compatibles.
    ...(config.isTest ? {} : { loggerInstance: logger as FastifyBaseLogger }),
    bodyLimit: config.bodyLimit,
    requestIdHeader: "x-request-id",
    trustProxy: true,
    genReqId: () => randomUUID(),
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

  // --- Temps réel ---
  // Le hub est construit AVANT les routes : les handlers HTTP doivent pouvoir
  // diffuser un événement (signalement créé, SOS acquitté) sans dépendre d'une
  // référence montante vers l'objet `app`.
  let hub: RealtimeHub | null = null;
  if (options.realtime !== false) {
    hub = new RealtimeHub({
      db: options.db,
      config,
      logger: app.log,
      pubClient: options.redis?.pubClient ?? null,
      subClient: options.redis?.subClient ?? null,
      // Même implémentation de vérification que l'API HTTP : un seul chemin
      // de validation des jetons dans tout le système.
      verifyToken: (token) => {
        try {
          const payload = app.jwt.verify<{ sub: string; role: string; email: string }>(token);
          if (
            typeof payload?.sub !== "string" ||
            typeof payload?.role !== "string" ||
            typeof payload?.email !== "string"
          ) {
            return null;
          }
          return { sub: payload.sub, role: payload.role, email: payload.email };
        } catch {
          return null;
        }
      },
      ...(options.realtimeSweepMs !== undefined ? { expirySweepMs: options.realtimeSweepMs } : {}),
    });

    hub.attach(app.server);
    app.addHook("onClose", async () => {
      await hub?.close();
    });
  }
  app.decorate("realtime", hub);

  await registerRoutes(app);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
    config: AppConfig;
    cache: CacheStore | null;
    /** `null` lorsque le temps réel est désactivé (tests HTTP purs). */
    realtime: RealtimeHub | null;
  }
}
