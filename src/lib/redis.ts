/**
 * Redis Configuration - Flux Architecture Compliance
 * Centralized Redis client for token caching and distributed locking
 */

import Redis from "ioredis";

// Redis connection URL from environment
const REDIS_URL = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || "";

// Global Redis client instance
let redisClient: Redis | null = null;

/**
 * Get or create Redis client (singleton pattern)
 */
export function getRedis(): Redis {
  if (!redisClient) {
    if (!REDIS_URL) {
      console.warn("[Redis] REDIS_URL not configured, using in-memory fallback");
      // Create a mock Redis for development if no Redis URL
      redisClient = createMockRedis();
    } else {
      redisClient = new Redis(REDIS_URL, {
        retryStrategy: (times) => {
          // Exponential backoff with max 3 second delay
          return Math.min(times * 50, 3000);
        },
        maxRetriesPerRequest: 3,
      });

      redisClient.on("error", (err) => {
        console.error("[Redis] Connection error:", err);
      });

      redisClient.on("connect", () => {
        console.log("[Redis] Connected successfully");
      });
    }
  }

  return redisClient;
}

/**
 * Mock Redis for local development (fallback when Redis not configured)
 */
function createMockRedis(): Redis {
  const store = new Map<string, { value: string; expiry: number }>();

  const mockRedis = {
    async get(key: string): Promise<string | null> {
      const item = store.get(key);
      if (!item) return null;
      if (Date.now() > item.expiry) {
        store.delete(key);
        return null;
      }
      return item.value;
    },

    async set(key: string, value: string, ...args: any[]): Promise<string> {
      let ttl: number | undefined;
      // Handle both set(key, value, "EX", 60) and set(key, value, { EX: 60 })
      if (args[0] === "EX" && typeof args[1] === "number") {
        ttl = args[1] * 1000; // Convert seconds to ms
      }
      store.set(key, { value, expiry: Date.now() + (ttl || 86400000) });
      return "OK";
    },

    async del(key: string): Promise<number> {
      return store.delete(key) ? 1 : 0;
    },

    async expire(key: string, seconds: number): Promise<number> {
      const item = store.get(key);
      if (item) {
        item.expiry = Date.now() + seconds * 1000;
        return 1;
      }
      return 0;
    },

    async ttl(key: string): Promise<number> {
      const item = store.get(key);
      if (!item) return -2;
      const remaining = Math.ceil((item.expiry - Date.now()) / 1000);
      return remaining > 0 ? remaining : -1;
    },

    async setnx(key: string, value: string): Promise<number> {
      if (store.has(key)) return 0;
      store.set(key, { value, expiry: Date.now() + 30000 }); // 30s default
      return 1;
    },

    async eval(
      script: string,
      keys: string[],
      args: (string | number)[]
    ): Promise<any> {
      // Simple Lua script simulation for locking
      if (script.includes("SET")) {
        const [key, value, ttl] = args;
        if (store.has(key as string)) return null;
        store.set(key as string, { value: value as string, expiry: Date.now() + (ttl as number) * 1000 });
        return value;
      }
      if (script.includes("DEL")) {
        const [key] = keys;
        return store.delete(key) ? 1 : 0;
      }
      return null;
    },

    async quit(): Promise<void> {
      store.clear();
    },
  } as unknown as Redis;

  return mockRedis;
}

/**
 * Close Redis connection (for cleanup)
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
