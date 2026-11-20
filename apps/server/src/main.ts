/**
 * Point d'entrée du serveur — apps/server/src/main.ts
 */

import { createDatabase } from "@uac/database";
import { buildApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { connectRedis } from "./infrastructure/redis.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const db = createDatabase({ url: config.databaseUrl, max: 10 });

  const redis = await connectRedis({
    url: config.redisUrl,
    mode: config.redisMode,
    logger: {
      info: (m) => console.log(`[redis] ${m}`),
      warn: (m) => console.warn(`[redis] ${m}`),
      error: (m) => console.error(`[redis] ${m}`),
    },
  });

  const app = await buildApp({
    config,
    db,
    cache: redis.cache,
    // Les mêmes clients pub/sub servent au cache et à l'adaptateur Socket.IO :
    // une seule paire de connexions Redis par processus, donc deux connexions
    // de moins face à la limite `maxclients`.
    redis: { pubClient: redis.pubClient, subClient: redis.subClient },
  });

  // Arrêt propre : on ferme les connexions pour ne pas laisser de sockets pendant.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void (async () => {
        app.log.info(`Signal ${signal} reçu, arrêt en cours…`);
        await app.close();
        await redis.close();
        process.exit(0);
      })();
    });
  }

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`API UAC-Live 3D à l'écoute sur http://${config.host}:${config.port}`);
}

main().catch((error: unknown) => {
  console.error("Démarrage impossible :", error);
  process.exit(1);
});
