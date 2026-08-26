import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  tiktokGmvMaxClient,
  GMV_MAX_PRODUCT_DIMENSIONS,
  GMV_MAX_LIVE_DIMENSIONS,
  GMV_MAX_METRICS,
  GMV_MAX_ATTRIBUTION_DISCLAIMER,
} from "./tiktok-gmv-max";
import { syncTikTokGmvMaxWarehouseMetrics } from "./sync-tiktok-gmv-max";
import prisma from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

async function withMockedFetch<T>(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  run: () => Promise<T>
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("TikTok GMV Max Reporting Client & Invariants", () => {
  it("chunkDateRange: splits date intervals into safe <=14-day slices", () => {
    const singleSlice = tiktokGmvMaxClient.chunkDateRange("2026-08-01", "2026-08-10", 14);
    assert.equal(singleSlice.length, 1);
    assert.deepEqual(singleSlice[0], { start: "2026-08-01", end: "2026-08-10" });

    const multiSlice = tiktokGmvMaxClient.chunkDateRange("2026-07-01", "2026-08-15", 14);
    assert.equal(multiSlice.length, 4);
    assert.equal(multiSlice[0].start, "2026-07-01");
    assert.equal(multiSlice[0].end, "2026-07-14");
    assert.equal(multiSlice[1].start, "2026-07-15");
    assert.equal(multiSlice[1].end, "2026-07-28");
    assert.equal(multiSlice[2].start, "2026-07-29");
    assert.equal(multiSlice[2].end, "2026-08-11");
    assert.equal(multiSlice[3].start, "2026-08-12");
    assert.equal(multiSlice[3].end, "2026-08-15");
  });

  it("dimensions & metrics: enforces clean separation between PRODUCT and LIVE", () => {
    // PRODUCT must contain item_id, never live_room_id
    assert.ok(GMV_MAX_PRODUCT_DIMENSIONS.includes("item_id"));
    assert.ok(!GMV_MAX_PRODUCT_DIMENSIONS.includes("live_room_id" as any));

    // LIVE must contain live_room_id, never item_id
    assert.ok(GMV_MAX_LIVE_DIMENSIONS.includes("live_room_id"));
    assert.ok(!GMV_MAX_LIVE_DIMENSIONS.includes("item_id" as any));

    // Metrics must only contain official verified GMV Max metrics
    assert.deepEqual(
      [...GMV_MAX_METRICS],
      ["gmv_max_cost", "gmv_max_gross_revenue", "gmv_max_orders", "gmv_max_roi"]
    );
  });

  it("attribution disclaimer: clearly explains 1-day blended attribution", () => {
    assert.ok(GMV_MAX_ATTRIBUTION_DISCLAIMER.includes("1-day blended attribution"));
    assert.ok(GMV_MAX_ATTRIBUTION_DISCLAIMER.includes("paid + organic + affiliate"));
    assert.ok(GMV_MAX_ATTRIBUTION_DISCLAIMER.includes("Do not compare with standard ad ROAS"));
  });

  it("fetches PRODUCT GMV Max with item_id dimension and sends campaign_type", async () => {
    const recordedUrls: string[] = [];

    const mockResponse = new Response(
      JSON.stringify({
        code: 0,
        message: "OK",
        data: {
          list: [
            {
              dimensions: {
                stat_time_day: "2026-08-01",
                campaign_id: "camp_prod_123",
                campaign_name: "GMV Max Product Campaign",
                store_id: "store_vn_999",
                item_id: "item_sku_555",
                item_name: "Test Product SKU",
              },
              metrics: {
                gmv_max_cost: "120.50",
                gmv_max_gross_revenue: "482.00",
                gmv_max_orders: "10",
                gmv_max_roi: "4.0",
              },
            },
          ],
          page_info: { page: 1, page_size: 100, total_page: 1, total_number: 1 },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    const rows = await withMockedFetch(
      (url) => {
        recordedUrls.push(url);
        return mockResponse;
      },
      async () => {
        return tiktokGmvMaxClient.getReport(
          "test_token_123",
          {
            advertiser_id: "adv_123",
            store_ids: ["store_vn_999"],
            start_date: "2026-08-01",
            end_date: "2026-08-05",
            campaign_type: "PRODUCT",
          },
          true
        );
      }
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].dimensions.item_id, "item_sku_555");
    assert.equal(rows[0].metrics.gmv_max_roi, "4.0");

    assert.ok(recordedUrls.length >= 1);
    const parsedUrl = new URL(recordedUrls[0]);
    assert.equal(parsedUrl.origin, "https://sandbox-ads.tiktok.com");
    assert.equal(parsedUrl.searchParams.get("campaign_type"), "PRODUCT");
    const dims = JSON.parse(parsedUrl.searchParams.get("dimensions") || "[]");
    assert.ok(dims.includes("item_id"));
    assert.ok(!dims.includes("live_room_id"));
  });

  it("fetches LIVE GMV Max with live_room_id dimension, never item_id", async () => {
    const recordedUrls: string[] = [];

    const mockResponse = new Response(
      JSON.stringify({
        code: 0,
        message: "OK",
        data: {
          list: [
            {
              dimensions: {
                stat_time_day: "2026-08-01",
                campaign_id: "camp_live_456",
                campaign_name: "GMV Max Livestream Campaign",
                store_id: "store_vn_999",
                live_room_id: "room_live_777",
                room_title: "Flash Mega Live Session",
              },
              metrics: {
                gmv_max_cost: "300.00",
                gmv_max_gross_revenue: "1500.00",
                gmv_max_orders: "45",
                gmv_max_roi: "5.0",
              },
            },
          ],
          page_info: { page: 1, page_size: 100, total_page: 1, total_number: 1 },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    const rows = await withMockedFetch(
      (url) => {
        recordedUrls.push(url);
        return mockResponse;
      },
      async () => {
        return tiktokGmvMaxClient.getReport(
          "test_token_123",
          {
            advertiser_id: "adv_123",
            store_ids: ["store_vn_999"],
            start_date: "2026-08-01",
            end_date: "2026-08-05",
            campaign_type: "LIVE",
          },
          true
        );
      }
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].dimensions.live_room_id, "room_live_777");
    assert.equal(rows[0].dimensions.item_id, undefined);
    assert.equal(rows[0].metrics.gmv_max_roi, "5.0");

    assert.ok(recordedUrls.length >= 1);
    const parsedUrl = new URL(recordedUrls[0]);
    assert.equal(parsedUrl.origin, "https://sandbox-ads.tiktok.com");
    assert.equal(parsedUrl.searchParams.get("campaign_type"), "LIVE_STREAM");
    const dims = JSON.parse(parsedUrl.searchParams.get("dimensions") || "[]");
    assert.ok(dims.includes("live_room_id"));
    assert.ok(!dims.includes("item_id"));
  });

  it("proves isolation: worker runs PRODUCT + LIVE, upserts TikTokGmvMaxMetric, and leaves CampaignMetric untouched", async () => {
    let gmvMaxUpserts = 0;
    let campaignMetricUpserts = 0;

    const originalFindUnique = prisma.connection.findUnique;
    const originalGmvUpsert = prisma.tikTokGmvMaxMetric.upsert;
    const originalCampaignUpsert = prisma.campaignMetric.upsert;

    (prisma.connection as any).findUnique = async () => ({
      id: "conn_test_gmv_123",
      workspaceId: "ws_test_gmv_123",
      remoteAccountId: "adv_tiktok_999",
      credentials: encrypt(
        JSON.stringify({
          accessToken: "mock_test_token",
          advertiserIds: ["adv_tiktok_999"],
          storeIds: ["store_vn_888"],
          sandbox: true,
        })
      ),
    });

    (prisma.tikTokGmvMaxMetric as any).upsert = async () => {
      gmvMaxUpserts++;
      return {} as any;
    };

    (prisma.campaignMetric as any).upsert = async () => {
      campaignMetricUpserts++;
      return {} as any;
    };

    const mockResponseHandler = (url: string) => {
      const parsed = new URL(url);
      const isLive = parsed.searchParams.get("campaign_type") === "LIVE_STREAM";

      const list = isLive
        ? [
            {
              dimensions: {
                stat_time_day: "2026-08-01",
                campaign_id: "camp_live_101",
                store_id: "store_vn_888",
                live_room_id: "live_room_202",
              },
              metrics: {
                gmv_max_cost: 50,
                gmv_max_gross_revenue: 250,
                gmv_max_orders: 10,
                gmv_max_roi: 5,
              },
            },
          ]
        : [
            {
              dimensions: {
                stat_time_day: "2026-08-01",
                campaign_id: "camp_prod_101",
                store_id: "store_vn_888",
                item_id: "sku_item_303",
              },
              metrics: {
                gmv_max_cost: 100,
                gmv_max_gross_revenue: 400,
                gmv_max_orders: 20,
                gmv_max_roi: 4,
              },
            },
          ];

      return new Response(
        JSON.stringify({
          code: 0,
          message: "OK",
          data: { list, page_info: { page: 1, page_size: 100, total_page: 1, total_number: 1 } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    try {
      const result = await withMockedFetch(mockResponseHandler, async () => {
        return syncTikTokGmvMaxWarehouseMetrics({
          connectionId: "conn_test_gmv_123",
          workspaceId: "ws_test_gmv_123",
          userPlan: "growth",
          since: "2026-08-01",
          until: "2026-08-02",
        });
      });

      assert.equal(result.success, true);
      assert.equal(result.rowsIngested, 2);
      assert.equal(gmvMaxUpserts, 2);
      assert.equal(campaignMetricUpserts, 0, "CampaignMetric MUST NEVER be modified by GMV Max sync!");
    } finally {
      (prisma.connection as any).findUnique = originalFindUnique;
      (prisma.tikTokGmvMaxMetric as any).upsert = originalGmvUpsert;
      (prisma.campaignMetric as any).upsert = originalCampaignUpsert;
    }
  });
});
