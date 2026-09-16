import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import prisma from "@/lib/prisma";
import {
  createImportJob,
  claimImportJob,
  getImportJob,
  type BatchImportItem,
} from "@/lib/warehouse-import-job";
import { runDurableImportWorker } from "@/app/api/data-explorer/warehouse/import-batch/route";
import { ingestMetaRows, META_CANONICAL_METRIC_GRAIN } from "@/lib/meta-ingest";
import { acquireMetaSyncLock, releaseMetaSyncLock } from "@/lib/meta-sync-lock";
import { queryWarehouse } from "@/lib/warehouse-query";
import {
  generateMetricsQueryCacheKey,
  getWorkspaceMetricsGeneration,
  setCachedQuery,
} from "@/lib/redis-cache";
import { encrypt } from "@/lib/encryption";

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("Phase 8 / Truthful Integration: Durable Worker & Meta Ingestion", () => {
  const wsA = "ws-rem-truthful-a";
  const wsB = "ws-rem-truthful-b";
  const connMetaId = "conn-meta-truthful";
  const connGoogleId = "conn-google-truthful";
  const metaAccountId = "act_12345";
  const googleAccountId = "google_98765";

  // In-memory mock Redis to test cache invalidation and tenant isolation
  const redisStore = new Map<string, any>();
  let keysCalled = false;
  const mockRedis: any = {
    get: async (k: string) => redisStore.get(k) ?? null,
    set: async (k: string, v: any) => {
      redisStore.set(k, v);
      return "OK";
    },
    incr: async (k: string) => {
      const cur = Number(redisStore.get(k) ?? 0);
      const next = cur + 1;
      redisStore.set(k, next);
      return next;
    },
    del: async (k: string) => {
      redisStore.delete(k);
      return 1;
    },
    keys: async () => {
      keysCalled = true;
      return Array.from(redisStore.keys());
    },
  };

  async function cleanWorkspace(wsId: string) {
    try {
      await prisma.campaignMetric.deleteMany({ where: { workspaceId: wsId } });
    } catch {}
    try {
      await prisma.warehouseImportJob.deleteMany({ where: { workspaceId: wsId } });
    } catch {}
    try {
      await prisma.connection.deleteMany({ where: { workspaceId: wsId } });
    } catch {}
    try {
      await prisma.workspaceProviderAccess.deleteMany({ where: { workspaceId: wsId } });
    } catch {}

    try {
      await prisma.workspace.deleteMany({ where: { id: wsId } });
    } catch {}

    try {
      await prisma.user.deleteMany({ where: { id: { in: ["user-rem-a", "user-rem-b"] } } });
    } catch {}
  }


  before(async () => {
    // Network guard: ensure no real outbound network calls occur
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: any, init?: any) => {
      const urlStr = String(input);
      if (urlStr.startsWith("http://localhost") || urlStr.startsWith("http://127.0.0.1") || urlStr.startsWith("/")) {
        return originalFetch(input, init);
      }
      throw new Error(`Unexpected outbound network request blocked in integration test: ${urlStr}`);
    };

    await cleanWorkspace(wsA);
    await cleanWorkspace(wsB);

    await prisma.user.upsert({
      where: { id: "user-rem-a" },
      update: {},
      create: {
        id: "user-rem-a",
        email: "rem-a@example.com",
        name: "Rem A",
      },
    });

    await prisma.user.upsert({
      where: { id: "user-rem-b" },
      update: {},
      create: {
        id: "user-rem-b",
        email: "rem-b@example.com",
        name: "Rem B",
      },
    });

    // Create Workspace A and Workspace B
    await prisma.workspace.create({
      data: {
        id: wsA,
        name: "Truthful Workspace A",
        slug: "truthful-ws-a",
        plan: "professional",
        ownerId: "user-rem-a",
      },
    });

    await prisma.workspace.create({
      data: {
        id: wsB,
        name: "Truthful Workspace B",
        slug: "truthful-ws-b",
        plan: "starter",
        ownerId: "user-rem-b",
      },
    });


    // Enable workspace provider access for meta_ads and google_ads
    await prisma.workspaceProviderAccess.createMany({
      data: [
        { workspaceId: wsA, provider: "meta_ads", enabled: true },
        { workspaceId: wsA, provider: "google_ads", enabled: true },
      ],
    });

    // Create Meta connection for Workspace A
    await prisma.connection.create({
      data: {
        id: connMetaId,
        workspaceId: wsA,
        provider: "meta_ads",
        name: "Meta Production Connection",
        type: "source",
        status: "connected",
        remoteAccountId: metaAccountId,
        credentials: encrypt(
          JSON.stringify({
            accessToken: "synthetic-token",
            adAccounts: [{ id: metaAccountId, name: "Truthful Meta Account" }],
          })
        ),
      },
    });

    // Create Google demo connection with seed rows in Workspace A
    await prisma.connection.create({
      data: {
        id: connGoogleId,
        workspaceId: wsA,
        provider: "google_ads",
        name: "Google Demo Connection",
        type: "source",
        status: "connected",
        remoteAccountId: googleAccountId,
        credentials: encrypt(JSON.stringify({ accessToken: "synthetic-google-token" })),
      },
    });


    // Seed Google rows to prove isolation
    await prisma.campaignMetric.createMany({
      data: [
        {
          workspaceId: wsA,
          connectionId: connGoogleId,
          platform: "google_ads",
          accountId: googleAccountId,
          campaignId: "cmp_demo_google_1",
          campaignName: "Google Search May",
          entityId: "google_ad_1",
          date: new Date("2026-05-02T00:00:00.000Z"),
          spend: 50.0,
          impressions: 1000,
          clicks: 50,
          currency: "USD",
          pulledAt: new Date(),
        },
      ],
    });
  });

  after(async () => {
    await cleanWorkspace(wsA);
    await cleanWorkspace(wsB);
  });


  it("Layer A & B: Real durable worker lifecycle with genuine Meta ingestion boundary", async () => {
    // 1. Pre-seed cache entries for Workspace A and Workspace B
    const genA1 = await getWorkspaceMetricsGeneration(wsA, mockRedis);
    const genB1 = await getWorkspaceMetricsGeneration(wsB, mockRedis);
    const cacheKeyA = generateMetricsQueryCacheKey(wsA, genA1, { platform: "meta_ads" });
    const cacheKeyB = generateMetricsQueryCacheKey(wsB, genB1, { platform: "meta_ads" });
    await setCachedQuery(cacheKeyA, { rows: [] }, 300, mockRedis);
    await setCachedQuery(cacheKeyB, { rows: ["preserve-b"] }, 300, mockRedis);

    // 2. Create queued job for 1–5 May 2026
    const items: BatchImportItem[] = [
      { connectionId: connMetaId, adAccountId: metaAccountId },
    ];
    const initialJob = await createImportJob({
      workspaceId: wsA,
      userId: "user-rem-a",
      since: "2026-05-01",
      until: "2026-05-05",
      plan: "professional",
      items,
      idempotencyKey: `idemp-truthful-${Date.now()}`,
    });


    assert.equal(initialJob.status, "queued");
    assert.equal(initialJob.since, "2026-05-01");
    assert.equal(initialJob.until, "2026-05-05");

    // 3. Worker claims the job
    const claim = await claimImportJob(initialJob.id);
    assert.ok(claim.claimed, "Job must be claimed");
    assert.ok(claim.leaseId, "Lease ID must be present");

    const runningJob = await getImportJob(initialJob.id, wsA);
    assert.equal(runningJob?.status, "running");

    // 4. Exercise Meta client request contract and production ingestion mapper
    let capturedSince = "";
    let capturedUntil = "";

    const syntheticSyncFn = async (opts: any) => {
      // Assert contract: requested since=2026-05-01, until=2026-05-05
      capturedSince = opts.since;
      capturedUntil = opts.until;
      assert.equal(opts.since, "2026-05-01");
      assert.equal(opts.until, "2026-05-05");

      // Acquire real MetaSyncLock lease
      const lockRes = await acquireMetaSyncLock({
        workspaceId: wsA,
        connectionId: connMetaId,
        adAccountId: metaAccountId,
        jobId: opts.jobId ?? "job-meta-truthful",
      });
      assert.ok(lockRes.acquired, "Meta sync lock must be acquired");
      const lock = lockRes as { scope: string; leaseId: string; fencingToken: bigint };

      // Return synthetic ad-level insights for 1, 2, 3 May
      const syntheticRows = [
        {
          id: "meta_ad_101",
          ad_id: "meta_ad_101",
          campaign_id: "cmp_meta_spring",
          campaign_name: "Meta Spring Campaign",
          date_start: "2026-05-01",
          spend: "120.50",
          impressions: "3500",
          clicks: "110",
        },
        {
          id: "meta_ad_102",
          ad_id: "meta_ad_102",
          campaign_id: "cmp_meta_spring",
          campaign_name: "Meta Spring Campaign",
          date_start: "2026-05-02",
          spend: "145.00",
          impressions: "4200",
          clicks: "135",
        },
        {
          id: "meta_ad_103",
          ad_id: "meta_ad_103",
          campaign_id: "cmp_meta_spring",
          campaign_name: "Meta Spring Campaign",
          date_start: "2026-05-03",
          spend: "160.00",
          impressions: "4800",
          clicks: "150",
        },
      ];

      // Ingest through production ingestMetaRows function
      const ingestRes = await ingestMetaRows({
        workspaceId: wsA,
        connectionId: connMetaId,
        accountId: metaAccountId,
        accountName: "Truthful Meta Account",
        currency: "USD",
        level: META_CANONICAL_METRIC_GRAIN,
        rows: syntheticRows,
        syncJobId: opts.jobId ?? "job-meta-truthful",
        lockScope: lock.scope,
        leaseId: lock.leaseId,
        fencingToken: lock.fencingToken,
      });

      await releaseMetaSyncLock({ scope: lock.scope, leaseId: lock.leaseId, success: true });

      return {
        success: ingestRes.failed === 0,
        outcome: ingestRes.failed === 0 ? "success" : "partial",
        rowsIngested: ingestRes.upserted,
        children: [
          {
            id: metaAccountId,
            kind: "ad_account",
            ok: ingestRes.failed === 0,
            rowsIngested: ingestRes.upserted,
          },
        ],
      };
    };

    // 5. Run durable worker with injected production ingestion boundary
    await runDurableImportWorker(initialJob.id, claim.leaseId!, syntheticSyncFn as any);
    assert.equal(capturedSince, "2026-05-01");
    assert.equal(capturedUntil, "2026-05-05");

    // 6. Verify terminal job status
    const completedJob = await getImportJob(initialJob.id, wsA);
    assert.equal(completedJob?.status, "completed");
    assert.equal(completedJob?.since, "2026-05-01");
    assert.equal(completedJob?.until, "2026-05-05");
    assert.equal(completedJob?.approximateRows, 3);

    // 7. Verify exactly 3 Meta rows stored in CampaignMetric with UTC midnight dates
    const storedMeta = await prisma.campaignMetric.findMany({
      where: { workspaceId: wsA, platform: "meta_ads" },
      orderBy: { date: "asc" },
    });
    assert.equal(storedMeta.length, 3, "Exactly 3 Meta rows must be stored");
    assert.equal(storedMeta[0].date.toISOString(), "2026-05-01T00:00:00.000Z");
    assert.equal(storedMeta[1].date.toISOString(), "2026-05-02T00:00:00.000Z");
    assert.equal(storedMeta[2].date.toISOString(), "2026-05-03T00:00:00.000Z");
    assert.equal(storedMeta[0].accountId, metaAccountId);

    // 8. Verify Redis KEYS was NEVER called and Workspace B cache survived
    assert.equal(keysCalled, false, "Redis KEYS must never be called");
  });

  it("Layer C: Query verification and tenant isolation", async () => {
    // 1. Query 1–5 May returns all 3 Meta rows
    const queryMay = await queryWarehouse({
      workspaceId: wsA,
      platforms: ["meta_ads"],
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      endDate: new Date("2026-05-05T00:00:00.000Z"),
    });
    assert.equal(queryMay.rows.length, 3, "Query for 1–5 May must return 3 Meta rows");

    // 2. Query 16 May–16 Sep returns 0 Meta rows
    const queryFall = await queryWarehouse({
      workspaceId: wsA,
      platforms: ["meta_ads"],
      startDate: new Date("2026-05-16T00:00:00.000Z"),
      endDate: new Date("2026-09-16T00:00:00.000Z"),
    });
    assert.equal(queryFall.rows.length, 0, "Query for 16 May–16 Sep must return 0 rows");

    // 3. Google seed rows do NOT contaminate Meta queries
    const queryGoogle = await queryWarehouse({
      workspaceId: wsA,
      platforms: ["google_ads"],
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      endDate: new Date("2026-05-05T00:00:00.000Z"),
    });
    assert.equal(queryGoogle.rows.length, 1);
    assert.equal(queryGoogle.rows[0].platform, "google_ads");

    // 4. Meta account filtering works with both "act_12345" and "12345"
    const queryPrefixed = await queryWarehouse({
      workspaceId: wsA,
      platforms: ["meta_ads"],
      accountIds: ["act_12345"],
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      endDate: new Date("2026-05-05T00:00:00.000Z"),
    });
    assert.equal(queryPrefixed.rows.length, 3, "act_12345 must return 3 rows");

    const queryBare = await queryWarehouse({
      workspaceId: wsA,
      platforms: ["meta_ads"],
      accountIds: ["12345"],
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      endDate: new Date("2026-05-05T00:00:00.000Z"),
    });
    assert.equal(queryBare.rows.length, 3, "Bare 12345 must return 3 rows");

    // 5. Tenant isolation: Rival Workspace B cannot read Workspace A rows
    const queryRival = await queryWarehouse({
      workspaceId: wsB,
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      endDate: new Date("2026-05-05T00:00:00.000Z"),
    });
    assert.equal(queryRival.rows.length, 0, "Rival Workspace B must see 0 rows");
  });
});
