import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TikTokBusinessClient,
  TikTokProviderError,
  TikTokReportClient,
  TIKTOK_CAMPAIGN_REPORT_DIMENSIONS,
  TIKTOK_CAMPAIGN_REPORT_METRICS,
} from "./tiktok-business";

async function withFastRetries<T>(run: () => Promise<T>): Promise<T> {
  const originalTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: (...args: unknown[]) => unknown, _delay?: number, ...args: unknown[]) => {
    handler(...args);
    return 0 as never;
  }) as unknown as typeof setTimeout;
  try {
    return await run();
  } finally {
    globalThis.setTimeout = originalTimeout;
  }
}

async function withMockedFetch<T>(responses: Response[], run: (calls: () => number) => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  let count = 0;
  globalThis.fetch = (async () => {
    count++;
    const response = responses.shift();
    if (!response) throw new Error("Unexpected TikTok request");
    return response;
  }) as typeof fetch;
  try {
    return await run(() => count);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("TikTok for Business OAuth & Report Parsing", () => {
  it("keeps campaign names out of TikTok campaign report dimensions", () => {
    assert.deepEqual(TIKTOK_CAMPAIGN_REPORT_DIMENSIONS, [
      "campaign_id",
      "stat_time_day",
    ]);
    assert.ok(TIKTOK_CAMPAIGN_REPORT_DIMENSIONS.length >= 1);
    assert.ok(TIKTOK_CAMPAIGN_REPORT_DIMENSIONS.length <= 4);
    assert.ok(TIKTOK_CAMPAIGN_REPORT_METRICS.includes("campaign_name"));
  });

  it("uses v1.3 campaign metrics and excludes TikTok-rejected legacy fields", () => {
    assert.deepEqual(TIKTOK_CAMPAIGN_REPORT_METRICS, [
      "campaign_name",
      "spend",
      "impressions",
      "clicks",
      "cpc",
      "ctr",
      "conversion",
    ]);
    assert.equal(TIKTOK_CAMPAIGN_REPORT_METRICS.includes("impression"), false);
    assert.equal(TIKTOK_CAMPAIGN_REPORT_METRICS.includes("click"), false);
    assert.equal(TIKTOK_CAMPAIGN_REPORT_METRICS.includes("revenue"), false);
    assert.equal(TIKTOK_CAMPAIGN_REPORT_METRICS.includes("roas"), false);
  });

  it("generates correct authorize URL with state and redirectUri", () => {
    process.env.TIKTOK_BUSINESS_APP_ID = "tiktok_test_app_123";
    const client = new TikTokBusinessClient();
    const { url } = client.getAuthorizeUrl("test_state_abc", "https://monsteracloud.com/api/auth/callback/tiktok-business");

    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://ads.tiktok.com");
    assert.equal(parsed.pathname, "/marketing_api/auth");
    assert.equal(parsed.searchParams.get("app_id"), "tiktok_test_app_123");
    assert.equal(parsed.searchParams.get("state"), "test_state_abc");
    assert.equal(parsed.searchParams.get("redirect_uri"), "https://monsteracloud.com/api/auth/callback/tiktok-business");
  });

  it("parses NDJSON formatted async report rows", () => {
    const reportClient = new TikTokReportClient();
    const ndjson = [
      JSON.stringify({
        dimensions: {
          campaign_id: "180123456789",
          campaign_name: "Summer Sale Campaign",
          stat_time_day: "2026-08-19",
        },
        metrics: {
          impression: "45000",
          click: "1200",
          spend: "350.50",
          cpc: "0.29",
          ctr: "0.026",
          conversion: "42",
          revenue: "2100.00",
          roas: "5.99",
        },
      }),
      JSON.stringify({
        dimensions: {
          campaign_id: "180123456790",
          campaign_name: "Retargeting Campaign",
          stat_time_day: "2026-08-19",
        },
        metrics: {
          impression: "15000",
          click: "600",
          spend: "180.00",
          cpc: "0.30",
          ctr: "0.040",
          conversion: "30",
          revenue: "1500.00",
          roas: "8.33",
        },
      }),
    ].join("\n");

    const parsedRows = reportClient.parseReportText(ndjson);
    assert.equal(parsedRows.length, 2);
    assert.equal(parsedRows[0].dimensions.campaign_id, "180123456789");
    assert.equal(parsedRows[0].dimensions.campaign_name, "Summer Sale Campaign");
    assert.equal(parsedRows[0].metrics.spend, "350.50");
    assert.equal(parsedRows[0].metrics.conversion, "42");
    assert.equal(parsedRows[1].dimensions.campaign_id, "180123456790");
    assert.equal(parsedRows[1].metrics.roas, "8.33");
  });

  it("parses CSV formatted async report rows", () => {
    const reportClient = new TikTokReportClient();
    const csv = [
      "campaign_id,campaign_name,adgroup_id,adgroup_name,stat_time_day,impression,click,spend,cpc,ctr,conversion,revenue,roas",
      "180123456789,Summer Sale,999,Group A,2026-08-19,10000,250,75.00,0.30,0.025,10,500.00,6.67",
    ].join("\n");

    const parsedRows = reportClient.parseReportText(csv);
    assert.equal(parsedRows.length, 1);
    assert.equal(parsedRows[0].dimensions.campaign_id, "180123456789");
    assert.equal(parsedRows[0].metrics.spend, "75.00");
    assert.equal(parsedRows[0].metrics.conversion, "10");
  });

  it("retries a report download 429 and surfaces a retryable error after exhaustion", async () => {
    await withFastRetries(() => withMockedFetch([
      new Response(JSON.stringify({ code: 429, message: "rate limit" }), { status: 429 }),
      new Response(JSON.stringify({ code: 429, message: "rate limit" }), { status: 429 }),
      new Response(JSON.stringify({ code: 429, message: "rate limit" }), { status: 429 }),
    ], async (calls) => {
      await assert.rejects(
        new TikTokReportClient().downloadRows("https://download.test/report"),
        (error: unknown) => error instanceof TikTokProviderError && error.retryable && error.status === 429,
      );
      assert.equal(calls(), 3);
    }));
  });

  it("retries a report download 503 and surfaces a retryable error after exhaustion", async () => {
    await withFastRetries(() => withMockedFetch([
      new Response(JSON.stringify({ code: 503, message: "temporarily unavailable" }), { status: 503 }),
      new Response(JSON.stringify({ code: 503, message: "temporarily unavailable" }), { status: 503 }),
      new Response(JSON.stringify({ code: 503, message: "temporarily unavailable" }), { status: 503 }),
    ], async (calls) => {
      await assert.rejects(
        new TikTokReportClient().downloadRows("https://download.test/report"),
        (error: unknown) => error instanceof TikTokProviderError && error.retryable && error.status === 503,
      );
      assert.equal(calls(), 3);
    }));
  });

  it("does not convert a sandbox quota response into a successful empty report", async () => {
    await withFastRetries(() => withMockedFetch([
      new Response(JSON.stringify({ code: 429, message: "rate limit" }), { status: 200 }),
      new Response(JSON.stringify({ code: 429, message: "rate limit" }), { status: 200 }),
      new Response(JSON.stringify({ code: 429, message: "rate limit" }), { status: 200 }),
    ], async (calls) => {
      await assert.rejects(
        new TikTokReportClient().getSyncReport("access", {
          advertiser_id: "advertiser-1",
          report_type: "BASIC",
          data_level: "AUCTION_CAMPAIGN",
          dimensions: ["campaign_id"],
          metrics: ["spend"],
          start_date: "2026-01-01",
          end_date: "2026-01-01",
        }),
        (error: unknown) => error instanceof TikTokProviderError && error.retryable,
      );
      assert.equal(calls(), 3);
    }));
  });
});
