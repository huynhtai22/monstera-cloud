import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRetryableSyncError,
  retryableFailedTargetIds,
  summarizeSyncOutcome,
  type SyncChildResult,
} from "./sync-outcome";
import { isTikTokRetryableFailure } from "./tiktok-business";
import { isGoogleAdsRetryableFailure } from "./google-ads";

describe("sync outcome contract", () => {
  it("records all-success only when every requested target completes", () => {
    const children: SyncChildResult[] = [
      { id: "act-1", kind: "ad_account", ok: true, rowsIngested: 3 },
      { id: "act-2", kind: "ad_account", ok: true, rowsIngested: 2 },
    ];
    assert.deepEqual(summarizeSyncOutcome(children), {
      success: true,
      outcome: "success",
      rowsIngested: 5,
      error: undefined,
    });
  });

  it("keeps mixed provider/account outcomes partial rather than successful", () => {
    const summary = summarizeSyncOutcome([
      { id: "customer-a", kind: "customer", ok: true, rowsIngested: 12 },
      { id: "customer-b", kind: "customer", ok: false, error: "429 quota", retryable: true },
    ]);
    assert.equal(summary.success, false);
    assert.equal(summary.outcome, "partial");
    assert.equal(summary.rowsIngested, 12);
    assert.match(summary.error ?? "", /customer-b/);
  });

  it("keeps a required Shopee endpoint failure partial even when zero-row endpoints are valid", () => {
    const summary = summarizeSyncOutcome([
      { id: "campaign_catalog", kind: "connection", ok: false, error: "Shopee API v2.ads.get_product_level_campaign_id_list error: error_permission" },
      { id: "product_catalog", kind: "connection", ok: true, rowsIngested: 0 },
      { id: "orders", kind: "connection", ok: true, rowsIngested: 0 },
      { id: "ads_performance", kind: "connection", ok: true, rowsIngested: 0 },
    ]);
    assert.equal(summary.outcome, "partial");
    assert.equal(summary.success, false);
    assert.match(summary.error ?? "", /get_product_level_campaign_id_list/);
  });

  it("records a complete provider failure as failed", () => {
    const summary = summarizeSyncOutcome([
      { id: "advertiser-a", kind: "advertiser", ok: false, error: "permission denied", retryable: false },
    ]);
    assert.equal(summary.success, false);
    assert.equal(summary.outcome, "failed");
  });

  it("retries only failed retryable targets and never successful targets", () => {
    const retries = retryableFailedTargetIds([
      { id: "act-success", kind: "ad_account", ok: true, rowsIngested: 4 },
      { id: "act-rate-limited", kind: "ad_account", ok: false, error: "429", retryable: true },
      { id: "act-permission", kind: "ad_account", ok: false, error: "permission", retryable: false },
    ]);
    assert.deepEqual(retries, ["act-rate-limited"]);
  });

  it("classifies quota/rate failures as retryable without assuming a global QPS", () => {
    assert.equal(isRetryableSyncError("Meta error 613: Calls to this api have exceeded the rate limit"), true);
    assert.equal(isTikTokRetryableFailure(429, 40100, "rate limit exceeded"), true);
    assert.equal(isTikTokRetryableFailure(400, 40001, "invalid advertiser"), false);
    assert.equal(isGoogleAdsRetryableFailure(429, "RESOURCE_EXHAUSTED"), true);
    assert.equal(isGoogleAdsRetryableFailure(403, "permission denied"), false);
  });
});
