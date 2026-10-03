import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import prisma from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";
import { getProviderRegistry } from "@/lib/oauth-framework/registry";
import { GET } from "./route";

describe("CRON /api/cron/connections/token-prefetch", () => {
  const originalCronSecret = process.env.CRON_SECRET;
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;
  let originalFindMany: any;
  let originalFindUnique: any;
  let originalUpdate: any;
  let originalHealth: any;

  beforeEach(() => {
    process.env.CRON_SECRET = "a".repeat(32);
    process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    originalFindMany = prisma.connection.findMany;
    originalFindUnique = prisma.connection.findUnique;
    originalUpdate = prisma.connection.update;
    originalHealth = (prisma as any).providerAccountHealth;
    (prisma.connection.findUnique as any) = async () => null;
    (prisma as any).providerAccountHealth = {
      findUnique: async () => null,
      upsert: async () => ({}),
    };
    (prisma as any).supportTicket = {
      findFirst: async () => null,
      create: async () => ({}),
    };
    (prisma as any).workspace = {
      findUnique: async () => null,
    };
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalCronSecret;
    process.env.ENCRYPTION_KEY = originalEncryptionKey;
    prisma.connection.findMany = originalFindMany;
    prisma.connection.findUnique = originalFindUnique;
    prisma.connection.update = originalUpdate;
    (prisma as any).providerAccountHealth = originalHealth;
  });

  it("denies access when authorization header is missing or incorrect", async () => {
    const req = new Request("http://localhost:3000/api/cron/connections/token-prefetch");
    const res = await GET(req);
    assert.equal(res.status, 401);
  });

  it("proactively scans connections and returns healthy status for valid tokens", async () => {
    const creds = {
      accessToken: "valid-tiktok-token",
      tokenMode: "long_lived_advertiser",
    };

    (prisma.connection.findMany as any) = async () => [
      {
        id: "conn-tiktok-1",
        provider: "tiktok_business",
        credentials: encrypt(JSON.stringify(creds)),
        workspaceId: "ws-1",
        remoteAccountId: "adv-1",
      },
    ];

    const req = new Request("http://localhost:3000/api/cron/connections/token-prefetch", {
      headers: { Authorization: `Bearer ${"a".repeat(32)}` },
    });

    const res = await GET(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.statistics.connectionsScanned, 1);
    assert.equal(body.statistics.cacheWarmed, 1);
    assert.equal(body.statistics.failed, 0);
  });

  it("isolates connection and triggers reconnect_required on auth expiration", async () => {
    const updateCalls: any[] = [];
    (prisma.connection.update as any) = async (args: any) => {
      updateCalls.push(args);
      return {};
    };

    // Meta token expiring with failing mock adapter
    const registry = getProviderRegistry();
    const metaAdapter = registry.meta_ads;
    const originalRefresh = metaAdapter.refreshCredentials;
    metaAdapter.refreshCredentials = async () => {
      throw new Error("OAuthException code 190: Error validating access token: Session has expired");
    };

    try {
      const expiringCreds = {
        accessToken: "expiring-token",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      };

      (prisma.connection.findMany as any) = async () => [
        {
          id: "conn-meta-revoked",
          provider: "meta_ads",
          credentials: encrypt(JSON.stringify(expiringCreds)),
          workspaceId: "ws-1",
          remoteAccountId: "act-revoked",
        },
      ];

      const req = new Request("http://localhost:3000/api/cron/connections/token-prefetch", {
        headers: { Authorization: `Bearer ${"a".repeat(32)}` },
      });

      const res = await GET(req);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.statistics.connectionsScanned, 1);
      assert.equal(body.statistics.failed, 1);
      assert.equal(updateCalls.length, 1);
      assert.ok(updateCalls[0].data.lastError.includes("OAuthException code 190"));
    } finally {
      metaAdapter.refreshCredentials = originalRefresh;
    }
  });
});
