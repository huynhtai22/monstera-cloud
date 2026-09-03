import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { sanitizeConnectionCredentials } from "./sanitize-connection-credentials";
import { encrypt } from "./encryption";

const ENCRYPTION_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("sanitizeConnectionCredentials", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY_HEX;
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  it("strips accessToken and refreshToken but preserves accountEmail, mccId, and managerCustomerId", () => {
    const raw = JSON.stringify({
      accessToken: "secret_access_token_123",
      refreshToken: "secret_refresh_token_456",
      accountEmail: "media.buyer@agency.com",
      accountName: "Media Buyer",
      mccId: "1234567890",
      managerCustomerId: "1234567890",
      customerIds: ["1234567890"],
      shopDomain: "mystore.myshopify.com",
      sellerId: "VN12345",
      sellingPartnerId: "amzn1.sp.123",
      googleAdsRootType: "manager",
    });

    const encrypted = encrypt(raw);
    const sanitized = JSON.parse(sanitizeConnectionCredentials(encrypted));

    assert.equal(sanitized.accessToken, undefined);
    assert.equal(sanitized.refreshToken, undefined);
    assert.equal(sanitized.accountEmail, "media.buyer@agency.com");
    assert.equal(sanitized.accountName, "Media Buyer");
    assert.equal(sanitized.mccId, "1234567890");
    assert.equal(sanitized.managerCustomerId, "1234567890");
    assert.deepEqual(sanitized.customerIds, ["1234567890"]);
    assert.equal(sanitized.shopDomain, "mystore.myshopify.com");
    assert.equal(sanitized.sellerId, "VN12345");
    assert.equal(sanitized.sellingPartnerId, "amzn1.sp.123");
    assert.equal(sanitized.googleAdsRootType, "manager");
  });

  it("returns empty object on invalid payload", () => {
    assert.equal(sanitizeConnectionCredentials("invalid_cipher"), "{}");
  });
});
