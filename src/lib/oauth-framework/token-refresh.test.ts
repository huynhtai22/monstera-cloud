import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getValidOAuthToken } from "./token-refresh";
import { encrypt } from "@/lib/encryption";

describe("OAuth token refresh", () => {
  it("uses marked and legacy TikTok advertiser tokens directly when long-lived", async () => {
    const previousEncryptionKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = "01".repeat(32);
    try {
      const markedAccessToken = await getValidOAuthToken({
        id: "test-connection",
        provider: "tiktok_business",
        credentials: encrypt(JSON.stringify({
          accessToken: "test-long-lived-token",
          tokenMode: "long_lived_advertiser",
        })),
      });

      const legacyAccessToken = await getValidOAuthToken({
        id: "legacy-test-connection",
        provider: "tiktok_business",
        credentials: encrypt(JSON.stringify({
          accessToken: "test-legacy-long-lived-token",
        })),
      });

      assert.equal(markedAccessToken, "test-long-lived-token");
      assert.equal(legacyAccessToken, "test-legacy-long-lived-token");
    } finally {
      if (previousEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = previousEncryptionKey;
    }
  });
});
