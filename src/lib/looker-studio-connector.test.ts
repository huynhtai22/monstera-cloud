import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getGoogleIdTokenAudienceAllowlist } from "./google-id-token";

describe("Looker Studio & Add-on Connector Tests", () => {
  it("resolves Google ID token audience allowlist from explicit and fallback envs", () => {
    const originalAudiences = process.env.GOOGLE_ID_TOKEN_AUDIENCES;
    const originalClientId = process.env.GOOGLE_CLIENT_ID;

    try {
      process.env.GOOGLE_ID_TOKEN_AUDIENCES = "client-1.apps.googleusercontent.com, client-2.apps.googleusercontent.com";
      const list = getGoogleIdTokenAudienceAllowlist();
      assert.deepEqual(list, [
        "client-1.apps.googleusercontent.com",
        "client-2.apps.googleusercontent.com",
      ]);

      delete process.env.GOOGLE_ID_TOKEN_AUDIENCES;
      process.env.GOOGLE_CLIENT_ID = "fallback-client.apps.googleusercontent.com";
      const fallbackList = getGoogleIdTokenAudienceAllowlist();
      assert.ok(fallbackList.includes("fallback-client.apps.googleusercontent.com"));
    } finally {
      if (originalAudiences !== undefined) process.env.GOOGLE_ID_TOKEN_AUDIENCES = originalAudiences;
      else delete process.env.GOOGLE_ID_TOKEN_AUDIENCES;
      if (originalClientId !== undefined) process.env.GOOGLE_CLIENT_ID = originalClientId;
      else delete process.env.GOOGLE_CLIENT_ID;
    }
  });

  it("identifies Google JWT tokens accurately vs API keys", () => {
    const isGoogleJwt = (token: string) => {
      const parts = token.split('.');
      return parts.length === 3 && parts[0].startsWith('eyJ');
    };

    const dummyJwt = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9.ey could_be_payload.dummy_signature";
    const dummyApiKey = "mc_live_1234567890abcdef1234567890abcdef";

    assert.equal(isGoogleJwt(dummyJwt), true);
    assert.equal(isGoogleJwt(dummyApiKey), false);
    assert.equal(isGoogleJwt("random-bearer-token"), false);
  });
});
