import assert from "node:assert/strict";
import { assertAllowedTestDatabase, assertCiDatabaseReachable, assertCiDatabaseReachableWhenMissing } from "./pg-test-discipline";
import { describe, it, before, after } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  evaluateServingGate,
  modelCapacityScenario,
  CAPACITY_SCENARIOS,
} from "./extended-backfill-qualification";
import { queryWarehouse, HARD_LIMIT } from "./warehouse-query";

const WS = ["ws_qual_a", "ws_qual_b", "ws_qual_c", "ws_qual_d", "ws_qual_e",
  "ws_qual_f", "ws_qual_g", "ws_qual_h", "ws_qual_i", "ws_qual_j"] as const;
const OWNER = "usr_qual_owner";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = process.hrtime.bigint();
  const result = await fn();
  return { result, ms: Number(process.hrtime.bigint() - start) / 1_000_000 };
}

describe("PostgreSQL Integration: extended-backfill staging qualification", () => {
  let prisma: PrismaClient | null = null;
  let isDbAvailable = false;

  function requireDb(t: any) {
    if (!isDbAvailable) {
      t.skip("PostgreSQL database not reachable; run with real DATABASE_URL in CI");
      return false;
    }
    return true;
  }

  before(async () => {
    assertCiDatabaseReachableWhenMissing();
    // Fail closed on any non-disposable database: this suite bulk-seeds
    // ~790k rows and must never run against production.
    assertAllowedTestDatabase(process.env.DATABASE_URL);
    if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("mock")) {
      try {
        prisma = new PrismaClient();
        await prisma.$connect();
        await prisma.$queryRaw`SELECT 1`;
        isDbAvailable = true;
        await prisma.user.upsert({ where: { id: OWNER }, update: {}, create: { id: OWNER, email: "qual@example.com" } });
      } catch {
        assertCiDatabaseReachable();
        isDbAvailable = false;
      }
    }
  });

  after(async () => {
    if (prisma && isDbAvailable) {
      try {
        await prisma.warehouseBackfillChunk.deleteMany({ where: { workspaceId: { startsWith: "ws_qual_" } } });
        await prisma.campaignMetric.deleteMany({ where: { workspaceId: { startsWith: "ws_qual_" } } });
        await prisma.warehouseImportJob.deleteMany({ where: { workspaceId: { startsWith: "ws_qual_" } } });
        await prisma.connection.deleteMany({ where: { workspaceId: { startsWith: "ws_qual_" } } });
        await prisma.workspace.deleteMany({ where: { id: { startsWith: "ws_qual_" } } });
        await prisma.$disconnect();
      } catch {}
    }
  });

  async function seedFixtures() {
    const db = prisma!;
    for (const ws of WS) {
      await db.workspace.upsert({
        where: { id: ws }, update: {},
        create: { id: ws, name: ws, slug: `${ws}-slug`, ownerId: OWNER, plan: "pilot" },
      });
      for (const provider of ["meta_ads", "google_ads"]) {
        await db.connection.upsert({
          where: { workspaceId_provider_remoteAccountId: { workspaceId: ws, provider, remoteAccountId: `remote-${ws}-${provider}` } },
          update: {},
          create: { id: `conn-${ws}-${provider}`, workspaceId: ws, name: `${ws}-${provider}`, type: "source", provider, credentials: "{}", remoteAccountId: `remote-${ws}-${provider}`, status: "connected" },
        });
      }
    }
    // Modest chunk population so progress-polling plans are representative
    // (20 jobs x 50 chunks across two workspaces).
    for (const ws of [WS[0]!, WS[1]!]) {
      for (let job = 0; job < 10; job += 1) {
        const jobId = `qjob-${ws}-${job}`;
        await db.warehouseImportJob.upsert({
          where: { id: jobId },
          update: {},
          create: {
            id: jobId, workspaceId: ws, userId: OWNER, plan: "pilot",
            since: "2024-01-01", until: "2024-02-19",
            items: [{ connectionId: `conn-${ws}-google_ads` }],
            totalItems: 1, status: job % 2 === 0 ? "completed" : "queued",
            idempotencyKey: `qkey-${ws}-${job}`,
          },
        });
        const rows: any[] = [];
        for (let ordinal = 0; ordinal < 50; ordinal += 1) {
          const day = new Date(Date.UTC(2024, 0, 1 + ordinal)).toISOString().slice(0, 10);
          rows.push({
            id: `qchk-${ws}-${job}-${ordinal}`,
            workspaceId: ws, jobId,
            connectionId: `conn-${ws}-google_ads`, provider: "google_ads", accountId: "",
            since: day, until: day, ordinal,
            status: job % 2 === 0 ? "completed" : "queued",
            persistedRows: job % 2 === 0 ? 2 : 0,
            completedAt: job % 2 === 0 ? new Date() : null,
          });
        }
        await db.warehouseBackfillChunk.createMany({ data: rows, skipDuplicates: true });
      }
    }
  }

  async function seedMetrics(days: number, entitiesPerDay: number, workspaces: readonly string[]) {
    const db = prisma!;
    for (const [wsIndex, ws] of workspaces.entries()) {
      for (const [providerIndex, provider] of ["meta_ads", "google_ads"].entries()) {
        const connectionId = `conn-${ws}-${provider}`;
        await db.$executeRawUnsafe(
          `INSERT INTO "CampaignMetric"
             ("id", "workspaceId", "connectionId", "platform", "accountId", "accountName", "level", "entityId", "campaignId", "campaignName", "date", "impressions", "clicks", "spend", "conversions", "revenue", "currency", "breakdownHash", "pulledAt", "createdAt")
           SELECT 'qb-' || $1 || '-' || $3 || '-' || g.d || '-' || h.e, $1, $2, $3, 'bench-acct-' || (h.e % 5), 'Bench', 'campaign',
                  'bench-camp-' || h.e || '-' || g.d, 'bench-camp-' || h.e || '-' || g.d, 'Bench Camp',
                  (DATE '2024-01-01' + (g.d || ' days')::interval),
                  100 + h.e, 10 + h.e, 5.5, 1, 11.0, 'USD', 'none', NOW(), NOW()
           FROM generate_series(0, $4 - 1) AS g(d) CROSS JOIN generate_series(1, $5) AS h(e)
           ON CONFLICT DO NOTHING`,
          ws, connectionId, provider, days, entitiesPerDay, wsIndex, providerIndex,
        );
      }
    }
  }

  it("seeds small, medium, and large datasets within bounded time", async (t) => {
    if (!requireDb(t)) return;
    const db = prisma!;
    await seedFixtures();
    // Dataset 1 (small pilot subset): 1 ws x 2 conn x 30d x 20 entities.
    let run = await timed(() => seedMetrics(30, 20, [WS[0]!]));
    const small = await db.campaignMetric.count({ where: { workspaceId: WS[0]! } });
    assert.equal(small, 1 * 2 * 30 * 20);
    console.log(`dataset small: ${small} rows in ${run.ms.toFixed(0)}ms`);
    // Dataset 2 (medium growth subset): +4 ws x 2 conn x 365d x 20 entities.
    run = await timed(() => seedMetrics(365, 20, [WS[1]!, WS[2]!, WS[3]!, WS[4]!]));
    const medium = await db.campaignMetric.count({ where: { workspaceId: { in: [WS[1]!, WS[2]!, WS[3]!, WS[4]!] } } });
    assert.equal(medium, 4 * 2 * 365 * 20);
    console.log(`dataset medium: ${medium} rows in ${run.ms.toFixed(0)}ms`);
    // Dataset 3 (large, bounded): +5 ws x 2 conn x 731d x 100 entities.
    run = await timed(() => seedMetrics(731, 100, [WS[5]!, WS[6]!, WS[7]!, WS[8]!, WS[9]!]));
    const large = await db.campaignMetric.count({ where: { workspaceId: { in: [WS[5]!, WS[6]!, WS[7]!, WS[8]!, WS[9]!] } } });
    assert.equal(large, 5 * 2 * 731 * 100);
    console.log(`dataset large: ${large} rows in ${run.ms.toFixed(0)}ms`);
    const total = await db.campaignMetric.count({ where: { workspaceId: { startsWith: "ws_qual_" } } });
    console.log(`dataset total: ${total} rows`);
    assert.ok(total >= 750_000, `expected a large representative dataset, got ${total}`);
  });

  it("measures stored row size against schema expectations", async (t) => {
    if (!requireDb(t)) return;
    const db = prisma!;
    const sized = (await db.$queryRawUnsafe(
      `SELECT AVG(pg_column_size("CampaignMetric".*))::int AS avg_row FROM "CampaignMetric" TABLESAMPLE SYSTEM (5)`,
    )) as any[];
    const avgRow = Number(sized[0]?.avg_row ?? 0);
    console.log(`measured avg CampaignMetric row: ${avgRow} bytes`);
    assert.ok(avgRow > 150 && avgRow < 2500, `unexpected row width ${avgRow}`);
    const rel = (await db.$queryRawUnsafe(
      `SELECT pg_relation_size('"CampaignMetric"')::bigint AS heap, pg_indexes_size('"CampaignMetric"')::bigint AS idx`,
    )) as any[];
    const heap = Number(rel[0]?.heap ?? 0);
    const idx = Number(rel[0]?.idx ?? 0);
    console.log(`heap=${heap} index=${idx} overhead=${(idx / Math.max(1, heap)).toFixed(2)}`);
    assert.ok(heap > 0 && idx >= 0);
  });

  it("serves 30/365/731-day, aggregate, filtered, count, and polling queries within proposed gates", async (t) => {
    if (!requireDb(t)) return;
    const db = prisma!;
    const ws = WS[5]!;
    async function measure(label: string, fn: () => Promise<{ rows: number }>, bounded: boolean) {
      const samples: number[] = [];
      let rows = 0;
      for (let i = 0; i < 11; i += 1) {
        const { result, ms } = await timed(fn);
        rows = result.rows;
        samples.push(ms);
      }
      samples.sort((a, b) => a - b);
      return { label, p50: percentile(samples, 50), p95: percentile(samples, 95), rows, bounded };
    }
    async function explainOf(label: string, sql: string, params: unknown[]) {
      const rows = (await db.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, ...(params as any[]))) as any[];
      const planText = rows.map((row) => row["QUERY PLAN"]).join("\n");
      console.log(`--- ${label} ---\n${planText}`);
      return planText;
    }
    function assertIndexServed(label: string, planText: string, table: string) {
      assert.ok(!planText.includes(`Seq Scan on "${table}"`), `${label} must not seq-scan ${table}:\n${planText}`);
      assert.ok(planText.includes("Index"), `${label} must use an index:\n${planText}`);
    }
    const start30 = new Date("2025-12-02T00:00:00.000Z");
    const end30 = new Date("2025-12-31T00:00:00.000Z");
    const start365 = new Date("2025-01-01T00:00:00.000Z");
    const end365 = new Date("2025-12-31T00:00:00.000Z");
    const start731 = new Date("2024-01-01T00:00:00.000Z");
    const end731 = new Date("2025-12-31T00:00:00.000Z");

    const m30 = await measure("30-day filtered query", async () => ({
      rows: await db.campaignMetric.count({ where: { workspaceId: ws, platform: "google_ads", date: { gte: start30, lte: end30 } } }),
    }), true);
    const m365 = await measure("365-day provider query", async () => ({
      rows: await db.campaignMetric.count({ where: { workspaceId: ws, platform: "google_ads", date: { gte: start365, lte: end365 } } }),
    }), true);
    const m731 = await measure("731-day provider query", async () => ({
      rows: await db.campaignMetric.count({ where: { workspaceId: ws, platform: "google_ads", date: { gte: start731, lte: end731 } } }),
    }), true);
    const mAgg = await measure("731-day cross-provider aggregate", async () => {
      const grouped = await db.campaignMetric.groupBy({ by: ["platform"], where: { workspaceId: ws, date: { gte: start731, lte: end731 } }, _sum: { impressions: true } });
      return { rows: grouped.length };
    }, true);
    const mAcct = await measure("account-filtered aggregate", async () => {
      const grouped = await db.campaignMetric.groupBy({ by: ["accountId"], where: { workspaceId: ws, accountId: "bench-acct-0", date: { gte: start731, lte: end731 } }, _sum: { spend: true } });
      return { rows: grouped.length };
    }, true);
    const mCount = await measure("count/pagination query", async () => {
      const rows = await db.campaignMetric.findMany({ where: { workspaceId: ws, date: { gte: start365 } }, take: 100, orderBy: { date: "desc" } });
      return { rows: rows.length };
    }, true);
    // Full-row interactive page through the production query path: exercises
    // real serialization cost, unlike the count shapes above.
    const mPage = await measure("731-day interactive page (1000 rows)", async () => {
      const res: any = await queryWarehouse(
        { workspaceId: ws, platforms: ["google_ads"], startDate: start731, endDate: end731, limit: 1000 } as any,
        prisma as any,
      );
      return { rows: res.rows.length };
    }, true);
    assert.equal(mPage.rows, 1000);
    // Production polling shape: per-job chunk list (workspace + job scope),
    // not a workspace-wide count.
    const mMinMax = await measure("range-endpoint aggregate", async () => {
      const rows = (await db.$queryRawUnsafe(
        `SELECT MIN("date"), MAX("date"), MAX("pulledAt") FROM "CampaignMetric" WHERE "workspaceId" = $1 AND "platform" = $2 AND "date" >= $3 AND "date" <= $4`,
        ws, "google_ads", start731, end731,
      )) as any[];
      return { rows: rows.length };
    }, true);
    const mDistinct = await measure("distinct platforms", async () => {
      const rows = (await db.$queryRawUnsafe(
        `SELECT DISTINCT "platform" FROM "CampaignMetric" WHERE "workspaceId" = $1 AND "date" >= $2 AND "date" <= $3 LIMIT 50`,
        ws, start731, end731,
      )) as any[];
      return { rows: rows.length };
    }, true);
    const mPoll = await measure("job-progress-polling", async () => {
      const rows = await db.warehouseBackfillChunk.findMany({
        where: { workspaceId: WS[0]!, jobId: `qjob-${WS[0]}-0` },
        orderBy: { ordinal: "asc" },
      });
      return { rows: rows.length };
    }, true);

    for (const m of [m30, m365, m731, mAgg, mAcct, mCount, mPage, mMinMax, mDistinct, mPoll]) {
      console.log(`${m.label}: p50=${m.p50.toFixed(1)}ms p95=${m.p95.toFixed(1)}ms rows=${m.rows}`);
    }
    // Representative plans for the audited shapes. Sequential-scan flags fed
    // to the gate verdicts below come from these measured plans, never from
    // hardcoded values.
    const plans: Array<[string, string, unknown[]]> = [
      ["metrics-30-day", `SELECT COUNT(*) FROM "CampaignMetric" WHERE "workspaceId" = $1 AND "platform" = $2 AND "date" >= $3 AND "date" <= $4`, [ws, "google_ads", start30, end30]],
      ["metrics-365-day", `SELECT COUNT(*) FROM "CampaignMetric" WHERE "workspaceId" = $1 AND "platform" = $2 AND "date" >= $3 AND "date" <= $4`, [ws, "google_ads", start365, end365]],
      ["metrics-731-day", `SELECT COUNT(*) FROM "CampaignMetric" WHERE "workspaceId" = $1 AND "platform" = $2 AND "date" >= $3 AND "date" <= $4`, [ws, "google_ads", start731, end731]],
      ["metrics-cross-provider", `SELECT "platform", SUM("impressions") FROM "CampaignMetric" WHERE "workspaceId" = $1 AND "date" >= $2 AND "date" <= $3 GROUP BY "platform"`, [ws, start731, end731]],
      ["metrics-account-filtered", `SELECT "accountId", SUM("spend") FROM "CampaignMetric" WHERE "workspaceId" = $1 AND "accountId" = $2 AND "date" >= $3 AND "date" <= $4 GROUP BY "accountId"`, [ws, "bench-acct-0", start731, end731]],
      ["metrics-page", `SELECT * FROM "CampaignMetric" WHERE "workspaceId" = $1 AND "platform" = $2 AND "date" >= $3 AND "date" <= $4 ORDER BY "date" DESC, "id" DESC LIMIT 1000`, [ws, "google_ads", start731, end731]],
      ["metrics-count-pagination", `SELECT * FROM "CampaignMetric" WHERE "workspaceId" = $1 AND "date" >= $2 ORDER BY "date" DESC LIMIT 100`, [ws, start365]],
      ["metrics-distinct-platforms", `SELECT DISTINCT "platform" FROM "CampaignMetric" WHERE "workspaceId" = $1 AND "date" >= $2 AND "date" <= $3 LIMIT 50`, [ws, start731, end731]],
      ["metrics-count-companion", `SELECT COUNT(*) FROM "CampaignMetric" WHERE "workspaceId" = $1 AND "platform" = $2 AND "date" >= $3 AND "date" <= $4`, [ws, "google_ads", start731, end731]],
      ["metrics-minmax-companion", `SELECT MIN("date"), MAX("date"), MAX("pulledAt") FROM "CampaignMetric" WHERE "workspaceId" = $1 AND "platform" = $2 AND "date" >= $3 AND "date" <= $4`, [ws, "google_ads", start731, end731]],
      ["job-progress-polling", `SELECT "id", "status", "persistedRows", "ordinal" FROM "WarehouseBackfillChunk" WHERE "workspaceId" = $1 AND "jobId" = $2 ORDER BY "ordinal" ASC`, [WS[0]!, `qjob-${WS[0]}-0`]],
    ];
    const planTexts: Record<string, string> = {};
    // Full-range rollups must visit every in-range row without a
    // precomputed structure, so they are evaluated through the justified
    // full-scan exception in their verdicts rather than the index assertion.
    const aggregateException = new Set(["metrics-cross-provider", "metrics-minmax-companion", "metrics-distinct-platforms"]);
    for (const [label, sql, params] of plans) {
      const planText = await explainOf(label, sql, params);
      planTexts[label] = planText;
      if (aggregateException.has(label)) continue;
      assertIndexServed(label, planText, label === "job-progress-polling" ? "WarehouseBackfillChunk" : "CampaignMetric");
    }
    const seqScan = (label: string, table: string) => planTexts[label]!.includes(`Seq Scan on "${table}"`);
    // Rollup aggregates visit every row in the range by construction; the
    // full scan is the expected plan shape for them, recorded with
    // justification rather than hidden. Precomputed rollups remain the
    // documented answer at larger scale.
    const verdicts = [
      evaluateServingGate({ query: m30.label, p50Ms: m30.p50, p95Ms: m30.p95, rowCount: m30.rows, sequentialScan: seqScan("metrics-30-day", "CampaignMetric"), bounded: true }),
      evaluateServingGate({ query: m365.label, p50Ms: m365.p50, p95Ms: m365.p95, rowCount: m365.rows, sequentialScan: seqScan("metrics-365-day", "CampaignMetric"), bounded: true }),
      evaluateServingGate({ query: m731.label, p50Ms: m731.p50, p95Ms: m731.p95, rowCount: m731.rows, sequentialScan: seqScan("metrics-731-day", "CampaignMetric"), bounded: true }),
      evaluateServingGate({ query: mAgg.label, p50Ms: mAgg.p50, p95Ms: mAgg.p95, rowCount: mAgg.rows, sequentialScan: seqScan("metrics-cross-provider", "CampaignMetric"), bounded: true, allowFullScan: true, fullScanJustification: "Full-range two-group aggregate must visit every in-range row; no B-tree avoids that without a precomputed rollup." }),
      evaluateServingGate({ query: mMinMax.label, p50Ms: mMinMax.p50, p95Ms: mMinMax.p95, rowCount: mMinMax.rows, sequentialScan: seqScan("metrics-minmax-companion", "CampaignMetric"), bounded: true, allowFullScan: true, fullScanJustification: "Range-endpoint rollup must visit in-range rows to compute extrema without a precomputed rollup." }),
      evaluateServingGate({ query: mAcct.label, p50Ms: mAcct.p50, p95Ms: mAcct.p95, rowCount: mAcct.rows, sequentialScan: seqScan("metrics-account-filtered", "CampaignMetric"), bounded: true }),
      evaluateServingGate({ query: mDistinct.label, p50Ms: mDistinct.p50, p95Ms: mDistinct.p95, rowCount: mDistinct.rows, sequentialScan: seqScan("metrics-distinct-platforms", "CampaignMetric"), bounded: true, allowFullScan: true, fullScanJustification: "Distinct rollup over a range must visit in-range rows to find values without a precomputed rollup." }),
      evaluateServingGate({ query: mCount.label, p50Ms: mCount.p50, p95Ms: mCount.p95, rowCount: mCount.rows, sequentialScan: seqScan("metrics-count-pagination", "CampaignMetric"), bounded: true }),
      evaluateServingGate({ query: mPage.label, p50Ms: mPage.p50, p95Ms: mPage.p95, rowCount: mPage.rows, sequentialScan: seqScan("metrics-page", "CampaignMetric"), bounded: true }),
      evaluateServingGate({ query: mPoll.label, p50Ms: mPoll.p50, p95Ms: mPoll.p95, rowCount: mPoll.rows, sequentialScan: seqScan("job-progress-polling", "WarehouseBackfillChunk"), bounded: true }),
    ];
    for (const verdict of verdicts) {
      assert.equal(verdict.status, "pass", `${verdict.query}: ${verdict.reason}`);
    }
  });

  it("never serializes unbounded results and keeps scenario math honest", async (t) => {
    if (!requireDb(t)) return;
    assert.ok(HARD_LIMIT <= 100_000);
    const res: any = await queryWarehouse(
      { workspaceId: WS[5]!, platforms: ["google_ads"], startDate: new Date("2024-01-01T00:00:00.000Z"), endDate: new Date("2025-12-31T00:00:00.000Z"), limit: 10_000_000 } as any,
      prisma as any,
    );
    assert.ok(res.rows.length <= HARD_LIMIT, `bounded to ${HARD_LIMIT}, got ${res.rows.length}`);
    const pilot = modelCapacityScenario({ ...CAPACITY_SCENARIOS.pilot, bytesPerRow: 512 });
    assert.equal(pilot.totalRows, 5 * 3 * 20 * 731);
  });
});
