/**
 * Scenario F: Redis Failure & Graceful Degradation
 *
 * Verifies that:
 * 1. Redis is used as an optional optimization layer (caching / telemetry), while PostgreSQL is the authoritative state machine.
 * 2. Documents behavior when Redis is unavailable during circuit breaker operations.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CircuitBreaker } from "@/lib/circuit-breaker";

describe("Scenario F: Redis Failure & Graceful Degradation", () => {
  it("Circuit Breaker getState() degrades gracefully to CLOSED when Redis throws", async () => {
    const cb = new CircuitBreaker("meta_ads");
    // Mock redis client that always throws
    (cb as any).redis = {
      get: async () => { throw new Error("Connection refused: Redis 6379"); },
      set: async () => { throw new Error("Connection refused: Redis 6379"); },
      del: async () => { throw new Error("Connection refused: Redis 6379"); },
    };

    // getState() catches error and safely defaults to CLOSED
    const state = await cb.getState();
    assert.equal(state, "CLOSED");
  });

  it("AUDIT FINDING: recordSuccess() lacks try/catch on redis.del() and fails if Redis throws", async () => {
    const cb = new CircuitBreaker("meta_ads");
    (cb as any).redis = {
      get: async () => "CLOSED",
      set: async () => "OK",
      del: async () => { throw new Error("Connection refused: Redis 6379"); },
    };

    // recordSuccess() throws because redis.del() is not wrapped in try/catch:
    await assert.rejects(
      async () => {
        await cb.recordSuccess();
      },
      (err: unknown) => {
        assert.match(String(err), /Connection refused: Redis 6379/);
        return true;
      }
    );
  });
});
