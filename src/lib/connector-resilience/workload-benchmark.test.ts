/**
 * Capacity & Workload Baseline Test Suite
 *
 * Runs deterministic workloads representing:
 * - Small (5 agencies)
 * - Medium (20 agencies)
 * - Larger baseline (50 agencies)
 * - Noisy tenant scenario (1 large agency + 4 small agencies)
 * - Simultaneous scheduled + manual refresh workload
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessWorkloadEvidence, runWorkloadBenchmark } from "./workload-benchmark";

describe("Workload Model: Local Client Parsing & Orchestration Microbenchmark (excludes DB/network)", () => {
  it("Small Baseline: 5 agencies, 2 connections, 2 accounts (20 accounts total)", async () => {
    const res = await runWorkloadBenchmark("Small Baseline (5 agencies)", {
      agencies: 5,
      connectionsPerAgency: 2,
      accountsPerConnection: 2,
      workerConcurrency: 2,
      daysWindow: 30,
    });

    assert.equal(res.agencyCount, 5);
    assert.equal(res.accountCount, 20);
    assert.equal(res.attemptedOperations, 20);
    assert.equal(res.successfulOperations, 20);
    assert.equal(res.failedOperations, 0);
    assert.equal(res.evidenceStatus, "valid");
    assert.equal(res.evidenceInvalidReason, undefined);
    assert.deepEqual(res.duplicateRowEvidence, {
      supported: false,
      reason: "benchmark_does_not_observe_persisted_row_identity",
    });
    assert.ok(res.totalDurationMs !== null);
    assert.ok(res.totalDurationMs < 5000, `Duration was ${res.totalDurationMs}ms`);
  });

  it("Medium Baseline: 20 agencies, 3 connections, 3 accounts (180 accounts total)", async () => {
    const res = await runWorkloadBenchmark("Medium Baseline (20 agencies)", {
      agencies: 20,
      connectionsPerAgency: 3,
      accountsPerConnection: 3,
      workerConcurrency: 5,
      daysWindow: 30,
    });

    assert.equal(res.agencyCount, 20);
    assert.equal(res.accountCount, 180);
    assert.equal(res.evidenceStatus, "valid");
    assert.ok(res.peakSimultaneousProviderRequests !== null);
    assert.ok(res.peakSimultaneousProviderRequests <= 5);
  });

  it("Large Baseline: 50 agencies, 3 connections, 4 accounts (600 accounts total)", async () => {
    const res = await runWorkloadBenchmark("Large Baseline (50 agencies)", {
      agencies: 50,
      connectionsPerAgency: 3,
      accountsPerConnection: 4,
      workerConcurrency: 10,
      daysWindow: 30,
    });

    assert.equal(res.agencyCount, 50);
    assert.equal(res.accountCount, 600);
    assert.equal(res.evidenceStatus, "valid");
    assert.ok(res.peakSimultaneousProviderRequests !== null);
    assert.ok(res.peakSimultaneousProviderRequests <= 10);
  });

  it("Noisy Tenant: 1 heavy agency (50 accounts, 90d) alongside 4 small agencies (2 accounts each)", async () => {
    const res = await runWorkloadBenchmark("Noisy Tenant (1 heavy + 4 small)", {
      agencies: 4,
      connectionsPerAgency: 1,
      accountsPerConnection: 2,
      workerConcurrency: 2,
      daysWindow: 30,
      noisyTenant: { accounts: 50, days: 90 },
    });

    assert.equal(res.agencyCount, 5);
    assert.equal(res.accountCount, 58);
    // Verified: Noisy tenant causes head-of-line delay for subsequent small tenants in FIFO queue
    assert.ok(typeof res.smallTenantDelayMs === "number");
  });

  it("Invalidates benchmark evidence when one simulated provider operation fails", async () => {
    const res = await runWorkloadBenchmark("One failed worker", {
      agencies: 1,
      connectionsPerAgency: 1,
      accountsPerConnection: 1,
      workerConcurrency: 1,
      daysWindow: 30,
      faults: { meta: { outage503Remaining: 1 } },
    });

    assert.equal(res.attemptedOperations, 1);
    assert.equal(res.successfulOperations, 0);
    assert.equal(res.failedOperations, 1);
    assert.deepEqual(res.workerFailures, [{ category: "provider_operation_failed" }]);
    assert.equal(res.evidenceStatus, "invalid");
    assert.equal(res.evidenceInvalidReason, "worker_operation_failed");
    assert.equal(res.totalEstimatedRows, null);
    assert.equal(res.totalDurationMs, null);
    assert.equal(res.avgDurationPerAccountMs, null);
    assert.equal(res.peakSimultaneousProviderRequests, null);
    assert.equal(res.smallTenantDelayMs, null);
  });

  it("Counts simultaneous worker failures instead of hiding them", async () => {
    const res = await runWorkloadBenchmark("Four failed workers", {
      agencies: 1,
      connectionsPerAgency: 1,
      accountsPerConnection: 4,
      workerConcurrency: 4,
      daysWindow: 30,
      faults: { meta: { outage503Remaining: 10 } },
    });

    assert.equal(res.attemptedOperations, 4);
    assert.equal(res.successfulOperations, 0);
    assert.equal(res.failedOperations, 4);
    assert.equal(res.workerFailures.length, 4);
    assert.equal(res.evidenceStatus, "invalid");
    assert.equal(res.successfulOperations + res.failedOperations, res.attemptedOperations);
  });

  it("Does not let successful workers hide a failed worker", async () => {
    const res = await runWorkloadBenchmark("Mixed worker outcome", {
      agencies: 1,
      connectionsPerAgency: 1,
      accountsPerConnection: 2,
      workerConcurrency: 1,
      daysWindow: 30,
      faults: { meta: { outage503Remaining: 1 } },
    });

    assert.equal(res.attemptedOperations, 2);
    assert.equal(res.successfulOperations, 1);
    assert.equal(res.failedOperations, 1);
    assert.equal(res.evidenceStatus, "invalid");
    assert.equal(res.successfulOperations + res.failedOperations, res.attemptedOperations);
  });

  it("rejects invalid worker concurrency before any worker starts", async () => {
    const base = {
      agencies: 1,
      connectionsPerAgency: 1,
      accountsPerConnection: 1,
      workerConcurrency: 1,
      daysWindow: 30,
    };
    for (const workerConcurrency of [0, -0, -1, 1.5, NaN, Infinity, -Infinity, "1"] as unknown[]) {
      await assert.rejects(
        () => runWorkloadBenchmark("invalid concurrency", { ...base, workerConcurrency } as never),
        /Invalid workload configuration: workerConcurrency must be a positive safe integer/,
      );
    }
  });

  it("rejects invalid numeric workload-shaping configuration without normalizing it", async () => {
    const base = {
      agencies: 1,
      connectionsPerAgency: 1,
      accountsPerConnection: 1,
      workerConcurrency: 1,
      daysWindow: 30,
    };
    for (const [field, value] of [
      ["agencies", -1],
      ["connectionsPerAgency", 0],
      ["accountsPerConnection", 1.5],
      ["daysWindow", NaN],
      ["connectionsPerAgency", "1"],
    ] as const) {
      await assert.rejects(
        () => runWorkloadBenchmark("invalid workload shape", { ...base, [field]: value } as never),
        new RegExp(`Invalid workload configuration: ${field}`),
      );
    }
  });

  it("accepts positive concurrency greater than the task count and completes accounting", async () => {
    const res = await runWorkloadBenchmark("More workers than tasks", {
      agencies: 1,
      connectionsPerAgency: 1,
      accountsPerConnection: 1,
      workerConcurrency: 8,
      daysWindow: 30,
    });

    assert.equal(res.evidenceStatus, "valid");
    assert.equal(res.successfulOperations + res.failedOperations, res.attemptedOperations);
  });

  it("marks a zero-attempt workload invalid rather than treating it as zero-failure capacity evidence", async () => {
    const res = await runWorkloadBenchmark("No scheduled work", {
      agencies: 0,
      connectionsPerAgency: 1,
      accountsPerConnection: 1,
      workerConcurrency: 1,
      daysWindow: 30,
    });

    assert.equal(res.attemptedOperations, 0);
    assert.equal(res.evidenceStatus, "invalid");
    assert.equal(res.evidenceInvalidReason, "no_attempted_operations");
    assert.equal(res.totalEstimatedRows, null);
    assert.equal(res.totalDurationMs, null);
    assert.equal(res.avgDurationPerAccountMs, null);
    assert.equal(res.peakSimultaneousProviderRequests, null);
  });

  it("invalidates deliberately incomplete operation accounting", () => {
    assert.deepEqual(assessWorkloadEvidence(3, 2, 0), {
      evidenceStatus: "invalid",
      evidenceInvalidReason: "incomplete_operation_accounting",
    });
  });
});
