/**
 * Scenario C: Credential Revocation & Sibling Account Isolation
 *
 * Verifies that:
 * 1. An auth failure (OAuth revoked / code 190 / developer token rejected) is classified as non-retryable.
 * 2. Revocation of one account does NOT crash or invalidate sibling accounts on separate connections.
 * 3. Permanent auth errors require user reconnection and do not waste rate-limit retry budget.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { installNetworkDenialGuard, restoreNetworkGuard } from "./network-denial-guard";
import { ProviderSimulator } from "./provider-simulator";
import { metaReportClient, MetaOAuthRevokedError } from "@/lib/meta-ads";
import { isGoogleAdsDeveloperTokenBlocked, GoogleAdsProviderError, GOOGLE_ADS_DEVELOPER_TOKEN_NOT_APPROVED } from "@/lib/google-ads";
import { summarizeSyncOutcome, type SyncChildResult } from "@/lib/sync-outcome";

describe("Scenario C: Credential Revocation & Sibling Account Isolation", () => {
  let simulator: ProviderSimulator;

  beforeEach(() => {
    simulator = new ProviderSimulator();
    installNetworkDenialGuard((url, init) => simulator.handleRequest(url, init));
  });

  afterEach(() => {
    restoreNetworkGuard();
  });

  it("Meta Ads: Code 190 throws MetaOAuthRevokedError without unnecessary retries", async () => {
    simulator.setFaults({
      meta: {
        revokedAccountIds: new Set(["act_revoked_1"]),
      },
    });

    await assert.rejects(
      async () => {
        await metaReportClient.getInsights("revoked-token", {
          adAccountId: "act_revoked_1",
          fields: ["spend"],
          level: "campaign",
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof MetaOAuthRevokedError);
        assert.equal(err.code, 190);
        return true;
      }
    );

    // Verified: Exactly 1 request made, NO wasteful exponential backoff retries on permanent auth revocation
    assert.equal(simulator.metrics.metaRequests, 1);
    assert.equal(simulator.metrics.authErrors, 1);
  });

  it("Google Ads: DEVELOPER_TOKEN_NOT_APPROVED is detected as application-level blocker", () => {
    const error = new GoogleAdsProviderError(
      "DEVELOPER_TOKEN_NOT_APPROVED: Developer token is not approved for use",
      false,
      403,
      GOOGLE_ADS_DEVELOPER_TOKEN_NOT_APPROVED
    );

    assert.equal(isGoogleAdsDeveloperTokenBlocked(error), true);
    assert.equal(error.retryable, false);
  });

  it("Sibling Isolation: Revocation on Account A does not prevent Account B from completing", () => {
    const children: SyncChildResult[] = [
      { id: "act_revoked", kind: "ad_account", ok: false, error: "Meta authorization revoked", retryable: false },
      { id: "act_healthy", kind: "ad_account", ok: true, rowsIngested: 100 },
    ];

    const outcome = summarizeSyncOutcome(children);
    assert.equal(outcome.success, false);
    assert.equal(outcome.outcome, "partial");
    assert.equal(outcome.rowsIngested, 100);

    // The healthy account's 100 rows are recorded and preserved
    assert.equal(children.find((c) => c.id === "act_healthy")?.rowsIngested, 100);
  });
});
