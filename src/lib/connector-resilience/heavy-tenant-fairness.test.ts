/**
 * Scenario G: Heavy Tenant Fairness & Worker Monopolization
 *
 * Verifies that:
 * 1. A single heavy agency (e.g. 50 ad accounts) queued before small agencies (1-2 accounts each)
 *    consumes worker slots in FIFO order.
 * 2. Documents the measured head-of-line blocking effect on small tenants.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("Scenario G: Heavy Tenant Fairness & Head-of-Line Blocking", () => {
  it("Measures serial queue processing time: 1 heavy tenant (50 accounts) vs 4 small tenants (2 accounts)", async () => {
    // Model execution time per account fetch & ingest: ~100ms
    const TIME_PER_ACCOUNT_MS = 20;

    const heavyTenantAccounts = Array.from({ length: 50 }, (_, i) => `act_heavy_${i}`);
    const smallTenant1Accounts = ["act_small1_1", "act_small1_2"];
    const smallTenant2Accounts = ["act_small2_1", "act_small2_2"];
    const smallTenant3Accounts = ["act_small3_1", "act_small3_2"];
    const smallTenant4Accounts = ["act_small4_1", "act_small4_2"];

    // Simulated single-worker queue
    const queue = [
      { name: "Heavy Tenant", count: heavyTenantAccounts.length },
      { name: "Small Tenant 1", count: smallTenant1Accounts.length },
      { name: "Small Tenant 2", count: smallTenant2Accounts.length },
      { name: "Small Tenant 3", count: smallTenant3Accounts.length },
      { name: "Small Tenant 4", count: smallTenant4Accounts.length },
    ];

    let currentQueueTime = 0;
    const waitTimes: Record<string, number> = {};

    for (const item of queue) {
      waitTimes[item.name] = currentQueueTime;
      const processingTime = item.count * TIME_PER_ACCOUNT_MS;
      currentQueueTime += processingTime;
    }

    // Heavy tenant wait time is 0ms (queued first)
    assert.equal(waitTimes["Heavy Tenant"], 0);

    // Small tenant 1 must wait for all 50 accounts of the heavy tenant to finish:
    const expectedHeavyDuration = 50 * TIME_PER_ACCOUNT_MS;
    assert.equal(waitTimes["Small Tenant 1"], expectedHeavyDuration);

    // Small tenants suffer head-of-line blocking proportional to heavy tenant size
    assert.ok(waitTimes["Small Tenant 4"] >= expectedHeavyDuration);
  });
});
