import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import { withSystemScope } from "@/lib/tenant-guard";
import { measureCampaignMetricRawRetention } from "./warehouse-raw-retention";

const now = new Date("2026-09-18T12:00:00.000Z");
const wsA = "raw-retention-ws-a";
const wsB = "raw-retention-ws-b";
const wsC = "raw-retention-ws-c";
const wsD = "raw-retention-ws-d";
const connA = "raw-retention-conn-a";
const connB = "raw-retention-conn-b";
const connC = "raw-retention-conn-c";
const connD = "raw-retention-conn-d";

// Second client modeling a concurrent warehouse import: it commits through a
// different connection while the dry-run measurement transaction is open.
const writerDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

function metric(input: Partial<any> & { id: string; workspaceId: string; connectionId: string }) {
  return {
    platform: "meta_ads", accountId: "account", level: "campaign", entityId: input.id,
    campaignId: input.id, campaignName: input.id, date: new Date("2022-01-01T00:00:00.000Z"),
    rawData: '{"ad_name":"kept inside database only"}', pulledAt: new Date("2026-08-01T00:00:00.000Z"),
    ...input,
  };
}

describe("PostgreSQL: raw retention dry-run", () => {
  before(async () => {
    await withSystemScope(async () => {
      await prisma.campaignMetric.deleteMany({ where: { workspaceId: { in: [wsA, wsB, wsC, wsD] } } });
      await prisma.retailOrder.deleteMany({ where: { workspaceId: { in: [wsA, wsB, wsC, wsD] } } });
      await prisma.connection.deleteMany({ where: { id: { in: [connA, connB, connC, connD] } } });
      await prisma.workspace.deleteMany({ where: { id: { in: [wsA, wsB, wsC, wsD] } } });
    });
    await prisma.workspace.createMany({ data: [
      { id: wsA, slug: wsA, name: "A", ownerId: "raw-retention-owner" },
      { id: wsB, slug: wsB, name: "B", ownerId: "raw-retention-owner" },
      { id: wsC, slug: wsC, name: "C", ownerId: "raw-retention-owner" },
      { id: wsD, slug: wsD, name: "D", ownerId: "raw-retention-owner" },
    ] });
    await prisma.connection.createMany({ data: [
      { id: connA, workspaceId: wsA, name: "A", type: "source", provider: "meta_ads", credentials: "synthetic", remoteAccountId: "a" },
      { id: connB, workspaceId: wsB, name: "B", type: "source", provider: "google_ads", credentials: "synthetic", remoteAccountId: "b" },
      { id: connC, workspaceId: wsC, name: "C", type: "source", provider: "meta_ads", credentials: "synthetic", remoteAccountId: "c" },
      { id: connD, workspaceId: wsD, name: "D", type: "source", provider: "meta_ads", credentials: "synthetic", remoteAccountId: "d" },
    ] });
    await prisma.campaignMetric.createMany({ data: [
      metric({ id: "a-before", workspaceId: wsA, connectionId: connA, pulledAt: new Date("2026-08-19T11:59:59.999Z") }),
      metric({ id: "a-cutoff", workspaceId: wsA, connectionId: connA, pulledAt: new Date("2026-08-19T12:00:00.000Z") }),
      metric({ id: "a-old-imported-now", workspaceId: wsA, connectionId: connA, date: new Date("2024-09-18T00:00:00.000Z"), pulledAt: now }),
      metric({ id: "a-late-correction", workspaceId: wsA, connectionId: connA, platform: "tiktok_business", date: new Date("2020-01-01T00:00:00.000Z"), pulledAt: new Date("2026-09-17T00:00:00.000Z") }),
      metric({ id: "a-null", workspaceId: wsA, connectionId: connA, platform: "google_ads", rawData: null, pulledAt: new Date("2026-01-01T00:00:00.000Z") }),
      metric({ id: "a-malformed", workspaceId: wsA, connectionId: connA, platform: "lazada", rawData: "{ malformed", pulledAt: new Date("2026-08-01T00:00:00.000Z") }),
      metric({ id: "a-shopee", workspaceId: wsA, connectionId: connA, platform: "shopee", rawData: '{"broad_metrics":{},"direct_metrics":{},"keyword_settings_count":2}', pulledAt: new Date("2026-08-01T00:00:00.000Z") }),
      metric({ id: "b-old", workspaceId: wsB, connectionId: connB, platform: "google_ads", pulledAt: new Date("2026-01-01T00:00:00.000Z") }),
    ] });
    await prisma.campaignMetric.createMany({ data: [
      metric({ id: "d-base-0", workspaceId: wsD, connectionId: connD, rawData: '{"ad_name":"CONCURRENT_SECRET_D0"}' }),
      metric({ id: "d-base-1", workspaceId: wsD, connectionId: connD, platform: "google_ads", rawData: '{"impressions":7}' }),
    ] });
    const bulk = Array.from({ length: 500 }, (_, index) => metric({
      id: `c-bulk-${index}`, workspaceId: wsC, connectionId: connC,
      entityId: `c-bulk-${index}`, campaignId: `c-bulk-${index}`, campaignName: `c-bulk-${index}`,
      rawData: `{"ad_name":"bulk ${index}"}`, pulledAt: new Date("2026-01-01T00:00:00.000Z"),
    }));
    await prisma.campaignMetric.createMany({ data: bulk });
    await prisma.retailOrder.create({ data: { workspaceId: wsA, connectionId: connA, platform: "shopee", orderId: "raw-retention-order", createdAtIso: "2026-01-01", currency: "VND", grossRevenue: 1, rawData: "RETAIL_SECRET" } });
  });

  after(async () => { await writerDb.$disconnect(); await prisma.$disconnect(); });

  it("holds one snapshot when an import commits mid-measurement", async () => {
    let hookCalls = 0;
    // Ordered by awaits, not sleeps: the hook runs inside the measurement
    // transaction after the summary query, commits the writer row through the
    // second client, and only then lets measurement continue.
    const result = await (measureCampaignMetricRawRetention as any)(
      { workspaceId: wsD, retentionDays: 30, sampleSize: 10, now },
      prisma,
      {
        afterSummary: async () => {
          hookCalls++;
          await writerDb.campaignMetric.create({
            data: metric({ id: "d-concurrent-1", workspaceId: wsD, connectionId: connD, rawData: '{"late":true}' }),
          });
        },
      },
    );
    assert.equal(hookCalls, 1, "the hook must run once inside the measurement transaction");
    assert.equal(result.exactEligibleRowCount, 2, "summary must not see the mid-measurement commit");
    const perPlatformSum = result.perPlatform.reduce((sum: number, row: any) => sum + row.exactEligibleRowCount, 0);
    assert.equal(perPlatformSum, result.exactEligibleRowCount, "sections must agree within one snapshot");
    assert.equal(result.eligibleByteEstimate.evidence, "exact", "exact bytes must describe the snapshot population");
    assert.equal(result.eligibleByteEstimate.sampleRows, 2);
    assert.equal(JSON.stringify(result).includes("CONCURRENT_SECRET_D0"), false, "no raw payload values leak");

    const next = await measureCampaignMetricRawRetention({ workspaceId: wsD, retentionDays: 30, sampleSize: 10, now });
    assert.equal(next.exactEligibleRowCount, 3, "a new invocation observes the committed import");
    const nextSum = next.perPlatform.reduce((sum: number, row: any) => sum + row.exactEligibleRowCount, 0);
    assert.equal(nextSum, 3);
  });

  it("uses pulledAt strictly, isolates tenants, classifies readers, and makes zero writes", async () => {
    const before = await Promise.all([
      prisma.campaignMetric.findMany({ where: { workspaceId: wsA }, orderBy: { id: "asc" }, select: { id: true, rawData: true, pulledAt: true } }),
      prisma.auditEvent.count({ where: { workspaceId: wsA } }),
      prisma.warehouseImportJob.count({ where: { workspaceId: wsA } }),
      prisma.warehouseBackfillChunk.count({ where: { workspaceId: wsA } }),
      prisma.syncCheckpoint.count(),
      prisma.retailOrder.findUnique({ where: { connectionId_orderId: { connectionId: connA, orderId: "raw-retention-order" } }, select: { rawData: true } }),
    ]);
    const result = await measureCampaignMetricRawRetention({ workspaceId: wsA, retentionDays: 30, sampleSize: 10, now });
    assert.equal(result.exactEligibleRowCount, 3, "one ms before cutoff plus malformed and Shopee rows");
    assert.equal(result.totalRawBearingRows, 6, "null rawData is excluded");
    assert.equal(result.knownReaderImpact.metaAdNameRows, 1);
    assert.equal(result.knownReaderImpact.shopeeBroadMetricRows, 1);
    assert.equal(result.knownReaderImpact.shopeeDirectMetricRows, 1);
    assert.equal(result.knownReaderImpact.shopeeKeywordRows, 1);
    assert.equal(result.eligibleRange.oldestProviderDate, "2022-01-01T00:00:00.000Z");
    assert.equal(result.eligibleByteEstimate.evidence, "exact", "a small set covered by the sample cap is fully measured");
    assert.equal(result.eligibleByteEstimate.sampleMethod, "bounded-unsorted-scan");
    assert.ok((result.eligibleByteEstimate.bytes ?? 0) > 0);
    assert.equal(JSON.stringify(result).includes("kept inside database only"), false);
    assert.equal(JSON.stringify(result).includes("malformed"), false);
    assert.equal(result.perPlatform.find((x) => x.platform === "meta_ads")?.exactEligibleRowCount, 1);
    assert.equal(result.perPlatform.find((x) => x.platform === "meta_ads")?.sampledByteEstimate.evidence, "exact");

    const filtered = await measureCampaignMetricRawRetention({ workspaceId: wsA, retentionDays: 30, platform: "shopee", now });
    assert.equal(filtered.exactEligibleRowCount, 1);
    assert.deepEqual(filtered.perPlatform.map((x) => x.platform), ["shopee"]);
    const other = await measureCampaignMetricRawRetention({ workspaceId: wsB, retentionDays: 30, now });
    assert.equal(other.exactEligibleRowCount, 1);

    const after = await Promise.all([
      prisma.campaignMetric.findMany({ where: { workspaceId: wsA }, orderBy: { id: "asc" }, select: { id: true, rawData: true, pulledAt: true } }),
      prisma.auditEvent.count({ where: { workspaceId: wsA } }),
      prisma.warehouseImportJob.count({ where: { workspaceId: wsA } }),
      prisma.warehouseBackfillChunk.count({ where: { workspaceId: wsA } }),
      prisma.syncCheckpoint.count(),
      prisma.retailOrder.findUnique({ where: { connectionId_orderId: { connectionId: connA, orderId: "raw-retention-order" } }, select: { rawData: true } }),
    ]);
    assert.deepEqual(after, before, "dry-run does not mutate metrics, audit/jobs/chunks, or RetailOrder");
  });

  it("samples large eligible sets without ranking or sorting the candidate population", async () => {
    const beforeCount = await prisma.campaignMetric.count({ where: { workspaceId: wsC } });
    const result = await measureCampaignMetricRawRetention({ workspaceId: wsC, retentionDays: 30, sampleSize: 50, now });
    assert.equal(result.exactEligibleRowCount, 500, "exact counts are unaffected by byte sampling");
    assert.equal(result.byteSampling.method, "tablesample-system-10");
    assert.equal(result.byteSampling.sampleLimit, 50);
    assert.ok(result.byteSampling.sampleRows <= 50, "the row cap is enforced before aggregation");
    assert.ok(
      result.eligibleByteEstimate.evidence === "sampled" || result.eligibleByteEstimate.evidence === "unknown",
      "a physical page sample is never labeled exact",
    );
    if (result.eligibleByteEstimate.evidence === "unknown") {
      assert.equal(result.eligibleByteEstimate.bytes, null, "no false zero-byte estimate");
    }
    assert.equal(JSON.stringify(result).includes("bulk"), false, "no raw payload contents leak");
    const afterCount = await prisma.campaignMetric.count({ where: { workspaceId: wsC } });
    assert.equal(afterCount, beforeCount, "sampling performs no writes");

    // Plan probe mirroring the service sampler: physical page sampling plus a
    // hard row cap, with no window function and no sort of the candidates.
    const plan = await prisma.$queryRawUnsafe<Array<{ plan: unknown }>>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       SELECT "platform", octet_length("rawData") AS bytes
       FROM "CampaignMetric" TABLESAMPLE SYSTEM (10)
       WHERE "workspaceId" = $1 AND "rawData" IS NOT NULL AND "pulledAt" < $2::timestamptz
       LIMIT 50`,
      wsC,
      new Date(now.getTime() - 30 * 86_400_000).toISOString(),
    );
    const planText = JSON.stringify(plan);
    assert.equal(planText.includes("WindowAgg"), false, "sample plan must not rank rows");
    assert.ok(!/"Node Type":\s*"Sort"/.test(planText), "sample plan must not sort the candidate population");
  });
});
