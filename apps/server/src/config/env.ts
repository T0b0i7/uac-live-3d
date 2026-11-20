/**
 * Configuration centralisée — apps/server/src/config
 *
 * Principe : fail-fast. Le serveur refuse de démarrer si la configuration de
 * sécurité est insuffisante. Un serveur qui démarre en production avec un secret
 * par défaut est plus dangereux qu'un serveur qui refuse de démarrer.
 */

import { z } from "zod";

const INSECURE_SECRETS = [
  "secret",
  "changeme",
  "change-me",
  "dev-secret",
  "test-secret",
  "your-secret-key",
  "super-secret",
  "jwt-secret",
  "password",
];

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default("0.0.0.0"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL est requis."),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  /**
   * `optional` : si Redis est absent, cache mémoire de secours (ADR-008).
   * `required` : le démarrage échoue (production multi-instance).
   */
  REDIS_MODE: z.enum(["optional", "required"]).default("optional"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET doit faire au moins 32 caractères."),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET doit faire au moins 32 caractères."),

  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3001"),

  /** Sel utilisé pour hacher les IP dans l'audit (jamais l'IP en clair). */
  IP_HASH_SALT: z.string().min(16).default("uac-live-3d-ip-salt-dev-only"),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  /** Limite de requêtes par fenêtre, par IP. */
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),

  /** Origines supplémentaires acceptées pour le temps réel. */
  SOCKET_PATH: z.string().default("/socket.io"),

  /** Taille maximale du corps d'une requête (octets). */
  BODY_LIMIT: z.coerce.number().int().min(1024).default(1_048_576),
});

export type AppConfig = z.infer<typeof envSchema> & {
  isProduction: boolean;
  isTest: boolean;
  corsOrigins: string[];
  /** Alias camelCase — évite de trimballer des SCREAMING_CASE dans le code. */
  databaseUrl: string;
  redisUrl: string;
  redisMode: "optional" | "required";
  port: number;
  host: string;
  logLevel: string;
  bodyLimit: number;
  ipHashSalt: string;
  jwtSecret: string;
  jwtRefreshSecret: string;
  rateLimitMax: number;
  rateLimitWindow: string;
  socketPath: string;
};

let cached: AppConfig | null = null;

export function loadConfig(overrides: Record<string, string | undefined> = {}): AppConfig {
  if (cached && Object.keys(overrides).length === 0) return cached;

  const merged = { ...process.env, ...overrides };

  // En test, on fournit des valeurs sûres par défaut pour ne pas exiger un .env.
  if (merged.NODE_ENV === "test") {
    merged.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/uac_live_test";
    merged.JWT_SECRET ??= "test-jwt-secret-at-least-32-characters-long";
    merged.JWT_REFRESH_SECRET ??= "test-refresh-secret-at-least-32-characters-long";
  }

  const parsed = envSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Configuration invalide :\n${issues}`);
  }

  const env = parsed.data;

  // Refus explicite des secrets faibles en production.
  if (env.NODE_ENV === "production") {
    for (const key of ["JWT_SECRET", "JWT_REFRESH_SECRET", "IP_HASH_SALT"] as const) {
      const value = env[key].toLowerCase();
      if (INSECURE_SECRETS.some((bad) => value.includes(bad))) {
        throw new Error(
          `Sécurité : ${key} contient une valeur par défaut connue. ` +
            `Générez un secret aléatoire : openssl rand -base64 48`,
        );
      }
    }
    if (env.CORS_ORIGINS.includes("*")) {
      throw new Error("Sécurité : CORS_ORIGINS ne peut pas contenir '*' en production.");
    }
  }

  const config: AppConfig = {
    ...env,
    isProduction: env.NODE_ENV === "production",
    isTest: env.NODE_ENV === "test",
    corsOrigins: env.CORS_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    redisMode: env.REDIS_MODE,
    port: env.PORT,
    host: env.HOST,
    logLevel: env.LOG_LEVEL,
    bodyLimit: env.BODY_LIMIT,
    ipHashSalt: env.IP_HASH_SALT,
    jwtSecret: env.JWT_SECRET,
    jwtRefreshSecret: env.JWT_REFRESH_SECRET,
    rateLimitMax: env.RATE_LIMIT_MAX,
    rateLimitWindow: env.RATE_LIMIT_WINDOW,
    socketPath: env.SOCKET_PATH,
  };

  if (Object.keys(overrides).length === 0) cached = config;
  return config;
}

/** Réinitialise le cache (utile entre deux tests). */
export function resetConfig(): void {
  cached = null;
}
