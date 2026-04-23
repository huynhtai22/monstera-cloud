/**
 * Vercel KV (Redis) Configuration - Flux Architecture Compliance
 * Centralized KV client for token caching and distributed locking
 * Features Circuit Breaker pattern for fault tolerance
 */

import { createClient } from "@vercel/kv";

// Vercel KV client configuration
const KV_URL = process.env.KV_URL;
const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

// Global client instances
let kvClient: ReturnType<typeof createClient> | null = null;
let proxyClient: any = null;
let mockKvClient: any = null;

// Circuit Breaker State
let circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
let failureCount = 0;
let lastFailureTime = 0;
const FAILURE_THRESHOLD = 3;
const RESET_TIMEOUT_MS = 30000; // 30 seconds before testing recovery

/**
 * Get or create Vercel KV client (singleton with Circuit Breaker)
 */
export function getRedis() {
  // If not configured, just return mock
  if (!KV_URL && !KV_REST_API_URL) {
    if (!mockKvClient) mockKvClient = createMockKV();
    return mockKvClient;
  }

  // Manage circuit state
  if (circuitState === 'OPEN') {
    if (Date.now() - lastFailureTime > RESET_TIMEOUT_MS) {
      console.log("[VercelKV] Circuit HALF-OPEN: Testing connection...");
      circuitState = 'HALF_OPEN';
    } else {
      if (!mockKvClient) mockKvClient = createMockKV();
      return mockKvClient; // Fail over
    }
  }

  if (!proxyClient) {
    kvClient = createClient({
      url: KV_URL || KV_REST_API_URL,
      token: KV_REST_API_TOKEN,
    });
    
    // Create proxy to intercept failures
    proxyClient = new Proxy(kvClient, {
      get(target, prop) {
        const origMethod = target[prop as keyof typeof target];
        if (typeof origMethod === 'function') {
          return async function (...args: any[]) {
            try {
              // Upstash handles commands sequentially, binding is required
              const result = await origMethod.apply(target, args);
              if (circuitState === 'HALF_OPEN') {
                console.log("[VercelKV] Circuit CLOSED: Connection recovered");
                circuitState = 'CLOSED';
                failureCount = 0;
              }
              return result;
            } catch (err) {
              failureCount++;
              lastFailureTime = Date.now();
              console.error(`[VercelKV] Redis operation failed (${failureCount}/${FAILURE_THRESHOLD}): ${prop.toString()}`, err);
              
              if (failureCount >= FAILURE_THRESHOLD && circuitState !== 'OPEN') {
                console.warn("[VercelKV] Circuit OPEN: Falling back to in-memory KV");
                circuitState = 'OPEN';
              }
              // If we fail during HALF_OPEN, instantly go back to OPEN
              if (circuitState === 'HALF_OPEN') {
                 circuitState = 'OPEN';
              }
              
              // Fallback for this immediate call so the app doesn't crash on this request
              if (!mockKvClient) mockKvClient = createMockKV();
              if (typeof mockKvClient[prop] === 'function') {
                console.log(`[VercelKV] Executing fallback for method: ${prop.toString()}`);
                return mockKvClient[prop](...args);
              }
              throw err; 
            }
          };
        }
        return origMethod;
      }
    });

    console.log("[VercelKV] Client initialized with Circuit Breaker");
  }

  return proxyClient;
}

/**
 * Mock KV for local development and Circuit Breaker fallback
 */
function createMockKV() {
  const store = new Map<string, { value: string; expiry: number }>();
  // Simple event emitter for pub/sub mock
  const channels = new Map<string, Set<(message: string) => void>>();

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

    async set(key: string, value: string, opts?: { ex?: number; px?: number }): Promise<string> {
      const ttl = opts?.px ? opts.px : (opts?.ex ? opts.ex * 1000 : 86400000); // ms
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
    
    async pexpire(key: string, ms: number): Promise<number> {
      const item = store.get(key);
      if (item) {
        item.expiry = Date.now() + ms;
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
    
    async pttl(key: string): Promise<number> {
       const item = store.get(key);
       if (!item) return -2;
       const remaining = item.expiry - Date.now();
       return remaining > 0 ? remaining : -1;
    },

    async setnx(key: string, value: string): Promise<number> {
      if (store.has(key)) return 0;
      store.set(key, { value, expiry: Date.now() + 30000 }); // 30s default
      return 1;
    },
    
    async exists(key: string): Promise<number> {
      const item = store.get(key);
      if (!item) return 0;
      if (Date.now() > item.expiry) {
         store.delete(key);
         return 0;
      }
      return 1;
    },

    // For distributed mutex - simple implementation
    async eval(
      script: string,
      keys: string[],
      args: (string | number)[]
    ): Promise<any> {
      // Simple Lua script simulation for locking
      if (script.includes("return ARGV[1]")) {
        // acquire lock
        const [key] = keys;
        const [value, ttl] = args;
        const exists = await this.exists(key);
        if (exists === 0) {
           await this.set(key, String(value), { px: Number(ttl) });
           return value;
        }
        return null;
      }
      if (script.includes("del")) {
        // release lock
        const [key] = keys;
        const [value] = args;
        const current = await this.get(key);
        if (current === String(value)) {
           return await this.del(key);
        }
        return 0;
      }
      if (script.includes("pexpire")) {
         // extend lock
         const [key] = keys;
         const [value, ttl] = args;
         const current = await this.get(key);
         if (current === String(value)) {
            return await this.pexpire(key, Number(ttl));
         }
         return 0;
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

    // Mock pub/sub
    async publish(channel: string, message: string): Promise<number> {
      const subs = channels.get(channel);
      if (subs) {
        subs.forEach(cb => cb(message));
        return subs.size;
      }
      return 0;
    },

    async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
      if (!channels.has(channel)) {
        channels.set(channel, new Set());
      }
      channels.get(channel)!.add(callback);
    },

    async unsubscribe(channel: string, callback: (message: string) => void): Promise<void> {
      const subs = channels.get(channel);
      if (subs) {
        subs.delete(callback);
      }
    }
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
  circuit: "CLOSED" | "OPEN" | "HALF_OPEN";
} {
  return {
    configured: isKVConfigured(),
    type: isKVConfigured() ? "vercel" : "memory",
    circuit: circuitState,
  };
}
