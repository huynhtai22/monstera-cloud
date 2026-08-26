import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { shopeeAdsClient } from "@/lib/shopee";
import { shopeeProductUpdateWindow } from "@/lib/sync-shopee-catalog-warehouse";
import { splitShopeeAdsDateRange } from "@/lib/sync-shopee-ads-warehouse";

describe("Shopee catalog discovery", () => {
  const originalFetch = globalThis.fetch;
  const originalPartnerId = process.env.SHOPEE_PARTNER_ID;
  const originalPartnerKey = process.env.SHOPEE_PARTNER_KEY;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalPartnerId === undefined) delete process.env.SHOPEE_PARTNER_ID;
    else process.env.SHOPEE_PARTNER_ID = originalPartnerId;
    if (originalPartnerKey === undefined) delete process.env.SHOPEE_PARTNER_KEY;
    else process.env.SHOPEE_PARTNER_KEY = originalPartnerKey;
  });

  it("retrieves campaign 210343 through complete offset pagination", async () => {
    process.env.SHOPEE_PARTNER_ID = "850001";
    process.env.SHOPEE_PARTNER_KEY = "sanitized-test-key";
    const offsets: string[] = [];
    globalThis.fetch = (async (url) => {
      const parsed = new URL(String(url));
      offsets.push(parsed.searchParams.get("offset") ?? "");
      const first = offsets.length === 1;
      return new Response(JSON.stringify({
        error: "",
        response: {
          shop_id: 227420569,
          region: "VN",
          has_next_page: first,
          campaign_list: first ? [{ campaign_id: 210343, ad_type: "manual" }] : [{ campaign_id: 210344, ad_type: "auto" }],
        },
      }), { status: 200 });
    }) as typeof fetch;

    const pages = await shopeeAdsClient.getAllProductLevelCampaignIds({ accessToken: "test-token", shopId: 227420569, sandbox: true });
    assert.equal(pages.length, 2);
    assert.deepEqual(offsets, ["0", "1"]);
    const first = pages[0] as { campaign_list?: Array<{ campaign_id: number; ad_type: string }> };
    assert.deepEqual(first.campaign_list?.[0], { campaign_id: 210343, ad_type: "manual" });
  });

  it("uses no restrictive product timestamp on the initial catalog sync", () => {
    const window = shopeeProductUpdateWindow(null, new Date("2026-08-27T00:00:00.000Z"));
    assert.equal(window.updateTimeFrom, undefined);
    assert.equal(window.updateTimeTo, 1787788800);
  });

  it("overlaps the persisted product watermark on incremental sync", () => {
    const window = shopeeProductUpdateWindow(new Date("2026-08-27T00:10:00.000Z"), new Date("2026-08-27T01:00:00.000Z"));
    assert.equal(window.updateTimeFrom, 1787789100);
    assert.equal(window.updateTimeTo, 1787792400);
  });

  it("splits long Ads windows into conservative Shopee-safe requests", () => {
    const ranges = splitShopeeAdsDateRange("2026-07-27", "2026-08-27");
    assert.deepEqual(ranges, [
      { since: "2026-07-27", until: "2026-08-23" },
      { since: "2026-08-24", until: "2026-08-27" },
    ]);
  });
});
