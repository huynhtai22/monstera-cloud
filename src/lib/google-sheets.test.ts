import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getGoogleTokens } from "./google-sheets";

describe("Google Sheets Token Resolution", () => {
  it("resolves tokens from explicit credentials object without database lookup", async () => {
    const explicitCreds = {
      refreshToken: "test-refresh-token-xyz",
      accessToken: "test-access-token-abc",
      expiresAt: 1893456000,
    };

    const tokens = await getGoogleTokens("", explicitCreds);
    assert.ok(tokens);
    assert.equal(tokens?.refreshToken, "test-refresh-token-xyz");
    assert.equal(tokens?.accessToken, "test-access-token-abc");
    assert.equal(tokens?.expiresAt, 1893456000);
  });

  it("returns null when no explicit credentials and no userId", async () => {
    const tokens = await getGoogleTokens("");
    assert.equal(tokens, null);
  });
});
