/**
 * Vercel KV (Redis) Configuration - Flux Architecture Compliance
 * Centralized KV client for token caching and distributed locking
 */

import { createClient } from "@vercel/kv";

// Vercel KV client configuration
const KV_URL = process.env.KV_URL;
const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

// Global KV client instance
let kvClient: ReturnType<typeof createClient> | null = null;

/**
 * Get or create Vercel KV client (singleton pattern)
 */
export function getRedis() {
  if (!kvClient) {
    // Check if Vercel KV is configured
    if (!KV_URL && !KV_REST_API_URL) {
      console.warn("[VercelKV] KV_URL not configured, using in-memory fallback");
      return createMockKV();
    }

    kvClient = createClient({
      url: KV_URL || KV_REST_API_URL,
      token: KV_REST_API_TOKEN,
    });

    console.log("[VercelKV] Client initialized");
  }

  return kvClient;
}

/**
 * Mock KV for local development (fallback when Vercel KV not configured)
 */
function createMockKV() {
  const store = new Map<string, { value: string; expiry: number }>();

  return {
    async get(key: string): Promise<string | null> {
      const item = store.get(key);
      if (!item) return null;
      if (Date.now() > item.expiry) {
        store.delete(key);
        return null;
      }
      return item.value;
    },

    async set(key: string, value: string, opts?: { ex?: number }): Promise<string> {
      const ttl = opts?.ex ? opts.ex * 1000 : 86400000; // ms
      store.set(key, { value, expiry: Date.now() + ttl });
      return "OK";
    },

    async del(key: string | string[]): Promise<number> {
      if (Array.isArray(key)) {
        let count = 0;
        for (const k of key) {
          if (store.delete(k)) count++;
        }
        return count;
      }
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

    // For distributed mutex - simple implementation
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

    async mget(keys: string[]): Promise<(string | null)[]> {
      return keys.map((k) => {
        const item = store.get(k);
        if (!item) return null;
        if (Date.now() > item.expiry) {
          store.delete(k);
          return null;
        }
        return item.value;
      });
    },
  } as any;
}

/**
 * Check if Vercel KV is properly configured
 */
export function isKVConfigured(): boolean {
  return !!(KV_URL || KV_REST_API_URL);
}

/**
 * Get KV configuration status for health checks
 */
export function getKVStatus(): {
  configured: boolean;
  type: "vercel" | "memory";
} {
  return {
    configured: isKVConfigured(),
    type: isKVConfigured() ? "vercel" : "memory",
  };
}
