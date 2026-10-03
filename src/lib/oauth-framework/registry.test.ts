import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { isProviderConfigured, isProviderEnabled } from "./registry";

const trackedKeys = [
  "TIKTOK_BUSINESS_APP_ID",
  "TIKTOK_BUSINESS_APP_SECRET",
  "TIKTOK_BUSINESS_CLIENT_KEY",
  "TIKTOK_BUSINESS_CLIENT_SECRET",
  "AMAZON_CLIENT_ID",
  "AMAZON_CLIENT_SECRET",
  "AMAZON_LWA_CLIENT_ID",
  "AMAZON_LWA_CLIENT_SECRET",
  "AMAZON_CONNECT_ENABLED",
  "META_ADS_APP_ID",
  "META_ADS_APP_SECRET",
  "META_ADS_LOGIN_CONFIG_ID",
  "META_APP_ID",
  "META_APP_SECRET",
] as const;

const originalEnv = Object.fromEntries(
  trackedKeys.map((key) => [key, process.env[key]]),
);

function clearTrackedEnv() {
  for (const key of trackedKeys) {
    delete process.env[key];
  }
}

afterEach(() => {
  for (const key of trackedKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("OAuth provider configuration aliases", () => {
  it("treats documented TikTok Business CLIENT_* env names as configured", () => {
    clearTrackedEnv();
    assert.equal(isProviderConfigured("tiktok_business"), false);

    process.env.TIKTOK_BUSINESS_CLIENT_KEY = "tiktok-app-id";
    process.env.TIKTOK_BUSINESS_CLIENT_SECRET = "tiktok-app-secret";
    assert.equal(isProviderConfigured("tiktok_business"), true);
  });

  it("treats documented Amazon LWA_* env names as configured", () => {
    clearTrackedEnv();
    assert.equal(isProviderConfigured("amazon"), false);

    process.env.AMAZON_LWA_CLIENT_ID = "amzn-lwa-id";
    process.env.AMAZON_LWA_CLIENT_SECRET = "amzn-lwa-secret";
    assert.equal(isProviderConfigured("amazon"), true);
    assert.equal(isProviderEnabled("amazon"), false);
    process.env.AMAZON_CONNECT_ENABLED = "true";
    assert.equal(isProviderEnabled("amazon"), true);
  });

  it("requires META_ADS_LOGIN_CONFIG_ID to be present and strictly numeric for meta_ads", () => {
    clearTrackedEnv();
    assert.equal(isProviderConfigured("meta_ads"), false);

    process.env.META_ADS_APP_ID = "100000000000001";
    process.env.META_ADS_APP_SECRET = "synthetic-app-secret";
    delete process.env.META_ADS_LOGIN_CONFIG_ID;
    // Missing config ID must NOT be configured
    assert.equal(isProviderConfigured("meta_ads"), false);

    // Malformed config ID must NOT be configured
    process.env.META_ADS_LOGIN_CONFIG_ID = "invalid-non-numeric";
    assert.equal(isProviderConfigured("meta_ads"), false);

    // Empty/whitespace must NOT be configured
    process.env.META_ADS_LOGIN_CONFIG_ID = "   ";
    assert.equal(isProviderConfigured("meta_ads"), false);

    // Valid numeric config ID must be configured
    process.env.META_ADS_LOGIN_CONFIG_ID = "1234567890123457";
    assert.equal(isProviderConfigured("meta_ads"), true);
  });
});
