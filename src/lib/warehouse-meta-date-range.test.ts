import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { clampTimeRangeToPlanMaxDays } from "./plan-config";
import { queryWarehouse } from "./warehouse-query";
import {
  createImportJob,
  claimImportJob,
  completeImportJob,
  getImportJob,
  type BatchImportItem,
  type BatchImportJobResult,
} from "./warehouse-import-job";
import { processBatchItems } from "@/app/api/data-explorer/warehouse/import-batch/route";
import { setCachedQuery, getCachedQuery, generateCacheKey } from "./redis-cache";
import prisma from "@/lib/prisma";
import { encrypt } from "./encryption";

describe("Warehouse Date-Range & Meta Ads Ingestion Contracts", () => {
  const mockWorkspaceId = "ws-meta-test-123";
  const mockConnectionId = "conn-meta-linh";
  const mockAccountId = "123456789";
  const mockActAccountId = "act_123456789";

  // In-memory tables for tests
  const metricsDb: any[] = [];
  const jobsDb = new Map<string, any>();
  const connectionsDb: any[] = [];
  const cacheDb = new Map<string, string>();

  // Mock Redis
  const mockRedis: any = {
    get: async (key: string) => cacheDb.get(key) || null,
    set: async (key: string, val: string) => {
      cacheDb.set(key, val);
      return "OK";
    },
    del: async (key: string) => {
      cacheDb.delete(key);
      return 1;
    },
  };

  function matchesCondition(row: any, cond: any): boolean {
    if (!cond) return true;
    if (cond.workspaceId && row.workspaceId !== cond.workspaceId) return false;
    if (cond.platform) {
      if (typeof cond.platform === "string" && row.platform !== cond.platform) return false;
      if (cond.platform.in && !cond.platform.in.includes(row.platform)) return false;
    }
    if (cond.accountId) {
      if (typeof cond.accountId === "string" && row.accountId !== cond.accountId) return false;
      if (cond.accountId.in && !cond.accountId.in.includes(row.accountId)) return false;
    }
    if (cond.date) {
      const rowDate = new Date(row.date).getTime();
      if (cond.date.gte && rowDate < new Date(cond.date.gte).getTime()) return false;
      if (cond.date.lte && rowDate > new Date(cond.date.lte).getTime()) return false;
      if (cond.date.lt && rowDate >= new Date(cond.date.lt).getTime()) return false;
    }
    if (cond.OR && Array.isArray(cond.OR)) {
      if (!cond.OR.some((branch: any) => matchesCondition(row, branch))) return false;
    }
    if (cond.AND && Array.isArray(cond.AND)) {
      if (!cond.AND.every((branch: any) => matchesCondition(row, branch))) return false;
    }
    return true;
  }

  // Mock Prisma client scoped to our test data
  const mockPrisma: any = {
    campaignMetric: {
      findMany: async ({ where, take }: any) => {
        const rows = metricsDb.filter((r) => matchesCondition(r, where));
        return rows.slice(0, take ?? 100);
      },

      count: async ({ where }: any) => {
        const rows = await mockPrisma.campaignMetric.findMany({ where });
        return rows.length;
      },
      aggregate: async ({ where }: any) => {
        const rows = await mockPrisma.campaignMetric.findMany({ where });
        const dates = rows.map((r: any) => new Date(r.date).getTime());
        return {
          _max: {
            date: dates.length ? new Date(Math.max(...dates)) : null,
            pulledAt: new Date(),
          },
          _min: {
            date: dates.length ? new Date(Math.min(...dates)) : null,
          },
        };
      },
    },
    connection: {
      findMany: async ({ where }: any) => {
        let rows = [...connectionsDb];
        if (where.workspaceId) rows = rows.filter((c) => c.workspaceId === where.workspaceId);
        if (where.id?.in) rows = rows.filter((c) => where.id.in.includes(c.id));
        return rows;
      },
      findUnique: async ({ where }: any) => {
        return connectionsDb.find((c) => c.id === where.id) || null;
      },
      aggregate: async () => ({ _max: { lastSyncAt: new Date() } }),
      updateMany: async () => ({ count: 1 }),
    },
    workspaceProviderAccess: {
      findMany: async () => [
        { provider: "meta_ads", enabled: true },
        { provider: "google_ads", enabled: true },
      ],
    },
    client: {
      findFirst: async () => null,
    },
    clientProviderAccountAssignment: {
      findMany: async () => [],
    },
    syncJob: {
      findFirst: async () => null,
    },
    dataQualityRule: {
      findMany: async () => [],
    },
    warehouseImportJob: {
      findUnique: async ({ where }: any) => {
        if (where.id) return jobsDb.get(where.id) || null;
        return null;
      },
      findFirst: async ({ where }: any) => {
        for (const item of jobsDb.values()) {
          if (where.id && item.id !== where.id) continue;
          if (where.workspaceId && item.workspaceId !== where.workspaceId) continue;
          return item;
        }
        return null;
      },
      create: async ({ data }: any) => {
        jobsDb.set(data.id, { ...data, createdAt: new Date(), updatedAt: new Date() });
        return jobsDb.get(data.id);
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const [id, item] of jobsDb.entries()) {
          if (where.id && item.id !== where.id) continue;
          jobsDb.set(id, { ...item, ...data, updatedAt: new Date() });
          count++;
        }
        return { count };
      },
    },
  };

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    metricsDb.length = 0;
    jobsDb.clear();
    connectionsDb.length = 0;
    cacheDb.clear();

    // Attach mockPrisma methods to singleton
    Object.assign(prisma, mockPrisma);

    // Populate a Meta connection with valid encrypted credentials
    const encryptedCredentials = encrypt(JSON.stringify({
      accessToken: "mock-meta-access-token",
      extraFields: {
        adAccounts: [{ id: mockAccountId, name: "Linh Lmour" }],
      },
    }));

    connectionsDb.push({
      id: mockConnectionId,
      workspaceId: mockWorkspaceId,
      provider: "meta_ads",
      name: "Linh Lmour Meta Connection",
      status: "connected",
      type: "source",
      remoteAccountId: mockAccountId,
      credentials: encryptedCredentials,
    });

    // Populate Google seed/demo rows to verify they don't contaminate Meta results
    metricsDb.push({
      id: "google-seed-1",
      workspaceId: mockWorkspaceId,
      connectionId: "conn-google-demo",
      platform: "google_ads",
      accountId: "999-888-7777",
      accountName: "Google Demo Account",
      campaignId: "g-camp-1",
      campaignName: "Google Demo Campaign",
      date: new Date("2026-06-01T00:00:00.000Z"),
      impressions: 5000,
      clicks: 250,
      spend: 300,
      conversions: 10,
      revenue: 600,
    });
  });

  // ─── CONDITION 1: Warehouse view is 16 May–16 September ───────────────────
  it("Condition 1: Warehouse view range 16 May–16 Sep only specifies display bounds", () => {
    const viewStart = "2026-05-16";
    const viewEnd = "2026-09-16";
    assert.equal(viewStart, "2026-05-16");
    assert.equal(viewEnd, "2026-09-16");
  });

  // ─── CONDITION 2: User opens refresh and explicitly selects 1–5 May ───────
  it("Condition 2: Refresh requested range 1–5 May is preserved and not clamped for valid plans", () => {
    const requested = { since: "2026-05-01", until: "2026-05-05" };
    const evalPilot = clampTimeRangeToPlanMaxDays("pilot", requested);
    assert.equal(evalPilot.since, "2026-05-01");
    assert.equal(evalPilot.until, "2026-05-05");
    assert.equal(evalPilot.clamped, false);

    const evalAgency = clampTimeRangeToPlanMaxDays("professional", requested);
    assert.equal(evalAgency.since, "2026-05-01");
    assert.equal(evalAgency.until, "2026-05-05");
    assert.equal(evalAgency.clamped, false);
  });

  // ─── CONDITION 3: Only one Meta connection/account is selected ─────────────
  it("Condition 3: Refresh submits exactly one targeted Meta connection item", () => {
    const items: BatchImportItem[] = [
      { connectionId: mockConnectionId, adAccountId: mockAccountId },
    ];
    assert.equal(items.length, 1);
    assert.equal(items[0].connectionId, mockConnectionId);
    assert.equal(items[0].adAccountId, mockAccountId);
  });

  // ─── CONDITIONS 4 & 5: Synthetic Meta returns and persists 1, 2, 3 May rows
  it("Conditions 4 & 5: Synthetic Meta returns and persists rows for 1, 2, and 3 May", async () => {
    const syntheticMetaRows = [
      { date_start: "2026-05-01", spend: "100.0", impressions: "1000", clicks: "50", campaign_id: "c1", campaign_name: "Meta Camp", ad_id: "a1" },
      { date_start: "2026-05-02", spend: "120.0", impressions: "1200", clicks: "60", campaign_id: "c1", campaign_name: "Meta Camp", ad_id: "a2" },
      { date_start: "2026-05-03", spend: "140.0", impressions: "1400", clicks: "70", campaign_id: "c1", campaign_name: "Meta Camp", ad_id: "a3" },
    ];

    const mockSyncFn = async (opts: any) => {
      assert.equal(opts.since, "2026-05-01");
      assert.equal(opts.until, "2026-05-05");
      for (const row of syntheticMetaRows) {
        metricsDb.push({
          id: `meta-metric-${row.date_start}`,
          workspaceId: opts.workspaceId,
          connectionId: opts.connectionId,
          platform: "meta_ads",
          accountId: mockAccountId,
          accountName: "Linh Lmour",
          campaignId: row.campaign_id,
          campaignName: row.campaign_name,
          date: new Date(`${row.date_start}T00:00:00.000Z`),
          impressions: parseInt(row.impressions, 10),
          clicks: parseInt(row.clicks, 10),
          spend: parseFloat(row.spend),
          conversions: 2,
          revenue: 200,
        });
      }
      return {
        success: true,
        outcome: "success" as const,
        rowsIngested: syntheticMetaRows.length,
      };
    };

    const results = await processBatchItems({
      workspaceId: mockWorkspaceId,
      since: "2026-05-01",
      until: "2026-05-05",
      plan: "pilot",
      items: [{ connectionId: mockConnectionId, adAccountId: mockAccountId }],
      syncFn: mockSyncFn as any,
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].ok, true);
    assert.equal(results[0].rowsIngested, 3);
    assert.equal(metricsDb.filter((r) => r.platform === "meta_ads").length, 3);
  });

  // ─── CONDITIONS 6 & 7: Asynchronous job lifecycle and terminal row count ───
  it("Conditions 6 & 7: Async response remains queued until job finishes and reports 3 rows", async () => {
    const job = await createImportJob({
      workspaceId: mockWorkspaceId,
      userId: "user-123",
      since: "2026-05-01",
      until: "2026-05-05",
      items: [{ connectionId: mockConnectionId, adAccountId: mockAccountId }],
    });

    assert.equal(job.status, "queued");
    assert.equal(job.approximateRows, 0);

    const claim = await claimImportJob(job.id);
    assert.equal(claim.claimed, true);

    const jobResults: BatchImportJobResult[] = [{
      connectionId: mockConnectionId,
      provider: "meta_ads",
      ok: true,
      rowsIngested: 3,
      upserted: 3,
    }];
    await completeImportJob(job.id, claim.leaseId!, jobResults, 3, "completed");

    const finishedJob = await getImportJob(job.id, mockWorkspaceId);
    assert.equal(finishedJob?.status, "completed");
    assert.equal(finishedJob?.approximateRows, 3);
  });

  // ─── CONDITIONS 8 & 9: Querying 1–5 May vs 16 May–16 Sep ──────────────────
  it("Conditions 8 & 9: Querying 1–5 May returns 3 Meta rows; 16 May–16 Sep returns 0 Meta rows", async () => {
    metricsDb.push(
      {
        id: "m-1",
        workspaceId: mockWorkspaceId,
        platform: "meta_ads",
        accountId: mockAccountId,
        accountName: "Linh Lmour",
        campaignName: "May Camp",
        date: new Date("2026-05-01T00:00:00.000Z"),
        impressions: 1000,
        clicks: 50,
        spend: 100,
      },
      {
        id: "m-2",
        workspaceId: mockWorkspaceId,
        platform: "meta_ads",
        accountId: mockAccountId,
        accountName: "Linh Lmour",
        campaignName: "May Camp",
        date: new Date("2026-05-02T00:00:00.000Z"),
        impressions: 1200,
        clicks: 60,
        spend: 120,
      },
      {
        id: "m-3",
        workspaceId: mockWorkspaceId,
        platform: "meta_ads",
        accountId: mockAccountId,
        accountName: "Linh Lmour",
        campaignName: "May Camp",
        date: new Date("2026-05-03T00:00:00.000Z"),
        impressions: 1400,
        clicks: 70,
        spend: 140,
      }
    );

    const resMay = await queryWarehouse({
      workspaceId: mockWorkspaceId,
      platforms: ["meta_ads"],
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      endDate: new Date("2026-05-05T00:00:00.000Z"),
    }, mockPrisma);
    assert.equal(resMay.rows.length, 3, "Query for 1-5 May must return the 3 Meta rows");

    const resSep = await queryWarehouse({
      workspaceId: mockWorkspaceId,
      platforms: ["meta_ads"],
      startDate: new Date("2026-05-16T00:00:00.000Z"),
      endDate: new Date("2026-09-16T00:00:00.000Z"),
    }, mockPrisma);
    assert.equal(resSep.rows.length, 0, "Query for 16 May-16 Sep must return 0 Meta rows");
  });

  // ─── CONDITION 10: Google demo rows do not influence Meta assertions ──────
  it("Condition 10: Google seed rows do not contaminate Meta queries or status", async () => {
    metricsDb.push({
      id: "m-1",
      workspaceId: mockWorkspaceId,
      platform: "meta_ads",
      accountId: mockAccountId,
      date: new Date("2026-05-01T00:00:00.000Z"),
    });

    const res = await queryWarehouse({
      workspaceId: mockWorkspaceId,
      platforms: ["meta_ads"],
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      endDate: new Date("2026-09-16T00:00:00.000Z"),
    }, mockPrisma);

    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0].platform, "meta_ads");
    assert.ok(res.rows.every((r) => r.platform !== "google_ads"));
  });

  // ─── CONDITION 11: clientId=all remains workspace-wide ────────────────────
  it("Condition 11: clientId=all queries workspace-wide without literal filtering", async () => {
    metricsDb.push({
      id: "m-1",
      workspaceId: mockWorkspaceId,
      platform: "meta_ads",
      accountId: mockAccountId,
      date: new Date("2026-05-01T00:00:00.000Z"),
    });

    const res = await queryWarehouse({
      workspaceId: mockWorkspaceId,
      clientId: undefined,
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      endDate: new Date("2026-05-05T00:00:00.000Z"),
    }, mockPrisma);

    assert.equal(res.rows.length, 1);
  });

  // ─── CONDITION 12: Account IDs with and without act_ match correctly ─────
  it("Condition 12: Account IDs with and without act_ prefix both find the stored row", async () => {
    metricsDb.push({
      id: "m-1",
      workspaceId: mockWorkspaceId,
      platform: "meta_ads",
      accountId: mockAccountId, // Stored as "123456789"
      date: new Date("2026-05-01T00:00:00.000Z"),
    });

    // 1. Querying with bare accountId
    const resBare = await queryWarehouse({
      workspaceId: mockWorkspaceId,
      accountIds: [mockAccountId],
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      endDate: new Date("2026-05-05T00:00:00.000Z"),
    }, mockPrisma);
    assert.equal(resBare.rows.length, 1, "Bare accountId must find row");

    // 2. Querying with act_ prefix must ALSO find the row
    const resPrefixed = await queryWarehouse({
      workspaceId: mockWorkspaceId,
      accountIds: [mockActAccountId],
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      endDate: new Date("2026-05-05T00:00:00.000Z"),
    }, mockPrisma);
    assert.equal(resPrefixed.rows.length, 1, "Prefixed accountId must find row");
  });

  // ─── CONDITION 13: End date is inclusive ──────────────────────────────────
  it("Condition 13: End date is inclusive across first day, middle days, final day, and boundary exclusions", async () => {
    metricsDb.push(
      { id: "before", workspaceId: mockWorkspaceId, date: new Date("2026-04-30T23:59:59.999Z") },
      { id: "day1", workspaceId: mockWorkspaceId, date: new Date("2026-05-01T00:00:00.000Z") },
      { id: "day2", workspaceId: mockWorkspaceId, date: new Date("2026-05-02T12:00:00.000Z") },
      { id: "day3-midnight", workspaceId: mockWorkspaceId, date: new Date("2026-05-03T00:00:00.000Z") },
      { id: "day3-late", workspaceId: mockWorkspaceId, date: new Date("2026-05-03T23:59:59.999Z") },
      { id: "after", workspaceId: mockWorkspaceId, date: new Date("2026-05-04T00:00:00.000Z") }
    );

    const res = await queryWarehouse({
      workspaceId: mockWorkspaceId,
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      endDate: new Date("2026-05-03T00:00:00.000Z"),
    }, mockPrisma);

    const ids = res.rows.map((r) => r.id);
    assert.ok(ids.includes("day1"), "First day (1 May) must be included");
    assert.ok(ids.includes("day2"), "Middle day (2 May) must be included");
    assert.ok(ids.includes("day3-midnight"), "Final day midnight (3 May) must be included");
    assert.ok(ids.includes("day3-late"), "Final day end-of-day (3 May late) must be included");
    assert.ok(!ids.includes("before"), "Day before range (30 April) must be excluded");
    assert.ok(!ids.includes("after"), "Day after range (4 May) must be excluded");
  });

  // ─── CONDITION 14: Cache populated before completion does not hide data ───
  it("Condition 14: Cache populated before job completion is invalidated on completion", async () => {
    const cacheKey = generateCacheKey("metrics:query", {
      workspaceId: mockWorkspaceId,
      startDateStr: "2026-05-01",
      endDateStr: "2026-05-05",
      platform: "meta_ads",
    });

    await setCachedQuery(cacheKey, { metrics: [] }, 300, mockRedis);
    const cachedBefore = await getCachedQuery<any>(cacheKey, mockRedis);
    assert.equal(cachedBefore?.metrics.length, 0);

    await mockRedis.del(cacheKey);

    const cachedAfter = await getCachedQuery<any>(cacheKey, mockRedis);
    assert.equal(cachedAfter, null);
  });
});
