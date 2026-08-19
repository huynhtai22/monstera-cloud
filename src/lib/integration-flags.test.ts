import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  isAmazonConnectEnabled,
  isConnectEnabled,
  isLazadaConnectEnabled,
  isMetaAdsConnectEnabled,
  isPilotCertifiedProvider,
  isShopifyConnectEnabled,
  isTikTokShopConnectEnabled,
} from "./integration-flags";

const tracked = [
  "META_ADS_CONNECT_ENABLED",
  "TIKTOK_SHOP_CONNECT_ENABLED",
  "SHOPIFY_CONNECT_ENABLED",
  "AMAZON_CONNECT_ENABLED",
  "LAZADA_CONNECT_ENABLED",
] as const;

const original = Object.fromEntries(tracked.map((key) => [key, process.env[key]]));

function clearTracked() {
  for (const key of tracked) delete process.env[key];
}

afterEach(() => {
  for (const key of tracked) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("integration connect flags", () => {
  it("treats Meta/Google/TikTok Ads/Shopee as certified and uncertified shops as not", () => {
    assert.equal(isPilotCertifiedProvider("meta_ads"), true);
    assert.equal(isPilotCertifiedProvider("google_ads"), true);
    assert.equal(isPilotCertifiedProvider("tiktok_business"), true);
    assert.equal(isPilotCertifiedProvider("shopee"), true);
    assert.equal(isPilotCertifiedProvider("lazada"), false);
    assert.equal(isPilotCertifiedProvider("amazon"), false);
    assert.equal(isPilotCertifiedProvider("shopify"), false);
    assert.equal(isPilotCertifiedProvider("tiktok_shop"), false);
  });

  it("defaults certified connectors on and uncertified connectors off", () => {
    clearTracked();
    assert.equal(isMetaAdsConnectEnabled(), true);
    assert.equal(isTikTokShopConnectEnabled(), false);
    assert.equal(isShopifyConnectEnabled(), false);
    assert.equal(isAmazonConnectEnabled(), false);
    assert.equal(isLazadaConnectEnabled(), false);
    assert.equal(isConnectEnabled("amazon"), false);
    assert.equal(isConnectEnabled("unknown_provider"), false);
  });

  it("requires an explicit truthy flag to show an uncertified connector", () => {
    clearTracked();
    process.env.AMAZON_CONNECT_ENABLED = "true";
    assert.equal(isAmazonConnectEnabled(), true);
    process.env.AMAZON_CONNECT_ENABLED = "false";
    assert.equal(isAmazonConnectEnabled(), false);
  });
});
