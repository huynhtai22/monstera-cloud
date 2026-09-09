import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GET as getMetaAccounts } from "./meta-ads/accounts/route";
import { GET as getGoogleAccounts } from "./google-ads/accounts/route";
import { setAuthSessionOverride } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";
import { metaAdsClient } from "@/lib/meta-ads";
import { googleAdsOAuthClient } from "@/lib/google-ads";
import {
  getConnectorContext,
  captureTelemetryForTest,
  toOpaqueWorkspaceId,
  toOpaqueConnectionId,
} from "@/lib/observability/connector-telemetry";

if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
}

describe("Provider Account Discovery Tenant Context & RBAC", () => {
  const originalFindFirst = prisma.connection.findFirst;
  const originalGetAdAccounts = metaAdsClient.getAdAccounts;
  const originalListAccessibleCustomers = googleAdsOAuthClient.listAccessibleCustomers;

  beforeEach(() => {
    setAuthSessionOverride(async () => ({
      user: { id: "user_tenant_1", email: "user@example.test" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));
  });

  afterEach(() => {
    setAuthSessionOverride(null);
    prisma.connection.findFirst = originalFindFirst;
    metaAdsClient.getAdAccounts = originalGetAdAccounts;
    googleAdsOAuthClient.listAccessibleCustomers = originalListAccessibleCustomers;
  });

  describe("Meta Ads Account Discovery", () => {
    it("1. Returns 401 when unauthenticated without contacting provider or creating context", async () => {
      setAuthSessionOverride(async () => null);
      let providerCalled = false;
      metaAdsClient.getAdAccounts = async () => {
        providerCalled = true;
        return [];
      };

      const capture = captureTelemetryForTest();
      try {
        const req = new Request("http://localhost/api/meta-ads/accounts?connectionId=conn_1");
        const res = await getMetaAccounts(req);
        assert.equal(res.status, 401);
        assert.equal(providerCalled, false);
        assert.equal(capture.events.length, 0);
      } finally {
        capture.restore();
      }
    });

    it("2. Returns 400 when connectionId is omitted", async () => {
      let providerCalled = false;
      metaAdsClient.getAdAccounts = async () => {
        providerCalled = true;
        return [];
      };

      const req = new Request("http://localhost/api/meta-ads/accounts");
      const res = await getMetaAccounts(req);
      assert.equal(res.status, 400);
      assert.equal(providerCalled, false);
    });

    it("3. Returns 404 and reveals nothing for rival-workspace connection without provider call", async () => {
      let providerCalled = false;
      metaAdsClient.getAdAccounts = async () => {
        providerCalled = true;
        return [];
      };

      // Mock database lookup returning null (rival workspace: user not a member)
      prisma.connection.findFirst = (async (args: any) => {
        // Assert query enforces workspace membership
        assert.ok(args.where.workspace?.members?.some?.userId === "user_tenant_1");
        return null;
      }) as any;

      const capture = captureTelemetryForTest();
      try {
        const req = new Request("http://localhost/api/meta-ads/accounts?connectionId=conn_rival_999");
        const res = await getMetaAccounts(req);
        assert.equal(res.status, 404);
        assert.equal(providerCalled, false);
        // Zero tenant-scoped telemetry emitted
        const tenantEvents = capture.events.filter((e) => e.contextStatus === "tenant_scoped");
        assert.equal(tenantEvents.length, 0);
      } finally {
        capture.restore();
      }
    });

    it("4. Returns cached accounts from credentials without invoking provider API", async () => {
      let providerCalled = false;
      metaAdsClient.getAdAccounts = async () => {
        providerCalled = true;
        return [];
      };

      prisma.connection.findFirst = (async () => ({
        id: "conn_meta_cached",
        workspaceId: "ws_meta_1",
        provider: "meta_ads",
        status: "connected",
        credentials: encrypt(JSON.stringify({
          adAccounts: [{ id: "act_100", name: "Cached Account", currency: "USD" }],
        })),
      })) as any;

      const req = new Request("http://localhost/api/meta-ads/accounts?connectionId=conn_meta_cached");
      const res = await getMetaAccounts(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.accounts.length, 1);
      assert.equal(data.accounts[0].id, "act_100");
      assert.equal(providerCalled, false);
    });

    it("5. Wraps token refresh and uncached discovery in validated tenant context", async () => {
      let contextInDiscovery: any = null;

      metaAdsClient.getAdAccounts = async () => {
        contextInDiscovery = getConnectorContext();
        return [{ id: "act_200", name: "Fresh Account", currency: "USD", account_status: 1 }];
      };

      prisma.connection.findFirst = (async () => ({
        id: "conn_meta_live",
        workspaceId: "ws_meta_tenant_abc",
        provider: "meta_ads",
        status: "connected",
        credentials: encrypt(JSON.stringify({
          accessToken: "meta_valid_token_xyz",
          expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        })),
      })) as any;

      const capture = captureTelemetryForTest();
      try {
        const req = new Request("http://localhost/api/meta-ads/accounts?connectionId=conn_meta_live");
        const res = await getMetaAccounts(req);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.accounts[0].id, "act_200");

        assert.ok(contextInDiscovery);
        assert.equal(contextInDiscovery.workspaceId, "ws_meta_tenant_abc");
        assert.equal(contextInDiscovery.connectionId, "conn_meta_live");
        assert.equal(contextInDiscovery.provider, "meta_ads");
      } finally {
        capture.restore();
      }
    });
  });

  describe("Google Ads Account Discovery", () => {
    it("1. Returns 401 when unauthenticated without contacting provider", async () => {
      setAuthSessionOverride(async () => null);
      let providerCalled = false;
      googleAdsOAuthClient.listAccessibleCustomers = async () => {
        providerCalled = true;
        return [];
      };

      const req = new Request("http://localhost/api/google-ads/accounts?connectionId=conn_g1");
      const res = await getGoogleAccounts(req);
      assert.equal(res.status, 401);
      assert.equal(providerCalled, false);
    });

    it("2. Returns 400 when connectionId is omitted", async () => {
      const req = new Request("http://localhost/api/google-ads/accounts");
      const res = await getGoogleAccounts(req);
      assert.equal(res.status, 400);
    });

    it("3. Returns 404 for rival-workspace Google connection without provider call", async () => {
      let providerCalled = false;
      googleAdsOAuthClient.listAccessibleCustomers = async () => {
        providerCalled = true;
        return [];
      };

      prisma.connection.findFirst = (async () => null) as any;

      const req = new Request("http://localhost/api/google-ads/accounts?connectionId=conn_rival_g");
      const res = await getGoogleAccounts(req);
      assert.equal(res.status, 404);
      assert.equal(providerCalled, false);
    });

    it("4. Returns cached customerIds from credentials without provider call", async () => {
      let providerCalled = false;
      googleAdsOAuthClient.listAccessibleCustomers = async () => {
        providerCalled = true;
        return [];
      };

      prisma.connection.findFirst = (async () => ({
        id: "conn_g_cached",
        workspaceId: "ws_google_1",
        provider: "google_ads",
        status: "connected",
        credentials: encrypt(JSON.stringify({ customerIds: ["1112223333"] })),
      })) as any;

      const req = new Request("http://localhost/api/google-ads/accounts?connectionId=conn_g_cached");
      const res = await getGoogleAccounts(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.deepEqual(data.customerIds, ["1112223333"]);
      assert.equal(providerCalled, false);
    });

    it("5. Wraps token refresh and customer list in validated tenant context", async () => {
      let contextInDiscovery: any = null;

      googleAdsOAuthClient.listAccessibleCustomers = async () => {
        contextInDiscovery = getConnectorContext();
        return ["5556667777", "8889990000"];
      };

      prisma.connection.findFirst = (async () => ({
        id: "conn_google_live",
        workspaceId: "ws_google_tenant_xyz",
        provider: "google_ads",
        status: "connected",
        credentials: encrypt(JSON.stringify({
          accessToken: "google_token_abc",
          expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        })),
      })) as any;

      const req = new Request("http://localhost/api/google-ads/accounts?connectionId=conn_google_live");
      const res = await getGoogleAccounts(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.deepEqual(data.customerIds, ["5556667777", "8889990000"]);

      assert.ok(contextInDiscovery);
      assert.equal(contextInDiscovery.workspaceId, "ws_google_tenant_xyz");
      assert.equal(contextInDiscovery.connectionId, "conn_google_live");
      assert.equal(contextInDiscovery.provider, "google_ads");
    });
  });
});
