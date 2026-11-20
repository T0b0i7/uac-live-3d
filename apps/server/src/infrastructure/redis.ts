/**
 * Couche Redis — apps/server/src/infrastructure/redis.ts
 *
 * Respecte ADR-008 : Redis est volatile. `optional` ⇒ cache mémoire de secours
 * et présence locale ; `required` ⇒ échec au démarrage (production multi-instance,
 * car sans Redis la diffusion entre instances serait silencieusement cassée).
 */

import Redis from "ioredis";

export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  delByPrefix(prefix: string): Promise<number>;
  /** Incrémente un compteur avec fenêtre glissante (rate limiting). */
  incr(key: string, ttlSeconds: number): Promise<number>;
  readonly backend: "redis" | "memory";
}

/** Cache mémoire avec TTL — filet de sécurité quand Redis est absent. */
class MemoryCache implements CacheStore {
  private readonly store = new Map<string, { value: unknown; expiresAt: number }>();
  readonly backend = "memory" as const;

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (this.store.size > 10_000) this.sweep();
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async delByPrefix(prefix: string): Promise<number> {
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const current = (await this.get<number>(key)) ?? 0;
    const next = current + 1;
    if (current === 0) {
      await this.set(key, next, ttlSeconds);
    } else {
      const entry = this.store.get(key);
      if (entry) entry.value = next;
    }
    return next;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) this.store.delete(key);
    }
  }
}

class RedisCache implements CacheStore {
  readonly backend = "redis" as const;

  constructor(private readonly client: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), "EX", ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async delByPrefix(prefix: string): Promise<number> {
    let cursor = "0";
    let removed = 0;
    do {
      const [nextCursor, keys] = await this.client.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
      cursor = nextCursor;
      if (keys.length > 0) {
        removed += await this.client.del(...keys);
      }
    } while (cursor !== "0");
    return removed;
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const value = await this.client.incr(key);
    if (value === 1) await this.client.expire(key, ttlSeconds);
    return value;
  }
}

export interface RedisBundle {
  cache: CacheStore;
  /** Clients pub/sub pour l'adaptateur Socket.IO (null si Redis absent). */
  pubClient: Redis | null;
  subClient: Redis | null;
  /** Client principal, pour la présence. */
  client: Redis | null;
  backend: "redis" | "memory";
  close(): Promise<void>;
}

export async function connectRedis(options: {
  url: string;
  mode: "optional" | "required";
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
}): Promise<RedisBundle> {
  const client = new Redis(options.url, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
    enableOfflineQueue: false,
  });

  try {
    await client.connect();
    await client.ping();

    const pubClient = client.duplicate();
    const subClient = client.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);

    options.logger.info(`Redis connecté (${options.url})`);

    return {
      cache: new RedisCache(client),
      pubClient,
      subClient,
      client,
      backend: "redis",
      async close() {
        await Promise.allSettled([pubClient.quit(), subClient.quit(), client.quit()]);
      },
    };
  } catch (error) {
    await client.disconnect();

    if (options.mode === "required") {
      throw new Error(
        `Redis est requis (REDIS_MODE=required) mais inaccessible sur ${options.url}. ` +
          `Démarrage refusé : sans Redis, la diffusion temps réel entre instances serait cassée. ` +
          `Cause : ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    options.logger.warn(
      `Redis indisponible (${options.url}) — bascule en cache mémoire. ` +
        `Le temps réel restera limité à cette instance.`,
    );

    return {
      cache: new MemoryCache(),
      pubClient: null,
      subClient: null,
      client: null,
      backend: "memory",
      async close() {},
    };
  }
}
