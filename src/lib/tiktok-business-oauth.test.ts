import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TikTokBusinessOAuthAdapter } from "./oauth-framework/providers/tiktok-business";

async function withMockedFetch<T>(
  response: Response | Response[],
  run: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const responses = Array.isArray(response) ? response : [response];
  let call = 0;
  globalThis.fetch = (async () => responses[Math.min(call++, responses.length - 1)]) as typeof fetch;
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
        [
          new Response(
            JSON.stringify({
              code: 0,
              data: { access_token: "test-access", advertiser_ids: ["712345678901234"] },
            }),
          ),
          new Response(JSON.stringify({ code: 0, data: { list: [] }, request_id: "discovery-1" })),
        ],
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

  it("discovers numeric advertiser IDs when the token response omits them", async () => {
    const previousAppId = process.env.TIKTOK_BUSINESS_APP_ID;
    const previousSecret = process.env.TIKTOK_BUSINESS_APP_SECRET;
    process.env.TIKTOK_BUSINESS_APP_ID = "test-app";
    process.env.TIKTOK_BUSINESS_APP_SECRET = "test-secret";

    try {
      await withMockedFetch(
        [
          new Response(JSON.stringify({ code: 0, data: { access_token: "test-access" } })),
          new Response(JSON.stringify({
            code: 0,
            data: { list: [{ advertiser_id: "712345678901234" }] },
            request_id: "discovery-2",
          })),
        ],
        async () => {
          const { metadata } = await new TikTokBusinessOAuthAdapter().exchangeCode({
            code: "test-auth-code",
            redirectUri: "https://monsteracloud.com/api/auth/callback?provider=tiktok_business",
            metadata: { workspaceId: "workspace-test", userId: "user-test" },
          });
          assert.deepEqual(metadata.accountIdentifiers, ["712345678901234"]);
          assert.equal(metadata.extraFields?.advertiserDiscoveryRequestId, "discovery-2");
        },
      );
    } finally {
      if (previousAppId === undefined) delete process.env.TIKTOK_BUSINESS_APP_ID;
      else process.env.TIKTOK_BUSINESS_APP_ID = previousAppId;
      if (previousSecret === undefined) delete process.env.TIKTOK_BUSINESS_APP_SECRET;
      else process.env.TIKTOK_BUSINESS_APP_SECRET = previousSecret;
    }
  });

  it("keeps token advertiser IDs but reports an auxiliary discovery failure", async () => {
    const previousAppId = process.env.TIKTOK_BUSINESS_APP_ID;
    const previousSecret = process.env.TIKTOK_BUSINESS_APP_SECRET;
    process.env.TIKTOK_BUSINESS_APP_ID = "test-app";
    process.env.TIKTOK_BUSINESS_APP_SECRET = "test-secret";

    try {
      await withMockedFetch(
        [
          new Response(JSON.stringify({
            code: 0,
            data: { access_token: "test-access", advertiser_ids: ["712345678901234"] },
          })),
          new Response(
            JSON.stringify({ code: 40100, message: "Permission denied", request_id: "discovery-failed" }),
            { status: 403 },
          ),
        ],
        async () => {
          const { metadata } = await new TikTokBusinessOAuthAdapter().exchangeCode({
            code: "test-auth-code",
            redirectUri: "https://monsteracloud.com/api/auth/callback?provider=tiktok_business",
            metadata: { workspaceId: "workspace-test", userId: "user-test" },
          });
          assert.deepEqual(metadata.accountIdentifiers, ["712345678901234"]);
          assert.equal(metadata.extraFields?.advertiserDiscoveryStatus, "failed");
          assert.match(String(metadata.extraFields?.advertiserDiscoveryError), /Permission denied/);
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
              advertiser_ids: ["712345678901234"],
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

  it("rejects a token response with no numeric advertiser IDs", async () => {
    const previousAppId = process.env.TIKTOK_BUSINESS_APP_ID;
    const previousSecret = process.env.TIKTOK_BUSINESS_APP_SECRET;
    process.env.TIKTOK_BUSINESS_APP_ID = "test-app";
    process.env.TIKTOK_BUSINESS_APP_SECRET = "test-secret";

    try {
      await withMockedFetch(
        [
          new Response(JSON.stringify({ code: 0, data: { access_token: "test-access", advertiser_ids: ["#un1v"] } })),
          new Response(JSON.stringify({ code: 0, data: { list: [] }, request_id: "discovery-empty" })),
        ],
        async () => {
          await assert.rejects(
            new TikTokBusinessOAuthAdapter().exchangeCode({
              code: "test-auth-code",
              redirectUri: "https://monsteracloud.com/api/auth/callback?provider=tiktok_business",
              metadata: { workspaceId: "workspace-test", userId: "user-test" },
            }),
            /reconnect required/i,
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
