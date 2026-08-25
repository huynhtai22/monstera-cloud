import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TikTokBusinessOAuthAdapter } from "./oauth-framework/providers/tiktok-business";

async function withMockedFetch<T>(
  response: Response,
  run: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => response) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("TikTok OAuth token exchange", () => {
  it("accepts TikTok's long-lived advertiser token response", async () => {
    const previousAppId = process.env.TIKTOK_BUSINESS_APP_ID;
    const previousSecret = process.env.TIKTOK_BUSINESS_APP_SECRET;
    process.env.TIKTOK_BUSINESS_APP_ID = "test-app";
    process.env.TIKTOK_BUSINESS_APP_SECRET = "test-secret";

    try {
      await withMockedFetch(
        new Response(
          JSON.stringify({
            code: 0,
            data: { access_token: "test-access", advertiser_ids: ["advertiser-test"] },
          }),
        ),
        async () => {
          const { credentials } = await new TikTokBusinessOAuthAdapter().exchangeCode({
            code: "test-auth-code",
            redirectUri: "https://monsteracloud.com/api/auth/callback?provider=tiktok_business",
            metadata: { workspaceId: "workspace-test", userId: "user-test" },
          });
          assert.equal(credentials.tokenMode, "long_lived_advertiser");
          assert.equal(credentials.refreshToken, undefined);
          assert.equal(credentials.expiresAt, undefined);
        },
      );
    } finally {
      if (previousAppId === undefined) delete process.env.TIKTOK_BUSINESS_APP_ID;
      else process.env.TIKTOK_BUSINESS_APP_ID = previousAppId;
      if (previousSecret === undefined) delete process.env.TIKTOK_BUSINESS_APP_SECRET;
      else process.env.TIKTOK_BUSINESS_APP_SECRET = previousSecret;
    }
  });

  it("rejects a partial refreshable response before a connection can be persisted", async () => {
    const previousAppId = process.env.TIKTOK_BUSINESS_APP_ID;
    const previousSecret = process.env.TIKTOK_BUSINESS_APP_SECRET;
    process.env.TIKTOK_BUSINESS_APP_ID = "test-app";
    process.env.TIKTOK_BUSINESS_APP_SECRET = "test-secret";

    try {
      await withMockedFetch(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              access_token: "test-access",
              expires_in: 86400,
              advertiser_ids: ["advertiser-test"],
              scope: "reporting",
              token_type: "Bearer",
            },
          }),
        ),
        async () => {
          await assert.rejects(
            new TikTokBusinessOAuthAdapter().exchangeCode({
              code: "test-auth-code",
              redirectUri: "https://monsteracloud.com/api/auth/callback?provider=tiktok_business",
              metadata: { workspaceId: "workspace-test", userId: "user-test" },
            }),
            /invalid token response/,
          );
        },
      );
    } finally {
      if (previousAppId === undefined) delete process.env.TIKTOK_BUSINESS_APP_ID;
      else process.env.TIKTOK_BUSINESS_APP_ID = previousAppId;
      if (previousSecret === undefined) delete process.env.TIKTOK_BUSINESS_APP_SECRET;
      else process.env.TIKTOK_BUSINESS_APP_SECRET = previousSecret;
    }
  });
});
