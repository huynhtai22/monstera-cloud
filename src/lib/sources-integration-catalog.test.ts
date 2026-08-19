import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSourceEnvReady, visibleSourcesCatalog } from "./sources-integration-catalog";

describe("visible source catalog", () => {
  it("hides uncertified connectors until the public config explicitly enables them", () => {
    assert.equal(isSourceEnvReady("amazon", undefined), false);
    assert.equal(isSourceEnvReady("lazada", undefined), false);
    assert.equal(isSourceEnvReady("shopify", {}), false);
    assert.equal(isSourceEnvReady("tiktok_shop", { tiktokShop: false }), false);

    const hidden = visibleSourcesCatalog({
      metaAds: true,
      googleAds: true,
      tiktokBusiness: true,
      shopee: true,
    });
    assert.deepEqual(
      hidden.map((item) => item.id),
      ["meta_ads", "google_ads", "tiktok_business", "shopee"],
    );

    const withAmazon = visibleSourcesCatalog({
      metaAds: true,
      googleAds: true,
      tiktokBusiness: true,
      shopee: true,
      amazon: true,
    });
    assert.equal(withAmazon.some((item) => item.id === "amazon"), true);
  });

  it("still lists certified connectors when the workspace allowlist includes them", () => {
    const listed = visibleSourcesCatalog(
      { metaAds: true, googleAds: false, tiktokBusiness: true, shopee: true },
      ["meta_ads", "tiktok_business"],
    );
    assert.deepEqual(
      listed.map((item) => item.id),
      ["meta_ads", "tiktok_business"],
    );
  });
});
