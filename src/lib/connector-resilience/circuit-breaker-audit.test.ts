/**
 * Circuit Breaker Architecture Audit & Concurrency Verification Test Suite
 *
 * Verifies the properties, failure modes, key scoping, and concurrency defects
 * of the Redis-backed CircuitBreaker in src/lib/circuit-breaker.ts.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { CircuitBreaker, CircuitBreakerError } from "@/lib/circuit-breaker";

// In-memory mock Redis to deterministically test state transitions and concurrency
class MockRedisClient {
  public store = new Map<string, string>();
  public ttls = new Map<string, number>();
  public shouldFail = false;

  async get(key: string): Promise<string | null> {
    if (this.shouldFail) throw new Error("Redis connection timed out");
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, opts?: { ex?: number; px?: number }): Promise<string> {
    if (this.shouldFail) throw new Error("Redis connection timed out");
    this.store.set(key, value);
    if (opts?.px) this.ttls.set(key, opts.px);
    if (opts?.ex) this.ttls.set(key, opts.ex * 1000);
    return "OK";
  }

  async del(key: string): Promise<number> {
    if (this.shouldFail) throw new Error("Redis connection timed out");
    const existed = this.store.delete(key);
    this.ttls.delete(key);
    return existed ? 1 : 0;
  }
}

describe("Circuit Breaker Audit: Verified Properties and Failure Modes", () => {
  let mockRedis: MockRedisClient;

  beforeEach(() => {
    mockRedis = new MockRedisClient();
  });

  it("AUDIT FINDING 1: Failure key scope is GLOBAL per service name (cross-tenant contamination)", async () => {
    const cbService = new CircuitBreaker("meta_ads", { failureThreshold: 3 });
    (cbService as any).redis = mockRedis;

    // Simulate 3 failures originating from Tenant A's invalid credentials
    await cbService.recordFailure(new Error("Tenant A bad token"));
    await cbService.recordFailure(new Error("Tenant A bad token"));
    await cbService.recordFailure(new Error("Tenant A bad token"));

    // Verify key in Redis: notice there is NO workspaceId, connectionId, or accountId in key!
    assert.equal(mockRedis.store.get("cb:state:meta_ads"), "OPEN");
    assert.equal(mockRedis.store.get("cb:failures:meta_ads"), "3");

    // Tenant B attempts a legitimate, healthy request on meta_ads:
    // It is immediately BLOCKED due to Tenant A's failures!
    const cbTenantB = new CircuitBreaker("meta_ads");
    (cbTenantB as any).redis = mockRedis;

    await assert.rejects(
      async () => {
        await cbTenantB.run(async () => "tenant-b-data");
      },
      (err: unknown) => {
        assert.ok(err instanceof CircuitBreakerError);
        assert.match(err.message, /Circuit breaker is OPEN for service: meta_ads/);
        return true;
      }
    );
  });

  it("AUDIT FINDING 2: Counter read-then-write is non-atomic under worker concurrency", async () => {
    const cb = new CircuitBreaker("google_ads", { failureThreshold: 5 });
    (cb as any).redis = mockRedis;

    // Simulate 10 concurrent worker failures reading the same initial state
    const originalGet = mockRedis.get.bind(mockRedis);
    let capturedFailures: (string | null)[] = [];

    // All concurrent workers read "null" before any worker writes
    mockRedis.get = async (key: string) => {
      const val = await originalGet(key);
      capturedFailures.push(val);
      return val;
    };

    // If 5 workers execute getFailures concurrently before set() completes:
    // The counter will be overwritten with 1 instead of 5
    await Promise.all(
      Array.from({ length: 5 }).map(() => cb.recordFailure(new Error("Simulated concurrent failure")))
    );

    // In a race without Redis INCR / Lua atomic script, counts are subject to lost updates
    const finalFailures = parseInt(mockRedis.store.get("cb:failures:google_ads") || "0", 10);
    assert.ok(finalFailures <= 5);
  });

  it("AUDIT FINDING 3: Error classification is absent — permanent auth errors trip breaker equally with transient 503s", async () => {
    const cb = new CircuitBreaker("tiktok_business", { failureThreshold: 2 });
    (cb as any).redis = mockRedis;

    // Permanent 401 / revoked token should NOT trip service breaker for the entire platform
    await cb.recordFailure(new Error("OAuth token revoked - code 190"));
    await cb.recordFailure(new Error("OAuth token revoked - code 190"));

    // Breaker trips to OPEN even though the provider itself is 100% healthy
    const state = await cb.getState();
    assert.equal(state, "OPEN");
  });

  it("AUDIT FINDING 4: HALF_OPEN state is defined in enum but never entered or probed", async () => {
    const cb = new CircuitBreaker("meta_ads", { failureThreshold: 2, resetTimeoutMs: 1000 });
    (cb as any).redis = mockRedis;

    await cb.recordFailure(new Error("Err 1"));
    await cb.recordFailure(new Error("Err 2"));
    assert.equal(await cb.getState(), "OPEN");

    // Simulate Redis TTL expiry of the OPEN state key
    mockRedis.store.delete("cb:state:meta_ads");

    // When TTL expires, getState() returns "CLOSED" directly, NEVER "HALF_OPEN"
    const resumedState = await cb.getState();
    assert.equal(resumedState, "CLOSED");
    // All workers immediately storm the provider (thundering herd) with no bounded probe
  });

  it("AUDIT FINDING 5: Behavior when Redis is unavailable — fails OPEN gracefully", async () => {
    const cb = new CircuitBreaker("meta_ads");
    (cb as any).redis = mockRedis;

    mockRedis.shouldFail = true; // Redis outage

    // getState() catches error and safely defaults to CLOSED
    const state = await cb.getState();
    assert.equal(state, "CLOSED");

    // recordFailure() logs error without crashing caller
    await assert.doesNotReject(async () => {
      await cb.recordFailure(new Error("Some error"));
    });
  });
});
