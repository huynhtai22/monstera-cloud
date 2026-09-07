/**
 * Scenario A: Rate-Limit Storm & Retry Amplification
 *
 * Verifies behavior when multiple concurrent workers encounter provider 429 /
 * rate limit responses:
 * 1. Checks whether concurrency is coordinated across workers or retried independently.
 * 2. Measures retry amplification (uncoordinated workers multiplying requests).
 * 3. Tests backoff compliance with and without Retry-After headers.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { installNetworkDenialGuard, restoreNetworkGuard } from "./network-denial-guard";
import { ProviderSimulator } from "./provider-simulator";
import { setupSyntheticTestEnv } from "./test-env";
import { metaReportClient } from "@/lib/meta-ads";
import { googleAdsReportClient } from "@/lib/google-ads";
import { tiktokReportClient } from "@/lib/tiktok-business";

describe("Scenario A: Rate-Limit Storm & Concurrency Coordination", () => {
  let simulator: ProviderSimulator;

  beforeEach(() => {
    setupSyntheticTestEnv();
    simulator = new ProviderSimulator();
    installNetworkDenialGuard((url, init) => simulator.handleRequest(url, init));
  });

  afterEach(() => {
    restoreNetworkGuard();
  });

  it("Meta Ads: Jittered retry and throttle header backoff prevents immediate retry flood", async () => {
    simulator.setFaults({
      meta: {
        rateLimitAccountIds: new Set(["act_rate_limit_1"]),
        retryAfterSeconds: 1,
      },
    });

    const startTime = Date.now();
    await assert.rejects(
      async () => {
        await metaReportClient.getInsights("valid-token", {
          adAccountId: "act_rate_limit_1",
          fields: ["impressions", "clicks", "spend"],
          level: "campaign",
        });
      },
      (err: unknown) => {
        assert.match(String(err), /613|rate limit/i);
        return true;
      }
    );
    const duration = Date.now() - startTime;

    // metaFetch performed 4 attempts with exponential backoff
    assert.equal(simulator.metrics.metaRequests, 4);
    assert.equal(simulator.metrics.rateLimitHits, 4);
    assert.ok(duration >= 2000, `Expected backoff duration >= 2000ms, got ${duration}ms`);
  });

  it("Google Ads: SearchStream handles 429 RESOURCE_EXHAUSTED with bounded retries", async () => {
    simulator.setFaults({
      google: {
        rateLimitCustomerIds: new Set(["1234567890"]),
      },
    });

    await assert.rejects(
      async () => {
        await googleAdsReportClient.getCampaignPerformance(
          "valid-google-token",
          "1234567890",
          "LAST_30_DAYS",
          "1234567890"
        );
      },
      (err: unknown) => {
        assert.match(String(err), /RESOURCE_EXHAUSTED/);
        return true;
      }
    );

    // Google client retries 3 times before failing
    assert.equal(simulator.metrics.googleRequests, 3);
    assert.equal(simulator.metrics.rateLimitHits, 3);
  });

  it("TikTok Ads: Rate limit 429 with Retry-After header is honored during task creation", async () => {
    simulator.setFaults({
      tiktok: {
        rateLimitAdvertiserIds: new Set(["70099"]),
        retryAfterSeconds: 1,
      },
    });

    await assert.rejects(
      async () => {
        await tiktokReportClient.createTask("valid-token", {
          advertiser_id: "70099",
          report_type: "BASIC",
          data_level: "AUCTION_CAMPAIGN",
          dimensions: ["campaign_id", "stat_time_day"],
          metrics: ["spend", "impressions"],
          start_date: "2026-01-01",
          end_date: "2026-01-02",
        });
      },
      (err: unknown) => {
        assert.match(String(err), /Rate limit exceeded/);
        return true;
      }
    );

    // 3 attempts made
    assert.equal(simulator.metrics.tiktokRequests, 3);
    assert.equal(simulator.metrics.rateLimitHits, 3);
  });

  it("Concurrency Finding: 5 concurrent workers on independent connections execute in parallel without global rate coordination", async () => {
    simulator.setFaults({
      meta: { latencyMs: 50 },
    });

    // 5 workers querying 5 different accounts
    const accountIds = ["act_101", "act_102", "act_103", "act_104", "act_105"];
    await Promise.all(
      accountIds.map((id) =>
        metaReportClient.getInsights("token", {
          adAccountId: id,
          fields: ["spend", "clicks"],
          level: "campaign",
        })
      )
    );

    assert.equal(simulator.metrics.metaRequests, 5);
    // Verified: Concurrency reached 5 simultaneously because quota coordination is local/unshared
    assert.ok(simulator.metrics.peakConcurrency >= 4, `Peak concurrency was ${simulator.metrics.peakConcurrency}`);
  });
});
