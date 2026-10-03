import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import { withSystemScope } from "@/lib/tenant-guard";
import {
  acquireMetaSyncLock,
  releaseMetaSyncLock,
  upsertMetaMetric,
} from "./meta-sync-lock";
import { upsertCampaignMetric } from "./ad-platform-ingest";
import { mapShopeeProductDailyToCampaignMetricPayload } from "./shopee-ads-mapper";
import { resolveShopeeRowPerformance } from "./shopee-performance-fields";
import { queryWarehouse } from "./warehouse-query";
import { classifyRawDependencyReadiness } from "./warehouse-raw-retention";

const suffix = `promo-${Date.now()}-${process.pid}`;
const owner = `promo-owner-${suffix}`;
const wsA = `promo-ws-a-${suffix}`;
const wsB = `promo-ws-b-${suffix}`;
const scopeFor = (connectionId: string) => `meta_ads:${wsA}:${connectionId}:act_promo`;

const METRIC = {
  date: "2026-02-01",
  campaign_id: 99901,
  campaign_name: "Ao Thun Nam Basic",
  item_id: 1234567,
  item_name: "Ao Thun Cotton 100%",
  ad_type: "SEARCH",
  impression: 5000,
  clicks: 120,
  ctr: 0.024,
  expense: 240000,
  broad_order: 10,
  broad_order_amount: 15,
  broad_gmv: 1800000,
  broad_roas: 7.5,
  broad_cir: 0.133,
  broad_cr: 0.083,
  broad_cost_per_conversion: 24000,
  direct_order: 8,
  direct_order_amount: 12,
  direct_gmv: 1500000,
  direct_roas: 6.25,
  direct_cir: 0.16,
  direct_cr: 0.067,
  direct_cost_per_conversion: 30000,
} as any;

describe("PostgreSQL integration: raw-dependency promotion", () => {
  let connMeta: { id: string };
  let connShopee: { id: string };
  let connRival: { id: string };

  before(async () => {
    await withSystemScope(async () => {
      await prisma.user.create({ data: { id: owner, email: `${owner}@example.test`, name: "Promo Owner" } });
      await prisma.workspace.createMany({
        data: [
          { id: wsA, slug: wsA, name: "Promo A", ownerId: owner },
          { id: wsB, slug: wsB, name: "Promo B", ownerId: owner },
        ],
      });
      connMeta = await prisma.connection.create({
        data: { workspaceId: wsA, name: "Promo Meta", type: "source", provider: "meta_ads", credentials: "enc:v1:t", remoteAccountId: `promo-meta-${suffix}` },
      });
      connShopee = await prisma.connection.create({
        data: { workspaceId: wsA, name: "Promo Shopee", type: "source", provider: "shopee", credentials: "enc:v1:t", remoteAccountId: `promo-shopee-${suffix}` },
      });
      connRival = await prisma.connection.create({
        data: { workspaceId: wsB, name: "Promo Rival", type: "source", provider: "meta_ads", credentials: "enc:v1:t", remoteAccountId: `promo-rival-${suffix}` },
      });
    });
  });

  after(async () => {
    await withSystemScope(async () => {
      await (prisma as any).syncLock.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
      await prisma.campaignMetric.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
      await prisma.connection.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
      await prisma.workspace.deleteMany({ where: { id: { in: [wsA, wsB] } } });
      await prisma.user.deleteMany({ where: { id: owner } });
    });
    await prisma.$disconnect();
  });

  async function withMetaLease<T>(fn: (lease: { scope: string; leaseId: string; fencingToken: bigint }) => Promise<T>): Promise<T> {
    const scope = scopeFor(connMeta.id);
    const acquired = await acquireMetaSyncLock({ workspaceId: wsA, connectionId: connMeta.id, adAccountId: "act_promo", jobId: `promo-${suffix}` });
    assert.equal(acquired.acquired, true, "test lease must acquire");
    const lease = acquired as { scope: string; leaseId: string; fencingToken: bigint };
    try {
      return await fn(lease);
    } finally {
      await releaseMetaSyncLock({ scope, leaseId: lease.leaseId, success: true });
    }
  }

  it("writes and updates Meta adName through the fenced upsert", async () => {
    await withMetaLease(async (lease) => {
      await upsertMetaMetric({
        workspaceId: wsA, connectionId: connMeta.id, accountId: "act_promo",
        level: "ad", entityId: "ad_1", campaignId: "c_1", campaignName: "C1",
        adsetId: "as_1", adsetName: "AS1", adId: "ad_1",
        date: new Date("2026-02-01T00:00:00.000Z"), breakdownHash: "none",
        metrics: { impressions: 1, clicks: 1, spend: 1, reach: 1, cpc: 1, ctr: 1, conversions: 0, revenue: 0, roas: 0, rawData: { ad_name: "First" } },
        adName: "First",
        syncJobId: "job-promo-1", lockScope: lease.scope, leaseId: lease.leaseId, fencingToken: lease.fencingToken,
      });
      await upsertMetaMetric({
        workspaceId: wsA, connectionId: connMeta.id, accountId: "act_promo",
        level: "ad", entityId: "ad_1", campaignId: "c_1", campaignName: "C1",
        adsetId: "as_1", adsetName: "AS1", adId: "ad_1",
        date: new Date("2026-02-01T00:00:00.000Z"), breakdownHash: "none",
        metrics: { impressions: 2, clicks: 2, spend: 2, reach: 2, cpc: 2, ctr: 2, conversions: 0, revenue: 0, roas: 0, rawData: { ad_name: "Second" } },
        adName: "Second",
        syncJobId: "job-promo-2", lockScope: lease.scope, leaseId: lease.leaseId, fencingToken: lease.fencingToken,
      });
    });
    const rows = await prisma.campaignMetric.findMany({ where: { workspaceId: wsA, entityId: "ad_1" } });
    assert.equal(rows.length, 1, "idempotent re-ingestion keeps one row per unique key");
    assert.equal((rows[0] as any).adName, "Second", "repeated upsert updates adName");
    assert.equal(JSON.parse((rows[0] as any).rawData).ad_name, "Second", "rawData is preserved, never nulled");
  });

  it("reads promoted adName first with legacy and malformed fallbacks", async () => {
    await withMetaLease(async (lease) => {
      const base = {
        workspaceId: wsA, connectionId: connMeta.id, accountId: "act_promo",
        campaignId: "c_1", campaignName: "C1", adsetId: "as_1", adsetName: "AS1",
        breakdownHash: "none", syncJobId: "job-promo", lockScope: lease.scope,
        leaseId: lease.leaseId, fencingToken: lease.fencingToken,
      } as const;
      const nul = { impressions: 0, clicks: 0, spend: 0, reach: 0, cpc: 0, ctr: 0, conversions: 0, revenue: 0, roas: 0 };
      await upsertMetaMetric({ ...base, level: "ad", entityId: "ad_promoted", adId: "ad_promoted", date: new Date("2026-02-02T00:00:00.000Z"), metrics: { ...nul, rawData: { ad_name: "Legacy" } }, adName: "Promoted" });
      await upsertMetaMetric({ ...base, level: "ad", entityId: "ad_legacy", adId: "ad_legacy", date: new Date("2026-02-02T00:00:00.000Z"), metrics: { ...nul, rawData: { ad_name: "Legacy" } }, adName: null });
    });
    // Truly malformed rawData (bypasses the upsert serializer, like pre-existing legacy rows).
    await prisma.campaignMetric.create({
      data: {
        workspaceId: wsA, connectionId: connMeta.id, platform: "meta_ads", accountId: "act_promo",
        level: "ad", entityId: "ad_broken", campaignId: "c_1", campaignName: "C1",
        adsetId: "as_1", adId: "ad_broken", date: new Date("2026-02-02T00:00:00.000Z"),
        breakdownHash: "none", adName: null, rawData: "{ malformed",
      } as any,
    });
    // Legacy row with rawData NULL and promoted set stays fully functional.
    await prisma.campaignMetric.create({
      data: {
        workspaceId: wsA, connectionId: connMeta.id, platform: "meta_ads", accountId: "act_promo",
        level: "ad", entityId: "ad_nonull", campaignId: "c_1", campaignName: "C1",
        adsetId: "as_1", adId: "ad_nonull", date: new Date("2026-02-02T00:00:00.000Z"),
        breakdownHash: "none", adName: "NoRaw", rawData: null,
      } as any,
    });
    const { rows } = await queryWarehouse({ workspaceId: wsA, campaignId: "c_1", limit: 100 });
    const byEntity = new Map(rows.map((row: any) => [row.entityId, row.adName]));
    assert.equal(byEntity.get("ad_promoted"), "Promoted", "promoted column wins");
    assert.equal(byEntity.get("ad_legacy"), "Legacy", "legacy rawData fallback still works");
    assert.equal(byEntity.get("ad_broken"), null, "malformed raw JSON cannot crash fallback");
    assert.equal(byEntity.get("ad_nonull"), "NoRaw", "promoted adName works with rawData NULL");
  });

  it("never stamps Meta names onto other providers' rows", async () => {
    await upsertCampaignMetric({
      workspaceId: wsA, connectionId: connShopee.id, platform: "google_ads",
      accountId: "g_1", level: "campaign", entityId: "g_1", campaignId: "g_1",
      date: new Date("2026-02-03T00:00:00.000Z"),
      impressions: 0, clicks: 0, spend: 0, cpc: 0, ctr: 0, conversions: 0,
      rawData: { ad_name: "NotMeta" },
    });
    const row = await prisma.campaignMetric.findFirstOrThrow({ where: { workspaceId: wsA, entityId: "g_1" } });
    assert.equal((row as any).adName, null, "generic ingest leaves adName NULL");
  });

  it("dual-writes every Shopee broad/direct/keyword field and resolves promoted-first", async () => {
    const payload = mapShopeeProductDailyToCampaignMetricPayload({
      workspaceId: wsA, connectionId: connShopee.id, accountId: "shop_1", accountName: "Shop 1",
      metric: METRIC, syncJobId: "job-shopee-1",
    })!;
    await upsertCampaignMetric(payload);
    await upsertCampaignMetric({ ...payload, syncJobId: "job-shopee-2" });
    const rows = await prisma.campaignMetric.findMany({ where: { workspaceId: wsA, entityId: "1234567" } });
    assert.equal(rows.length, 1, "idempotent re-ingestion keeps one row");
    const stored = rows[0] as any;
    assert.equal(stored.shopeeBroadOrders, 10);
    assert.equal(stored.shopeeBroadUnits, 15);
    assert.equal(stored.shopeeBroadGmv, 1800000);
    assert.equal(stored.shopeeDirectOrders, 8);
    assert.equal(stored.shopeeDirectUnits, 12);
    assert.equal(stored.shopeeDirectGmv, 1500000);
    assert.equal(stored.shopeeKeywordSettingsCount, 0);
    assert.ok(stored.rawData, "rawData preserved");

    const parsed = JSON.parse(stored.rawData);
    const fromPromoted = resolveShopeeRowPerformance(stored, parsed);
    const nulled = resolveShopeeRowPerformance({ ...stored, shopeeBroadOrders: null, shopeeBroadUnits: null, shopeeBroadGmv: null, shopeeDirectOrders: null, shopeeDirectUnits: null, shopeeDirectGmv: null, shopeeKeywordSettingsCount: null }, parsed);
    assert.deepEqual(fromPromoted, nulled, "promoted-first matches legacy rawData behavior");
    assert.deepEqual(fromPromoted, {
      broadOrders: 10, broadUnits: 15, broadGmv: 1800000,
      directOrders: 8, directUnits: 12, directGmv: 1500000,
      keywordSettingsCount: 0,
    });

    const rawless = resolveShopeeRowPerformance(stored, {});
    assert.deepEqual(rawless, fromPromoted, "promoted columns work with rawData absent");
  });

  it("keeps tenant isolation and leaves rival rows untouched", async () => {
    const { rows } = await queryWarehouse({ workspaceId: wsB, limit: 100 });
    assert.equal(rows.length, 0, "workspace B sees none of workspace A's promoted rows");
  });

  it("counts raw-dependent, promoted, and partial rows without returning payloads", async () => {
    const result = await classifyRawDependencyReadiness(wsA);
    assert.ok(result.meta.rawDependent >= 1, "legacy Meta rows are still raw-dependent");
    assert.ok(result.meta.promoted >= 1, "dual-written Meta rows are promoted");
    assert.ok(result.shopee.rawDependent >= 0);
    assert.ok(result.totals.rawDependent >= 1);
    assert.equal(JSON.stringify(result).includes("First"), false, "classification never returns payload values");
    assert.equal(JSON.stringify(result).includes("Ao Thun"), false, "classification never returns payload values");
  });
});
