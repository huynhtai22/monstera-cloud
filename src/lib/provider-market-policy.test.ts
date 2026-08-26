import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROVIDER_MARKET_POLICIES,
  isShopeeRegionEligible,
  assertShopeeRegionEligible,
} from "./provider-market-policy";

describe("provider-market-policy", () => {
  it("defines explicit VN-only policies for Shopee Ads", () => {
    assert.deepEqual(PROVIDER_MARKET_POLICIES.shopee.ads_reporting, ["VN"]);
    assert.deepEqual(PROVIDER_MARKET_POLICIES.shopee.product_campaign_reporting, ["VN"]);
    assert.deepEqual(PROVIDER_MARKET_POLICIES.shopee.keyword_settings, ["VN"]);
  });

  it("isShopeeRegionEligible accepts VN in any case and rejects other markets", () => {
    assert.equal(isShopeeRegionEligible("VN"), true);
    assert.equal(isShopeeRegionEligible("vn"), true);
    assert.equal(isShopeeRegionEligible(" VN "), true);

    assert.equal(isShopeeRegionEligible("SG"), false);
    assert.equal(isShopeeRegionEligible("MY"), false);
    assert.equal(isShopeeRegionEligible("TH"), false);
    assert.equal(isShopeeRegionEligible("ID"), false);
    assert.equal(isShopeeRegionEligible("PH"), false);
    assert.equal(isShopeeRegionEligible("BR"), false);
    assert.equal(isShopeeRegionEligible(null), false);
    assert.equal(isShopeeRegionEligible(undefined), false);
    assert.equal(isShopeeRegionEligible(""), false);
  });

  it("assertShopeeRegionEligible passes for VN and throws descriptive error for others", () => {
    assert.doesNotThrow(() => assertShopeeRegionEligible("VN", "ads_reporting"));
    assert.doesNotThrow(() => assertShopeeRegionEligible("vn", "product_campaign_reporting"));

    assert.throws(
      () => assertShopeeRegionEligible("TH", "ads_reporting"),
      /restricted to \[VN\] shops. Authoritative shop region is 'TH'/
    );
    assert.throws(
      () => assertShopeeRegionEligible(null, "keyword_settings"),
      /restricted to \[VN\] shops. Authoritative shop region is 'UNKNOWN'/
    );
  });
});
