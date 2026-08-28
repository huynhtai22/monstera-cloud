import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import prisma from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";
import { syncShopeeCatalogWarehouse } from "@/lib/sync-shopee-catalog-warehouse";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

type CampaignRow = { id: string; data: Record<string, unknown> };

describe("Shopee catalog warehouse sync", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ENCRYPTION_KEY;
  const originalTestPartnerId = process.env.SHOPEE_TEST_PARTNER_ID;
  const originalTestPartnerKey = process.env.SHOPEE_TEST_PARTNER_KEY;
  const originalLivePartnerId = process.env.SHOPEE_LIVE_PARTNER_ID;
  const originalLivePartnerKey = process.env.SHOPEE_LIVE_PARTNER_KEY;
  const originalConnection = (prisma as any).connection;
  const originalCampaign = (prisma as any).shopeeCampaign;
  const originalProduct = (prisma as any).shopeeProduct;
  const originalState = (prisma as any).shopeeCatalogSyncState;
  const originalRuns = (prisma as any).providerSyncRun;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = originalKey;
    if (originalTestPartnerId === undefined) delete process.env.SHOPEE_TEST_PARTNER_ID; else process.env.SHOPEE_TEST_PARTNER_ID = originalTestPartnerId;
    if (originalTestPartnerKey === undefined) delete process.env.SHOPEE_TEST_PARTNER_KEY; else process.env.SHOPEE_TEST_PARTNER_KEY = originalTestPartnerKey;
    if (originalLivePartnerId === undefined) delete process.env.SHOPEE_LIVE_PARTNER_ID; else process.env.SHOPEE_LIVE_PARTNER_ID = originalLivePartnerId;
    if (originalLivePartnerKey === undefined) delete process.env.SHOPEE_LIVE_PARTNER_KEY; else process.env.SHOPEE_LIVE_PARTNER_KEY = originalLivePartnerKey;
    (prisma as any).connection = originalConnection;
    (prisma as any).shopeeCampaign = originalCampaign;
    (prisma as any).shopeeProduct = originalProduct;
    (prisma as any).shopeeCatalogSyncState = originalState;
    (prisma as any).providerSyncRun = originalRuns;
  });

  function installHarness(sandbox: boolean) {
    process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
    if (sandbox) {
      process.env.SHOPEE_TEST_PARTNER_ID = "850001";
      process.env.SHOPEE_TEST_PARTNER_KEY = "sanitized-test-key";
    } else {
      process.env.SHOPEE_LIVE_PARTNER_ID = "850001";
      process.env.SHOPEE_LIVE_PARTNER_KEY = "sanitized-test-key";
    }
    const campaigns = new Map<string, CampaignRow>();
    const runs: Array<Record<string, unknown>> = [];
    const credentials = encrypt(JSON.stringify({
      access_token: "test-access-token",
      refresh_token: "test-refresh-token",
      expire_in: 14_400,
      access_token_obtained_at: Math.floor(Date.now() / 1000),
      shop_id: 227420569,
      sandbox,
    }));
    (prisma as any).connection = {
      findUnique: async () => ({ id: "conn-shopee", credentials, updatedAt: new Date() }),
    };
    (prisma as any).shopeeCampaign = {
      upsert: async ({ where, create, update }: any) => {
        const key = JSON.stringify(where.connectionId_environment_shopId_externalCampaignId);
        const existing = campaigns.get(key);
        const data = existing ? { ...existing.data, ...update } : create;
        campaigns.set(key, { id: existing?.id ?? `campaign-${campaigns.size + 1}`, data });
        return { id: campaigns.get(key)!.id, ...data };
      },
    };
    (prisma as any).shopeeProduct = { upsert: async () => ({ id: "product" }) };
    (prisma as any).shopeeCatalogSyncState = {
      findUnique: async () => null,
      upsert: async () => ({ id: "state" }),
    };
    (prisma as any).providerSyncRun = { create: async ({ data }: any) => { runs.push(data); return { id: `run-${runs.length}`, ...data }; } };
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("get_product_level_campaign_id_list")) {
        return new Response(JSON.stringify({
          error: "", request_id: "sanitized-list-request",
          response: { shop_id: 227420569, region: "VN", has_next_page: false, campaign_list: [{ campaign_id: 210343, ad_type: "manual" }] },
        }), { status: 200 });
      }
      if (url.pathname.endsWith("get_product_level_campaign_setting_info")) {
        // Enrichment can be unavailable without invalidating the identity source.
        return new Response(JSON.stringify({ error: "error_permission", message: "settings unavailable", request_id: "sanitized-settings-request" }), { status: 200 });
      }
      if (url.pathname.endsWith("get_item_list")) {
        return new Response(JSON.stringify({ error: "", response: { item: [], has_next_page: false } }), { status: 200 });
      }
      throw new Error(`unexpected test request: ${url.pathname}`);
    }) as typeof fetch;
    return { campaigns, runs };
  }

  it("upserts campaign 210343/manual exactly once across repeated sandbox syncs even when settings enrichment fails", async () => {
    const { campaigns, runs } = installHarness(true);
    const first = await syncShopeeCatalogWarehouse({ workspaceId: "ws-a", connectionId: "conn-shopee" });
    const second = await syncShopeeCatalogWarehouse({ workspaceId: "ws-a", connectionId: "conn-shopee" });

    assert.equal(first.success, true);
    assert.equal(first.campaignsSuccess, true);
    assert.equal(first.campaignsWritten, 1);
    assert.equal(second.campaignsWritten, 1);
    assert.equal(campaigns.size, 1, "unique upsert prevents duplicate campaign identities");
    const row = [...campaigns.values()][0].data;
    assert.equal(row.workspaceId, "ws-a");
    assert.equal(row.connectionId, "conn-shopee");
    assert.equal(row.environment, "sandbox");
    assert.equal(row.shopId, "227420569");
    assert.equal(row.externalCampaignId, "210343");
    assert.equal(row.adType, "manual");
    assert.ok(runs.some((run) => run.endpoint === "v2.ads.get_product_level_campaign_setting_info" && run.status === "error"));
  });

  it("keeps sandbox and production campaign identities isolated", async () => {
    const sandbox = installHarness(true);
    await syncShopeeCatalogWarehouse({ workspaceId: "ws-a", connectionId: "conn-shopee" });
    const production = installHarness(false);
    // Preserve the first map to prove the two environments produce distinct unique keys.
    for (const [key, value] of sandbox.campaigns) production.campaigns.set(key, value);
    await syncShopeeCatalogWarehouse({ workspaceId: "ws-a", connectionId: "conn-shopee" });

    assert.equal(production.campaigns.size, 2);
    assert.deepEqual([...production.campaigns.values()].map((row) => row.data.environment).sort(), ["production", "sandbox"]);
  });
});
