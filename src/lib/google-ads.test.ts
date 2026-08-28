import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  GoogleAdsProviderError,
  GOOGLE_ADS_DEVELOPER_TOKEN_NOT_APPROVED,
  isGoogleAdsDeveloperTokenBlocked,
  isGoogleAdsCustomerUnavailable,
  isGoogleAdsRetryableFailure,
  normalizeGoogleAdsRow,
  googleAdsOAuthClient,
  googleAdsReportClient,
} from "./google-ads";

/**
 * Unit coverage for the Google Ads connector (no network): normalization,
 * micros handling, header/login-customer behavior, date-clause construction,
 * error/retry classification, leaf-account fallback, and secret redaction.
 */

const TOKEN_ENV = {
  GOOGLE_ADS_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
  GOOGLE_ADS_CLIENT_SECRET: "test-client-secret",
  GOOGLE_ADS_DEVELOPER_TOKEN: "test-developer-token-VALUE",
};

let captured: { url: string; init: RequestInit }[] = [];

function stubFetch(responses: Array<Record<string, unknown> | any[] | { __status: number; __body: string }>) {
  const original = globalThis.fetch;
  let call = 0;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    captured.push({ url, init });
    const res = responses[Math.min(call, responses.length - 1)];
    call++;
    if (typeof res === "object" && res !== null && "__status" in res) {
      return new Response((res as any).__body, { status: (res as any).__status });
    }
    return new Response(JSON.stringify(res), { status: 200 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe("google ads connector", () => {
  beforeEach(() => {
    captured = [];
    Object.assign(process.env, TOKEN_ENV);
  });
  afterEach(() => {
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    delete process.env.GOOGLE_ADS_CLIENT_ID;
    delete process.env.GOOGLE_ADS_CLIENT_SECRET;
  });

  // ── Normalization ──────────────────────────────────────────────────────────

  it("converts cost_micros to currency exactly once and flattens nested sections", () => {
    const row = normalizeGoogleAdsRow({
      campaign: { id: "123", name: "Brand", status: "ENABLED" },
      customer: { currency_code: "USD" },
      metrics: { cost_micros: "1500000", impressions: "1000", clicks: "42" },
      segments: { date: "2026-08-20" },
    });
    assert.equal(row.metrics_cost, 1.5);
    assert.equal(row.campaign_id, 123);
    assert.equal(row.campaign_name, "Brand");
    assert.equal(row.campaign_status, "ENABLED");
    assert.equal(row.customer_currency_code, "USD");
    assert.equal(row.metrics_impressions, 1000);
    assert.equal(row.metrics_clicks, 42);
    assert.equal(row.segments_date, "2026-08-20");
  });

  it("treats average_cpc as micros and converts once", () => {
    const row = normalizeGoogleAdsRow({ metrics: { average_cpc: "750000" } });
    assert.equal(row.metrics_average_cpc, 0.75);
  });

  it("does not convert non-micros metrics like ctr", () => {
    const row = normalizeGoogleAdsRow({ metrics: { ctr: "0.1234", conversions: "3.5" } });
    assert.equal(row.metrics_ctr, "0.1234");
    assert.equal(row.metrics_conversions, "3.5");
  });

  it("skips null sections instead of producing undefined keys", () => {
    const row = normalizeGoogleAdsRow({ campaign: null as any, metrics: { clicks: "1" } });
    assert.deepEqual(Object.keys(row), ["metrics_clicks"]);
  });

  // ── searchStream: headers, ids, pagination batches ────────────────────────

  it("strips dashes from customer id, injects developer token, and sets login-customer-id for MCC", async () => {
    const restore = stubFetch([{ results: [] }]);
    try {
      await googleAdsReportClient.searchStream("access-token", "123-456-7890", "SELECT campaign.id FROM campaign", "999-999-9999");
    } finally {
      restore();
    }
    const { url, init } = captured[0];
    assert.ok(url.includes("/customers/1234567890/googleAds:searchStream"), url);
    const headers = init.headers as Record<string, string>;
    assert.equal(headers["developer-token"], "test-developer-token-VALUE");
    assert.equal(headers["login-customer-id"], "9999999999");
    assert.equal(headers.Authorization, "Bearer access-token");
    assert.ok(!url.includes("999"));
  });

  it("omits login-customer-id for standalone accounts without an MCC", async () => {
    const restore = stubFetch([{ results: [] }]);
    try {
      await googleAdsReportClient.searchStream("access-token", "1112223333", "SELECT campaign.id FROM campaign");
    } finally {
      restore();
    }
    const headers = captured[0].init.headers as Record<string, string>;
    assert.equal(headers["login-customer-id"], undefined);
  });

  it("returns empty rows when SearchStream has no result batches", async () => {
    const restore = stubFetch([{ fieldMask: "campaign.id" }]);
    try {
      const rows = await googleAdsReportClient.searchStream("t", "1112223333", "SELECT campaign.id FROM campaign");
      assert.deepEqual(rows, []);
    } finally {
      restore();
    }
  });

  it("merges multiple streamed batches into one normalized set", async () => {
    // SearchStream returns ONE response whose body is an array of batches.
    const restore = stubFetch([
      [
        { results: [{ campaign: { name: "A" }, metrics: { costMicros: "1000000" } }] },
        { results: [{ campaign: { name: "B" }, metrics: { costMicros: "2000000" } }] },
      ],
    ]);
    try {
      const rows = await googleAdsReportClient.searchStream("t", "1112223333", "SELECT campaign.name FROM campaign");
      assert.equal(rows.length, 2);
      assert.equal(rows.length, 2);
      assert.equal(rows[0].metrics_cost, 1);
      assert.equal(rows[1].metrics_cost, 2);
    } finally {
      restore();
    }
  });

  it("builds BETWEEN clause from explicit dates and DURING from presets", async () => {
    const restore = stubFetch([{ results: [] }, { results: [] }]);
    try {
      await googleAdsReportClient.getCampaignPerformance("t", "1112223333", "BETWEEN '2026-08-01' AND '2026-08-07'", "9999999999");
      await googleAdsReportClient.getCampaignPerformance("t", "1112223333", "LAST_30_DAYS");
      const q1 = JSON.parse(captured[0].init.body as string).query as string;
      const q2 = JSON.parse(captured[1].init.body as string).query as string;
      assert.match(q1, /segments\.date BETWEEN '2026-08-01' AND '2026-08-07'/);
      assert.match(q2, /segments\.date DURING LAST_30_DAYS/);
      assert.match(q1, /campaign\.status != 'REMOVED'/);
    } finally {
      restore();
    }
  });

  it("only references GAQL fields that exist (regression: metrics.conversions_value)", async () => {
    // 2026-08-24 live validation: metrics.conversion_value (singular) is not a
    // GAQL field — every reachable account failed with UNRECOGNIZED_FIELD.
    const restore = stubFetch([{ results: [] }, { results: [] }]);
    try {
      await googleAdsReportClient.getCampaignPerformance("t", "1112223333", "LAST_7_DAYS");
      await googleAdsReportClient.getShoppingPerformance("t", "1112223333", "LAST_7_DAYS");
      const qCampaign = JSON.parse(captured[0].init.body as string).query as string;
      const qShopping = JSON.parse(captured[1].init.body as string).query as string;
      for (const q of [qCampaign, qShopping]) {
        assert.ok(q.includes("metrics.conversions_value"), "must use metrics.conversions_value");
        assert.ok(!/metrics\.conversion_value\b/.test(q), "metrics.conversion_value is not a GAQL field");
      }
      assert.match(qCampaign, /metrics\.all_conversions/);
    } finally {
      restore();
    }
  });

  // ── Errors: classification, retry, redaction ───────────────────────────────

  it("classifies DEVELOPER_TOKEN_NOT_APPROVED structurally and by legacy text", () => {
    const structured = new GoogleAdsProviderError("dev token issue", false, 403, GOOGLE_ADS_DEVELOPER_TOKEN_NOT_APPROVED);
    assert.equal(isGoogleAdsDeveloperTokenBlocked(structured), true);
    const legacy = new Error("wrapped: DEVELOPER_TOKEN_NOT_APPROVED somewhere");
    assert.equal(isGoogleAdsDeveloperTokenBlocked(legacy), true);
    assert.equal(isGoogleAdsDeveloperTokenBlocked(new Error("unrelated")), false);
  });

  it("retry matrix: 429/5xx/quota retryable, 400 permission permanent", () => {
    assert.equal(isGoogleAdsRetryableFailure(429, ""), true);
    assert.equal(isGoogleAdsRetryableFailure(503, ""), true);
    assert.equal(isGoogleAdsRetryableFailure(400, "RESOURCE_EXHAUSTED-ish"), true);
    assert.equal(isGoogleAdsRetryableFailure(400, "User doesn't have permission"), false);
    assert.equal(isGoogleAdsRetryableFailure(403, "PERMISSION_DENIED"), false);
  });

  it("surfaces DEVELOPER_TOKEN_NOT_APPROVED permanently on first response (no silent retry)", async () => {
    const restore = stubFetch([
      { __status: 403, __body: JSON.stringify({ error: { message: "Developer token is not approved.", code: 3, details: [{ DEVELOPER_TOKEN_NOT_APPROVED: true }] } }) },
    ]);
    try {
      await assert.rejects(
        () => googleAdsReportClient.searchStream("t", "1112223333", "SELECT campaign.id FROM campaign"),
        (e: unknown) => e instanceof GoogleAdsProviderError && isGoogleAdsDeveloperTokenBlocked(e),
      );
    } finally {
      restore();
    }
  });

  it("exhausts bounded retries then throws the last provider error", async () => {
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: "internal error" } }), { status: 500 });
    }) as typeof fetch;
    try {
      await assert.rejects(
        () => googleAdsOAuthClient.listAccessibleCustomers("t"),
        (e: unknown) => e instanceof GoogleAdsProviderError && e.retryable === true,
      );
      assert.ok(calls >= 2 && calls <= 4, `expected bounded retries, got ${calls}`);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("never leaks the developer-token value through thrown error text", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const sent = (init?.headers as Record<string, string>)?.["developer-token"] ?? "";
      // Simulate a hostile echo of whatever was sent.
      return new Response(JSON.stringify({ error: { message: `Rejected request ${sent}` } }), { status: 400 });
    }) as typeof fetch;
    try {
      await assert.rejects(() => googleAdsOAuthClient.listAccessibleCustomers("t"));
      try {
        await googleAdsOAuthClient.listAccessibleCustomers("t");
      } catch (e: any) {
        assert.ok(!String(e.message).includes("test-developer-token-VALUE"), "token leaked in error text");
      }
    } finally {
      globalThis.fetch = original;
    }
  });

  // ── Discovery: MCC hierarchy and standalone fallback ──────────────────────

  it("excludes manager accounts and maps the root MCC as login id", async () => {
    const restore = stubFetch([
      {
        results: [
          { customerClient: { id: "111", descriptiveName: "Leaf A", manager: false, status: "ENABLED" } },
          { customerClient: { id: "222", descriptiveName: "Child Manager", manager: true, status: "ENABLED" } },
          { customerClient: { id: "333", descriptiveName: "Cancelled", manager: false, status: "CANCELLED" } },
        ],
      },
    ]);
    try {
      const clients = await googleAdsReportClient.listCustomerClients("t", "9999999999");
      // Defend against unexpected provider rows as well as the GAQL filter.
      assert.deepEqual(clients.map((c) => c.customerId), ["111"]);
      assert.ok(clients.every((c) => c.mccId === "9999999999" && !c.isManager));
    } finally {
      restore();
    }
  });

  it("skips manager roots that have no syncable leaf children (REQUESTED_METRICS_FOR_MANAGER guard)", async () => {
    // Live finding 2026-08-24: a manager account selected for sync produced
    // 400 REQUESTED_METRICS_FOR_MANAGER because the zero-leaf fallback
    // fabricated a self-leaf. A SUCCESSFUL customer_client query means the
    // root is a manager — zero leaves must now yield an empty set.
    const restore = stubFetch([
      {
        results: [
          { customerClient: { id: "777", descriptiveName: "Nested Manager", manager: true, status: "ENABLED" } },
        ],
      },
    ]);
    try {
      const clients = await googleAdsReportClient.listCustomerClients("t", "5902904696");
      assert.deepEqual(clients, [], "manager with no leaf children must not become a sync target");
    } finally {
      restore();
    }
  });

  it("falls back to treating a non-MCC account as its own leaf", async () => {
    const restore = stubFetch([{ __status: 400, __body: JSON.stringify({ error: { message: "not a manager" } }) }]);
    try {
      const clients = await googleAdsReportClient.listCustomerClients("t", "1112223333");
      assert.deepEqual(clients, [{ customerId: "1112223333", mccId: "1112223333", isManager: false, descriptiveName: "Customer 1112223333" }]);
    } finally {
      restore();
    }
  });

  it("excludes a deactivated customer instead of fabricating a standalone leaf", async () => {
    const restore = stubFetch([{ __status: 403, __body: JSON.stringify({ error: { message: "The customer account can't be accessed because it is not yet enabled or has been deactivated.", details: [{ errors: [{ errorCode: { authorizationError: "CUSTOMER_NOT_ENABLED" } }] }] } }) }]);
    try {
      const clients = await googleAdsReportClient.listCustomerClients("t", "1112223333");
      assert.deepEqual(clients, []);
      await assert.rejects(
        () => googleAdsReportClient.searchStream("t", "1112223333", "SELECT campaign.id FROM campaign"),
        (error: unknown) => isGoogleAdsCustomerUnavailable(error),
      );
    } finally {
      restore();
    }
  });

  it("keeps only roots that resolve to at least one enabled leaf", async () => {
    const restore = stubFetch([
      { results: [{ customerClient: { id: "111", descriptiveName: "Enabled leaf", manager: false, status: "ENABLED" } }] },
      { __status: 403, __body: JSON.stringify({ error: { message: "CUSTOMER_NOT_ENABLED" } }) },
      { results: [{ customerClient: { id: "333", descriptiveName: "Manager only", manager: true, status: "ENABLED" } }] },
    ]);
    try {
      const result = await googleAdsReportClient.resolveEligibleCustomerRoots("t", ["100", "200", "300"]);
      assert.deepEqual(result, {
        eligibleCustomerIds: ["100"],
        excludedCustomerIds: ["200", "300"],
        roots: [{ rootCustomerId: "100", isManager: true, customerIds: ["111"] }],
      });
    } finally {
      restore();
    }
  });

  it("keeps distinct MCC roots while suppressing children already covered by an MCC", async () => {
    const restore = stubFetch([
      { results: [{ customerClient: { id: "901", descriptiveName: "MCC child", manager: false, status: "ENABLED" } }] },
      { __status: 400, __body: JSON.stringify({ error: { message: "not a manager" } }) },
      { __status: 400, __body: JSON.stringify({ error: { message: "not a manager" } }) },
    ]);
    try {
      const result = await googleAdsReportClient.resolveEligibleCustomerRoots("t", ["900", "901", "777"]);
      assert.deepEqual(result, {
        eligibleCustomerIds: ["900", "777"],
        excludedCustomerIds: [],
        roots: [
          { rootCustomerId: "900", isManager: true, customerIds: ["901"] },
          { rootCustomerId: "777", isManager: false, customerIds: ["777"] },
        ],
      });
    } finally {
      restore();
    }
  });

  it("listAccessibleCustomers extracts numeric ids from resource names", async () => {
    const restore = stubFetch([{ resourceNames: ["customers/1234567890", "customers/9876543210"] }]);
    try {
      const ids = await googleAdsOAuthClient.listAccessibleCustomers("t");
      assert.deepEqual(ids, ["1234567890", "9876543210"]);
    } finally {
      restore();
    }
  });

  it("requires the developer token for discovery (missing config is loud)", async () => {
    const saved = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    const restore = stubFetch([]);
    try {
      await assert.rejects(
        () => googleAdsOAuthClient.listAccessibleCustomers("t"),
        /GOOGLE_ADS_DEVELOPER_TOKEN not configured/,
      );
    } finally {
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN = saved;
      restore();
    }
  });
});
