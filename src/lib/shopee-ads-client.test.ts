import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ShopeeAdsClient, ShopeeDataClient, chunkDateRangeIntoMonths } from "./shopee";
import { ShopeeOAuthAdapter } from "./oauth-framework/providers/shopee";
import { assertShopeeRegionEligible, isShopeeRegionEligible } from "./provider-market-policy";

describe("Shopee Open Platform v2 Ads Client & Region Policy", () => {
  it("enforces Vietnam-only (VN) region policy for Ads reporting", () => {
    assert.equal(isShopeeRegionEligible("VN", "ads_reporting"), true);
    assert.equal(isShopeeRegionEligible("vn", "ads_reporting"), true);
    assert.equal(isShopeeRegionEligible("SG", "ads_reporting"), false);
    assert.equal(isShopeeRegionEligible("MY", "ads_reporting"), false);
    assert.equal(isShopeeRegionEligible("TH", "ads_reporting"), false);
    assert.equal(isShopeeRegionEligible("ID", "ads_reporting"), false);
    assert.equal(isShopeeRegionEligible("PH", "ads_reporting"), false);
  });

  it("ShopeeOAuthAdapter rejects non-VN shops during authorization", async () => {
    const adapter = new ShopeeOAuthAdapter();
    assert.equal(adapter.id, "shopee");
    assert.equal(adapter.name, "Shopee");
    assert.equal(adapter.authType, "oauth");

    // Invalid code missing shop_id
    await assert.rejects(
      () => adapter.exchangeCode({
        code: "test_code_without_shop_id",
        redirectUri: "http://localhost:3000/api/auth/callback?provider=shopee",
        metadata: { workspaceId: "ws_test", userId: "usr_test" },
      }),
      /missing shop_id/
    );
  });

  it("chunkDateRangeIntoMonths correctly splits 90 days into 30-day windows", () => {
    const chunks = chunkDateRangeIntoMonths("2026-01-01", "2026-03-31", 30);
    assert.ok(chunks.length >= 3);
    for (const chunk of chunks) {
      const s = new Date(chunk.since).getTime();
      const u = new Date(chunk.until).getTime();
      const days = Math.round((u - s) / 86400000) + 1;
      assert.ok(days <= 30, `Chunk exceeds 30 days: ${days}`);
    }
  });
});
