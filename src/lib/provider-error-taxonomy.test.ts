import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { isRetryableSyncError } from "./sync-outcome";
import { isGoogleAdsDeveloperTokenBlocked, GoogleAdsProviderError } from "./google-ads";
import { shopeeGet } from "./shopee";

describe("structured retry classification (isRetryableSyncError)", () => {
  it("honors an explicit structured retryable flag over message content", () => {
    const err = new Error("network timeout happened") as Error & { retryable: boolean };
    err.retryable = false;
    assert.equal(isRetryableSyncError(err), false, "provider said non-retryable despite transient words");
    const err2 = new Error("account disabled permanently") as Error & { retryable: boolean };
    err2.retryable = true;
    assert.equal(isRetryableSyncError(err2), true);
  });

  it("structured auth conditions are never retryable", () => {
    assert.equal(isRetryableSyncError({ status: 401 }), false);
    assert.equal(isRetryableSyncError({ status: 403 }), false);
    assert.equal(isRetryableSyncError({ code: 190 }), false, "Meta OAuth revoked");
    const revoked = new Error("whatever") as any;
    revoked.authRevoked = true;
    assert.equal(isRetryableSyncError(revoked), false);
  });

  it("structured transient statuses are retryable", () => {
    assert.equal(isRetryableSyncError({ status: 429 }), true);
    assert.equal(isRetryableSyncError({ status: 503 }), true);
  });

  it("message regex remains the fallback for unstructured errors", () => {
    assert.equal(isRetryableSyncError("Error 429: too many requests"), true);
    assert.equal(isRetryableSyncError("rate limit exceeded"), true);
    assert.equal(isRetryableSyncError("some permanent policy violation"), false);
  });
});

describe("Google Ads DEVELOPER_TOKEN_NOT_APPROVED classification", () => {
  it("detects the structured provider code", () => {
    const err = new GoogleAdsProviderError(
      "Google Ads request failed 403: {error: DEVELOPER_TOKEN_NOT_APPROVED}",
      false,
      403,
      "DEVELOPER_TOKEN_NOT_APPROVED",
    );
    assert.equal(isGoogleAdsDeveloperTokenBlocked(err), true);
  });

  it("fallback match on wrapped message containing the provider constant", () => {
    assert.equal(isGoogleAdsDeveloperTokenBlocked(new Error("upstream: DEVELOPER_TOKEN_NOT_APPROVED for customer")), true);
  });

  it("ordinary leaf failures are NOT classified as application blockers", () => {
    assert.equal(isGoogleAdsDeveloperTokenBlocked(new Error("Google Ads request failed 403: CUSTOMER_NOT_ENABLED")), false);
    assert.equal(isGoogleAdsDeveloperTokenBlocked(new Error("rate quota exceeded")), false);
    assert.equal(isGoogleAdsDeveloperTokenBlocked(null), false);
  });
});

describe("Shopee transport retry (shopeeGet)", () => {
  const originalFetch = globalThis.fetch;
  process.env.SHOPEE_TEST_PARTNER_ID = process.env.SHOPEE_TEST_PARTNER_ID ?? "850001";
  process.env.SHOPEE_TEST_PARTNER_KEY = process.env.SHOPEE_TEST_PARTNER_KEY ?? "test-partner-key";
  const calls: Array<{ status: number; retryAfter?: string }> = [];
  const opts = { accessToken: "tok", shopId: 123, sandbox: true } as any;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    calls.length = 0;
  });

  const respond = (sequence: Array<{ status: number; body?: unknown; retryAfter?: string }>) => {
    let i = 0;
    globalThis.fetch = (async () => {
      const spec = sequence[Math.min(i, sequence.length - 1)];
      i += 1;
      calls.push({ status: spec.status, retryAfter: spec.retryAfter });
      if (spec.status >= 500 || spec.status === 429) {
        return new Response(JSON.stringify(spec.body ?? { error: "error_internal", message: "internal" }), {
          status: spec.status,
          headers: spec.retryAfter ? { "retry-after": spec.retryAfter } : {},
        });
      }
      return new Response(JSON.stringify(spec.body ?? { error: "", message: "success", response: { orders: [] } }), {
        status: spec.status,
      });
    }) as typeof fetch;
  };

  it("transient 5xx then success retries and succeeds", async () => {
    respond([{ status: 502 }, { status: 502 }, { status: 200 }]);
    const json = await shopeeGet("/api/v2/order/get_order_list", {}, opts);
    assert.ok(json);
    assert.equal(calls.length, 3, "two transient failures retried, third attempt succeeded");
  });

  it("429 is retried", async () => {
    respond([{ status: 429 }, { status: 200 }]);
    await shopeeGet("/api/v2/order/get_order_list", {}, opts);
    assert.equal(calls.length, 2);
  });

  it("permanent 4xx business error is NOT retried", async () => {
    respond([{ status: 200, body: { error: "error_param", message: "bad sign" } }]);
    await assert.rejects(
      () => shopeeGet("/api/v2/order/get_order_list", {}, opts),
      /error_param/,
    );
    assert.equal(calls.length, 1, "provider business errors surface immediately");
  });

  it("exhausted retries on persistent 5xx throw", async () => {
    respond([{ status: 500 }]);
    await assert.rejects(() => shopeeGet("/api/v2/order/get_order_list", {}, opts));
    assert.equal(calls.length, 3, "bounded at 3 attempts");
  });
});
