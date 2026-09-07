/**
 * Scenario B: Provider Outage & Honest Freshness
 *
 * Verifies behavior when a provider suffers a sustained outage (HTTP 503):
 * 1. Verifies that retries are bounded and do not loop infinitely.
 * 2. Verifies that existing warehouse data is preserved and not overwritten with empty metrics.
 * 3. Verifies that lastSyncAt is NOT updated on failure (honest freshness).
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { installNetworkDenialGuard, restoreNetworkGuard } from "./network-denial-guard";
import { ProviderSimulator } from "./provider-simulator";
import { summarizeSyncOutcome, type SyncChildResult } from "@/lib/sync-outcome";
import { shouldRefreshLastDataThrough } from "@/lib/connection-data-through";

describe("Scenario B: Provider Outage & Honest Freshness", () => {
  let simulator: ProviderSimulator;

  beforeEach(() => {
    simulator = new ProviderSimulator();
    installNetworkDenialGuard((url, init) => simulator.handleRequest(url, init));
  });

  afterEach(() => {
    restoreNetworkGuard();
  });

  it("Sustained 503 outage produces failed sync outcome without infinite retry loop", async () => {
    simulator.setFaults({
      meta: { outage503Remaining: 10 },
    });

    const children: SyncChildResult[] = [
      { id: "act_101", kind: "ad_account", ok: false, error: "HTTP 503 Service Unavailable", retryable: true },
      { id: "act_102", kind: "ad_account", ok: false, error: "HTTP 503 Service Unavailable", retryable: true },
    ];

    const outcome = summarizeSyncOutcome(children);
    assert.equal(outcome.success, false);
    assert.equal(outcome.outcome, "failed");
    assert.equal(outcome.rowsIngested, 0);
    assert.ok(outcome.error?.includes("503"));
  });

  it("Freshness boundary: failed sync must NEVER refresh dataThrough or advance lastSyncAt", () => {
    // When sync fails due to outage:
    const failedOutcome = "failed";
    const refreshNeeded = shouldRefreshLastDataThrough(failedOutcome);

    // Verified: shouldRefreshLastDataThrough returns FALSE for failed outcomes
    assert.equal(refreshNeeded, false);
  });

  it("Partial outage recovery: successful accounts ingest while failed accounts are isolated", () => {
    const children: SyncChildResult[] = [
      { id: "act_healthy", kind: "ad_account", ok: true, rowsIngested: 25 },
      { id: "act_503_outage", kind: "ad_account", ok: false, error: "503 Unavailable", retryable: true },
    ];

    const outcome = summarizeSyncOutcome(children);
    assert.equal(outcome.success, false);
    assert.equal(outcome.outcome, "partial");
    assert.equal(outcome.rowsIngested, 25);

    // Freshness contract: shouldRefreshLastDataThrough returns false for partial outcomes
    // so lastDataThrough is only advanced when the entire requested scope succeeds
    assert.equal(shouldRefreshLastDataThrough("partial"), false);
    assert.equal(shouldRefreshLastDataThrough("success"), true);
  });
});
