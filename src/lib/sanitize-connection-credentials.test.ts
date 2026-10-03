import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  sanitizeConnectionCredentials,
  sanitizeConnectionCredentialsForAccounts,
} from "./sanitize-connection-credentials";
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

  it("projects shared-root metadata to the exact assigned account without exposing siblings", () => {
    const encrypted = encrypt(JSON.stringify({
      accessToken: "never-return-this",
      managerCustomerId: "9999999999",
      customerIds: ["111-000-1111", "222-000-2222"],
      adAccountIds: ["act_1110001111", "act_2220002222"],
      advertiserIds: ["1110001111", "2220002222"],
      adAccounts: [
        { id: "act_1110001111", name: "Client A" },
        { id: "act_2220002222", name: "Client B" },
      ],
      shopId: "2220002222",
    }));

    const google = JSON.parse(sanitizeConnectionCredentialsForAccounts(
      encrypted,
      "google_ads",
      ["1110001111"],
    ));
    assert.deepEqual(google.customerIds, ["111-000-1111"]);
    assert.equal(JSON.stringify(google).includes("2220002222"), false);
    assert.equal(google.accessToken, undefined);
    assert.equal(google.managerCustomerId, "9999999999");

    const meta = JSON.parse(sanitizeConnectionCredentialsForAccounts(
      encrypted,
      "meta_ads",
      ["1110001111"],
    ));
    assert.deepEqual(meta.adAccountIds, ["act_1110001111"]);
    assert.deepEqual(meta.adAccounts, [{ id: "act_1110001111", name: "Client A" }]);
    assert.equal(JSON.stringify(meta).includes("Client B"), false);
  });

  it("returns no account metadata for explicit-empty scope", () => {
    const encrypted = encrypt(JSON.stringify({ customerIds: ["1110001111"], shopId: "shop-1" }));
    const projected = JSON.parse(sanitizeConnectionCredentialsForAccounts(encrypted, "google_ads", []));
    assert.deepEqual(projected.customerIds, []);
    assert.deepEqual(projected.adAccounts, []);
    assert.equal(projected.shopId, undefined);
    assert.equal(projected.discoveredCustomerCount, 0);
  });
});
