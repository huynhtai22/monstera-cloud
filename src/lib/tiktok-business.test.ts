import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TikTokBusinessClient, TikTokReportClient } from "./tiktok-business";

describe("TikTok for Business OAuth & Report Parsing", () => {
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
});
