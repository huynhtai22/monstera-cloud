import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPilotCertifiedProvider } from "./integration-flags";
import { PUBLIC_INTEGRATIONS, PUBLIC_INTEGRATION_SLUGS, publicIntegrationBySlug } from "./public-integrations";

const providerIdBySource = {
  "Meta Ads": "meta_ads",
  "Google Ads": "google_ads",
  "TikTok Ads": "tiktok_business",
  Shopee: "shopee",
} as const;

describe("public integration catalog", () => {
  it("publishes only pilot-certified source providers", () => {
    for (const integration of PUBLIC_INTEGRATIONS) {
      const providerId = providerIdBySource[integration.source as keyof typeof providerIdBySource];
      assert.ok(providerId, `Unknown public source: ${integration.source}`);
      assert.equal(isPilotCertifiedProvider(providerId), true, `${integration.slug} is not certified`);
    }
  });

  it("has unique, resolvable slugs with explicit requirements and limitations", () => {
    assert.equal(new Set(PUBLIC_INTEGRATION_SLUGS).size, PUBLIC_INTEGRATION_SLUGS.length);
    for (const slug of PUBLIC_INTEGRATION_SLUGS) {
      const entry = publicIntegrationBySlug(slug);
      assert.ok(entry);
      assert.ok(entry.requirements.length > 0);
      assert.ok(entry.limitations.length > 0);
    }
  });

  it("does not publish uncertified provider routes", () => {
    for (const slug of PUBLIC_INTEGRATION_SLUGS) {
      assert.doesNotMatch(slug, /tiktok-shop|lazada|shopify|amazon/);
    }
  });
});
