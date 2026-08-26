import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ShopeeAdsClient, ShopeeClient, ShopeeDataClient, chunkDateRangeIntoMonths } from "./shopee";
import { ShopeeOAuthAdapter } from "./oauth-framework/providers/shopee";
import { assertShopeeRegionEligible, isShopeeRegionEligible } from "./provider-market-policy";
import { getShopeeEnvironments, getShopeeActiveConfig, SHOPEE_CANONICAL_REDIRECT_URL, SHOPEE_SANDBOX_OPEN_API_HOST } from "./shopee-env";

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
        redirectUri: "https://monsteracloud.com/api/auth/callback?provider=shopee",
        metadata: { workspaceId: "ws_test", userId: "usr_test" },
      }),
      /missing shop_id/
    );
  });

  it("configures explicit sandbox and production environments", () => {
    process.env.SHOPEE_TEST_PARTNER_ID = "2009876";
    process.env.SHOPEE_TEST_PARTNER_KEY = "test_shpk_sandbox_secret_123456";
    process.env.SHOPEE_LIVE_PARTNER_ID = "1001234";
    process.env.SHOPEE_LIVE_PARTNER_KEY = "live_shpk_prod_secret_789012";

    const envs = getShopeeEnvironments();
    assert.equal(envs.sandbox.apiBaseUrl, SHOPEE_SANDBOX_OPEN_API_HOST);
    assert.equal(envs.sandbox.partnerId, "2009876");
    assert.equal(envs.sandbox.partnerKey, "test_shpk_sandbox_secret_123456");
    assert.equal(envs.sandbox.redirectUrl, SHOPEE_CANONICAL_REDIRECT_URL);

    assert.equal(envs.production.apiBaseUrl, "https://partner.shopeemobile.com");
    assert.equal(envs.production.partnerId, "1001234");
    assert.equal(envs.production.partnerKey, "live_shpk_prod_secret_789012");
    assert.equal(envs.production.redirectUrl, SHOPEE_CANONICAL_REDIRECT_URL);

    const sbActive = getShopeeActiveConfig(true);
    assert.equal(sbActive.apiBaseUrl, SHOPEE_SANDBOX_OPEN_API_HOST);
    assert.equal(sbActive.partnerId, "2009876");
    assert.equal(sbActive.isSandbox, true);

    const prodActive = getShopeeActiveConfig(false);
    assert.equal(prodActive.apiBaseUrl, "https://partner.shopeemobile.com");
    assert.equal(prodActive.partnerId, "1001234");
    assert.equal(prodActive.isSandbox, false);
  });

  it("generates signed Shopee sandbox authorization URL for Vietnam Local Shop", () => {
    process.env.SHOPEE_TEST_PARTNER_ID = "2009876";
    process.env.SHOPEE_TEST_PARTNER_KEY = "test_shpk_sandbox_secret_123456";

    const client = new ShopeeClient();
    const authUrl = client.getAuthorizeUrl(
      SHOPEE_CANONICAL_REDIRECT_URL,
      "ws_vietnam_local_shop",
      true
    );

    assert.ok(authUrl.startsWith("https://openplatform.sandbox.test-stable.shopee.sg/api/v2/shop/auth_partner?"));
    assert.ok(authUrl.includes("partner_id=2009876"));
    assert.ok(authUrl.includes("redirect=https%3A%2F%2Fmonsteracloud.com%2Fapi%2Fauth%2Fcallback%3Fprovider%3Dshopee"));
    assert.ok(authUrl.includes("sign="));
    assert.ok(authUrl.includes("timestamp="));
    assert.ok(authUrl.includes("state=ws_vietnam_local_shop"));
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
