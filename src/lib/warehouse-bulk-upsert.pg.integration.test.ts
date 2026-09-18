import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import { withSystemScope } from "@/lib/tenant-guard";
import { upsertCampaignMetric } from "./ad-platform-ingest";
import {
  acquireMetaSyncLock,
  releaseMetaSyncLock,
  upsertMetaMetric,
} from "./meta-sync-lock";
import {
  buildMetaBulkUpsert,
  executeBulkBatch,
  flushGenericPayloadBatches,
  flushMetaPayloadBatches,
} from "./warehouse-bulk-upsert";

const suffix = `bulk-${Date.now()}-${process.pid}`;
const owner = `bulk-owner-${suffix}`;
const ws = `bulk-ws-${suffix}`;

describe("PostgreSQL integration: warehouse bulk upsert", () => {
  let db: PrismaClient | null = null;
  let isDbAvailable = false;
  let connGeneric: { id: string };
  let connMeta: { id: string };

  before(async () => {
    if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("mock")) return;
    try {
      db = new PrismaClient();
      await db.$connect();
      await withSystemScope(async () => {
        await prisma.user.create({ data: { id: owner, email: `${owner}@example.test`, name: "Bulk Owner" } });
        await prisma.workspace.create({ data: { id: ws, slug: ws, name: "Bulk WS", ownerId: owner } });
        connGeneric = await prisma.connection.create({
          data: { workspaceId: ws, name: "Bulk Google", type: "source", provider: "google_ads", credentials: "enc:v1:t", remoteAccountId: `bulk-g-${suffix}` },
        });
        connMeta = await prisma.connection.create({
          data: { workspaceId: ws, name: "Bulk Meta", type: "source", provider: "meta_ads", credentials: "enc:v1:t", remoteAccountId: `bulk-m-${suffix}` },
        });
      });
      isDbAvailable = true;
    } catch {
      isDbAvailable = false;
    }
  });

  after(async () => {
    if (!db) return;
    try {
      await withSystemScope(async () => {
        await (prisma as any).syncLock.deleteMany({ where: { workspaceId: ws } });
        await prisma.campaignMetric.deleteMany({ where: { workspaceId: ws } });
        await prisma.connection.deleteMany({ where: { workspaceId: ws } });
        await prisma.workspace.deleteMany({ where: { id: ws } });
        await prisma.user.deleteMany({ where: { id: owner } });
      });
    } finally {
      await db.$disconnect();
    }
  });

  it("stolen meta lease writes zero rows", async (t) => {
    if (!isDbAvailable) return t.skip("PostgreSQL database not reachable");
    const scope = `meta_ads:${ws}:${connMeta.id}:act_bulk`;
    const first = await acquireMetaSyncLock({ workspaceId: ws, connectionId: connMeta.id, adAccountId: "act_bulk", jobId: `bulk-1-${suffix}` });
    assert.equal(first.acquired, true);
    const stolen = first as { scope: string; leaseId: string; fencingToken: bigint };
    // Expire + steal the lease with a newer worker.
    await (prisma as any).syncLock.update({
      where: { scope },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    const second = await acquireMetaSyncLock({ workspaceId: ws, connectionId: connMeta.id, adAccountId: "act_bulk", jobId: `bulk-2-${suffix}` });
    assert.equal(second.acquired, true);
    try {
      await assert.rejects(
        executeBulkBatch(
          [{
            id: "bulk-stolen-1",
            workspaceId: ws, connectionId: connMeta.id, platform: "meta_ads", accountId: "act_bulk",
            accountName: null, level: "campaign", entityId: "stolen", campaignId: "stolen",
            campaignName: "Stolen", adsetId: "", adsetName: null, adId: "",
            date: new Date("2026-03-01T00:00:00.000Z"), breakdownHash: "none",
            impressions: 1, clicks: 1, spend: 1, reach: 0, cpc: 1, ctr: 1,
            conversions: 0, revenue: 0, roas: 0, currency: null, rawData: null,
            adName: null, shopeeBroadOrders: null, shopeeBroadUnits: null, shopeeBroadGmv: null,
            shopeeDirectOrders: null, shopeeDirectUnits: null, shopeeDirectGmv: null,
            shopeeKeywordSettingsCount: null, syncJobId: "j", lockScope: scope,
            fencingToken: stolen.fencingToken.toString(),
          }],
          (rows) => buildMetaBulkUpsert(rows, { scope, leaseId: stolen.leaseId, fencingToken: stolen.fencingToken }),
          async () => {},
          ["stolen"],
          {
            executeBulk: (sql: string, params: unknown[]) =>
              (prisma as any).$executeRawUnsafe(sql, ...params) as Promise<number>,
            findLease: async () => {
              const lock = await (prisma as any).syncLock.findUnique({
                where: { scope },
                select: { leaseId: true, fencingToken: true, status: true, leaseExpiresAt: true },
              });
              return lock;
            },
          },
          "meta",
          { leaseId: stolen.leaseId, fencingToken: stolen.fencingToken.toString() },
        ),
        /lease lost/i,
      );
      const count = await prisma.campaignMetric.count({ where: { workspaceId: ws, entityId: "stolen" } });
      assert.equal(count, 0, "stolen lease must write zero rows");
    } finally {
      const current = second.acquired
        ? (second as { scope: string; leaseId: string })
        : stolen;
      await releaseMetaSyncLock({ scope, leaseId: current.leaseId, success: true }).catch(() => undefined);
    }
  });

  it("bulk and per-row writes agree on null/NaN/Infinity handling", async (t) => {
    if (!isDbAvailable) return t.skip("PostgreSQL database not reachable");
    await upsertCampaignMetric({
      workspaceId: ws, connectionId: connGeneric.id, platform: "google_ads",
      accountId: "act_null", level: "campaign", entityId: "per-row", campaignId: "per-row",
      date: new Date("2026-03-02T00:00:00.000Z"),
      impressions: NaN, clicks: Infinity, spend: -4, cpc: NaN, ctr: NaN, conversions: -1,
      currency: undefined, rawData: { note: "edge" },
    });
    const outcome = await flushGenericPayloadBatches(
      [{
        workspaceId: ws, connectionId: connGeneric.id, platform: "google_ads",
        accountId: "act_null", level: "campaign", entityId: "bulk", campaignId: "bulk",
        date: new Date("2026-03-02T00:00:00.000Z"),
        impressions: NaN, clicks: Infinity, spend: -4, cpc: NaN, ctr: NaN, conversions: -1,
        currency: undefined, rawData: { note: "edge" },
      }],
      { fallbackRow: (p) => upsertCampaignMetric(p) },
    );
    assert.equal(outcome.failed, 0);
    const rows = await prisma.campaignMetric.findMany({
      where: { workspaceId: ws, entityId: { in: ["per-row", "bulk"] } },
    });
    const byEntity = new Map(rows.map((row: any) => [row.entityId, row]));
    const perRow = byEntity.get("per-row") as any;
    const bulk = byEntity.get("bulk") as any;
    for (const field of ["impressions", "clicks", "spend", "cpc", "ctr", "conversions", "revenue", "currency"]) {
      assert.deepEqual(bulk[field], perRow[field], `${field} matches the per-row path`);
    }
  });

  it("bulk upserts are idempotent under the conflict key", async (t) => {
    if (!isDbAvailable) return t.skip("PostgreSQL database not reachable");
    const payload = {
      workspaceId: ws, connectionId: connGeneric.id, platform: "google_ads",
      accountId: "act_idem", level: "campaign", entityId: "idem", campaignId: "idem",
      date: new Date("2026-03-03T00:00:00.000Z"),
      impressions: 5, clicks: 2, spend: 9, cpc: 4.5, ctr: 40, conversions: 1,
    };
    for (let i = 0; i < 2; i++) {
      const outcome = await flushGenericPayloadBatches([payload], {
        fallbackRow: (p) => upsertCampaignMetric(p),
      });
      assert.equal(outcome.failed, 0);
    }
    const count = await prisma.campaignMetric.count({ where: { workspaceId: ws, entityId: "idem" } });
    assert.equal(count, 1, "repeated bulk writes keep one row per unique key");
  });

  it("poison rows fall back without losing the batch", async (t) => {
    if (!isDbAvailable) return t.skip("PostgreSQL database not reachable");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const outcome = await flushGenericPayloadBatches(
      [
        {
          workspaceId: ws, connectionId: connGeneric.id, platform: "google_ads",
          accountId: "act_poison", level: "campaign", entityId: "good", campaignId: "good",
          date: new Date("2026-03-04T00:00:00.000Z"),
          impressions: 1, clicks: 1, spend: 1, cpc: 1, ctr: 1, conversions: 0,
        },
        {
          workspaceId: ws, connectionId: connGeneric.id, platform: "google_ads",
          accountId: "act_poison", level: "campaign", entityId: "poison", campaignId: "poison",
          date: new Date("2026-03-04T00:00:00.000Z"),
          impressions: 1, clicks: 1, spend: 1, cpc: 1, ctr: 1, conversions: 0,
          rawData: circular,
        } as any,
      ],
      { fallbackRow: (p) => upsertCampaignMetric(p) },
    );
    assert.equal(outcome.upserted, 1, "good row written");
    assert.equal(outcome.failed, 1, "poison row attributed");
    const good = await prisma.campaignMetric.count({ where: { workspaceId: ws, entityId: "good" } });
    assert.equal(good, 1);
  });

  it("meta bulk happy path writes fenced rows", async (t) => {
    if (!isDbAvailable) return t.skip("PostgreSQL database not reachable");
    const acquired = await acquireMetaSyncLock({ workspaceId: ws, connectionId: connMeta.id, adAccountId: "act_ok", jobId: `bulk-ok-${suffix}` });
    assert.equal(acquired.acquired, true);
    const lease = acquired as { scope: string; leaseId: string; fencingToken: bigint };
    try {
      const outcome = await flushMetaPayloadBatches(
        [{
          workspaceId: ws, connectionId: connMeta.id, accountId: "act_ok",
          level: "campaign", entityId: "meta_ok", campaignId: "meta_ok", campaignName: "Meta OK",
          adsetId: "", adsetName: "", adId: "", adName: "Bulk Ad",
          date: new Date("2026-03-05T00:00:00.000Z"), breakdownHash: "none",
          metrics: { impressions: 3, clicks: 1, spend: 2, reach: 0, cpc: 2, ctr: 1, conversions: 0, revenue: 0, roas: 0, rawData: { ad_name: "Bulk Ad" } },
          syncJobId: "j",
        }],
        {
          lease: { scope: lease.scope, leaseId: lease.leaseId, fencingToken: lease.fencingToken },
          fallbackRow: (row) => upsertMetaMetric({
            workspaceId: row.workspaceId, connectionId: row.connectionId, accountId: row.accountId,
            accountName: row.accountName, level: row.level, entityId: row.entityId,
            campaignId: row.campaignId, campaignName: row.campaignName, adsetId: row.adsetId,
            adsetName: row.adsetName, adId: row.adId, adName: row.adName, date: row.date,
            breakdownHash: row.breakdownHash, metrics: row.metrics, syncJobId: row.syncJobId,
            lockScope: lease.scope, leaseId: lease.leaseId, fencingToken: lease.fencingToken,
          }),
        },
      );
      assert.equal(outcome.failed, 0);
      assert.equal(outcome.fallbacks, 0, "happy path stays on the bulk statement");
      const row = await prisma.campaignMetric.findFirstOrThrow({ where: { workspaceId: ws, entityId: "meta_ok" } });
      assert.equal((row as any).adName, "Bulk Ad");
      assert.equal(BigInt((row as any).fencingToken).toString(), lease.fencingToken.toString());
    } finally {
      await releaseMetaSyncLock({ scope: lease.scope, leaseId: lease.leaseId, success: true }).catch(() => undefined);
    }
  });
});
