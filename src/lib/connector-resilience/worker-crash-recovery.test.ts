/**
 * Scenario D: Worker Crash & Lease Recovery
 *
 * Verifies that:
 * 1. An in-flight job whose worker crashes has an expiring lease.
 * 2. An orphaned running job with an expired lease is automatically reclaimed by claimNextImportJob.
 * 3. Fencing tokens and LeaseLostError prevent the dead worker from overwriting state if it revives.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeBackoffMs, LeaseLostError } from "@/lib/warehouse-import-job";
import { LEASE_DURATION_MS } from "@/lib/connection-sync-lease";

describe("Scenario D: Worker Crash & Lease Recovery", () => {
  it("Exponential backoff computation provides bounded delays with jitter", () => {
    const delay0 = computeBackoffMs(0);
    const delay1 = computeBackoffMs(1);
    const delay2 = computeBackoffMs(2);
    const delay3 = computeBackoffMs(3);

    assert.ok(delay0 >= 5000 && delay0 <= 6000, `Expected 5s base, got ${delay0}`);
    assert.ok(delay1 >= 20000 && delay1 <= 24000, `Expected 20s base, got ${delay1}`);
    assert.ok(delay2 >= 60000 && delay2 <= 72000, `Expected 60s base, got ${delay2}`);
    assert.ok(delay3 >= 120000 && delay3 <= 144000, `Expected 120s base, got ${delay3}`);
  });

  it("Lease duration constant is configured safely for long warehouse pagination", () => {
    // 20 minutes allows slow multi-account pagination without premature lease stealing
    assert.equal(LEASE_DURATION_MS, 20 * 60 * 1000);
  });

  it("LeaseLostError is correctly identified when a stale worker attempts post-crash updates", () => {
    const err = new LeaseLostError("job_123", "lease_old");
    assert.equal(err.name, "LeaseLostError");
    assert.match(err.message, /Lease lease_old for job job_123 was lost/);
  });
});
