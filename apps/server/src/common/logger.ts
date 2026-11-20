/**
 * Journalisation structurée — apps/server/src/common/logger.ts
 *
 * Règle de confidentialité absolue (ADR-006) : aucun champ `lat`, `lng`,
 * `location`, `geometry`, `password`, `token` ne doit apparaître dans un log.
 * Le `redact` de pino est la garde technique, la revue de code la garde humaine.
 */

import { pino, type Logger } from "pino";

export interface LoggerOptions {
  level: string;
  pretty: boolean;
}

const REDACTED_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.body.password",
  "req.body.currentPassword",
  "req.body.newPassword",
  "req.body.refreshToken",
  "req.body.location",
  "req.body.from",
  "req.body.to",
  "password",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "tokenHash",
  "lat",
  "lng",
  "latitude",
  "longitude",
  "location",
  "geometry",
  "footprint",
  "centroid",
  "entrance",
];

export function createLogger(options: LoggerOptions): Logger {
  return pino({
    level: options.level,
    redact: { paths: REDACTED_PATHS, censor: "[REDACTED]" },
    base: { service: "uac-live-3d-api" },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(options.pretty
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
          },
        }
      : {}),
  });
}

export type { Logger };
