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
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
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

  it("requires the Google Ads developer token before exposing the connector", () => {
    clearTrackedEnv();
    process.env.GOOGLE_ADS_CLIENT_ID = "google-client";
    process.env.GOOGLE_ADS_CLIENT_SECRET = "google-secret";
    assert.equal(isProviderConfigured("google_ads"), false);

    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "developer-token";
    assert.equal(isProviderConfigured("google_ads"), true);
  });
});
