import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import prisma from "@/lib/prisma";
import {
  enqueueOauthWarehouseBackfill,
  initialOauthBackfillWindow,
} from "./oauth-warehouse-backfill";
import {
  WAREHOUSE_AUTOMATIC_SKIP_REASON,
  isAutomaticWarehouseIngestionAvailable,
} from "./warehouse-execution-guard";
import { getHistoricalIngestionCapability } from "./historical-ingestion-capabilities";

describe("oauth automatic enqueue skips unavailable ingestion (production helper)", () => {
  const jobs = new Map<string, any>();
  const audit: any[] = [];
  let createCalls = 0;

  beforeEach(() => {
    jobs.clear();
    audit.length = 0;
    createCalls = 0;

    (prisma as any).warehouseImportJob = {
      findUnique: async ({ where }: any) => {
        if (where.workspaceId_idempotencyKey) {
          const { workspaceId, idempotencyKey } = where.workspaceId_idempotencyKey;
          for (const item of jobs.values()) {
            if (item.workspaceId === workspaceId && item.idempotencyKey === idempotencyKey) return item;
          }
        }
        if (where.id) return jobs.get(where.id) ?? null;
        return null;
      },
      create: async ({ data }: any) => {
        createCalls += 1;
        // Tenant isolation: every created job must carry its workspace.
        assert.ok(typeof data.workspaceId === "string" && data.workspaceId.length > 0);
        if (data.idempotencyKey) {
          for (const item of jobs.values()) {
            if (item.workspaceId === data.workspaceId && item.idempotencyKey === data.idempotencyKey) {
              const err: any = new Error("Unique constraint failed");
              err.code = "P2002";
              throw err;
            }
          }
        }
        const record = {
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          retryCount: 0,
          maxRetries: 3,
          completedItems: 0,
          approximateRows: 0,
          startedAt: null,
          finishedAt: null,
          heartbeatAt: null,
          leaseId: null,
          leaseExpiresAt: null,
          errorMsg: null,
          results: [],
          status: "queued",
        };
        jobs.set(record.id, record);
        return record;
      },
    };
    (prisma as any).auditEvent = {
      create: async ({ data }: any) => {
        audit.push(data);
        return data;
      },
    };
  });

  function windowDays(since: string, until: string): number {
    return Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000) + 1;
  }

  it("reports Amazon/Shopify capabilities as unavailable before date arithmetic", () => {
    assert.equal(getHistoricalIngestionCapability("amazon")?.warehouseIngestion, "unavailable");
    assert.equal(getHistoricalIngestionCapability("shopify")?.warehouseIngestion, "unavailable");
    assert.equal(getHistoricalIngestionCapability("amazon")?.defaultAutomaticBackfill.days, 0);
    assert.equal(getHistoricalIngestionCapability("shopify")?.defaultAutomaticBackfill.days, 0);
    assert.equal(isAutomaticWarehouseIngestionAvailable("amazon"), false);
    assert.equal(isAutomaticWarehouseIngestionAvailable("shopify"), false);
    // The legacy arithmetic would produce a reversed tomorrow-through-today
    // range for zero-day windows; the guard must prevent ever reaching it.
    const amazonWindow = initialOauthBackfillWindow("amazon", new Date(Date.UTC(2026, 7, 20)));
    assert.ok(amazonWindow.since > amazonWindow.until, "legacy zero-day arithmetic reverses the range");
  });

  it("completes Amazon OAuth without a Warehouse job and records a structured skip", async () => {
    const result = await enqueueOauthWarehouseBackfill({
      workspaceId: "ws-amazon",
      userId: "user-a",
      connectionId: "conn-amazon-1",
      connectionWorkspaceId: "ws-amazon",
      provider: "amazon",
      kind: "initial",
    });
    assert.equal(result.skipped, true);
    assert.equal((result as { reason?: string }).reason, WAREHOUSE_AUTOMATIC_SKIP_REASON);
    assert.equal((result as { reason?: string }).reason, "historical_ingestion_unavailable");
    assert.equal(result.job, null);
    assert.equal(createCalls, 0);
    assert.equal(jobs.size, 0);
    assert.equal(audit.length, 0);
  });

  it("completes Shopify OAuth without a Warehouse job and records a structured skip", async () => {
    const result = await enqueueOauthWarehouseBackfill({
      workspaceId: "ws-shopify",
      userId: "user-s",
      connectionId: "conn-shopify-1",
      connectionWorkspaceId: "ws-shopify",
      provider: "shopify",
      kind: "initial",
    });
    assert.equal(result.skipped, true);
    assert.equal((result as { reason?: string }).reason, "historical_ingestion_unavailable");
    assert.equal(result.job, null);
    assert.equal(createCalls, 0);
    assert.equal(jobs.size, 0);
  });

  it("creates zero import items/workers and performs no invalid date calculation for unavailable providers", async () => {
    for (const provider of ["amazon", "shopify"] as const) {
      jobs.clear();
      createCalls = 0;
      const before = createCalls;
      const result = await enqueueOauthWarehouseBackfill({
        workspaceId: `ws-${provider}`,
        userId: "user-x",
        connectionId: `conn-${provider}-x`,
        connectionWorkspaceId: `ws-${provider}`,
        provider,
        kind: provider === "amazon" ? "initial" : "catchup",
        lastSyncAt: new Date(Date.UTC(2026, 7, 18)),
      });
      assert.equal(result.skipped, true);
      assert.equal(createCalls, before);
      assert.equal(jobs.size, 0);
      // No job means no worker dispatch, no import items, and no provider
      // reporting request can occur downstream.
    }
  });

  it("does not turn successful OAuth into an error when Warehouse enqueueing is skipped", async () => {
    // Skipped enqueueing resolves (not rejects), so the OAuth callback can
    // still redirect to success. A rejection here would incorrectly fail OAuth.
    await assert.doesNotReject(() =>
      enqueueOauthWarehouseBackfill({
        workspaceId: "ws-amazon",
        userId: "user-a",
        connectionId: "conn-amazon-2",
        connectionWorkspaceId: "ws-amazon",
        provider: "amazon",
        kind: "catchup",
        lastSyncAt: new Date(),
      }),
    );
  });

  function assertNinetyDaySlices(job: { since: string; until: string; items: Array<{ executionSince?: string; executionUntil?: string }> }) {
    assert.equal(windowDays(job.since, job.until), 90);
    assert.equal(job.items.length, 3);
    // Newest-first: first slice ends at job.until, last starts at job.since.
    assert.equal(job.items[0]?.executionUntil, job.until);
    assert.equal(job.items[2]?.executionSince, job.since);
    const seen = new Set<string>();
    for (const item of job.items) {
      assert.ok(item.executionSince && item.executionUntil);
      const span = windowDays(item.executionSince!, item.executionUntil!);
      assert.ok(span <= 30, `slice ${item.executionSince}..${item.executionUntil} spans ${span}`);
      for (let cursor = Date.parse(`${item.executionSince}T00:00:00Z`); cursor <= Date.parse(`${item.executionUntil}T00:00:00Z`); cursor += 86_400_000) {
        const day = new Date(cursor).toISOString().slice(0, 10);
        assert.equal(seen.has(day), false, `duplicate day ${day}`);
        seen.add(day);
      }
    }
    assert.equal(seen.size, 90);
    for (let index = 0; index < job.items.length - 1; index += 1) {
      const newer = job.items[index];
      const older = job.items[index + 1];
      assert.equal(
        Date.parse(`${newer.executionSince}T00:00:00Z`) - Date.parse(`${older.executionUntil}T00:00:00Z`),
        86_400_000,
      );
    }
  }

  it("retains Meta 90-day newest-first slices covering exactly 90 inclusive days", async () => {
    const result = await enqueueOauthWarehouseBackfill({
      workspaceId: "ws-meta",
      userId: "user-m",
      connectionId: "conn-meta-90",
      connectionWorkspaceId: "ws-meta",
      provider: "meta_ads",
      kind: "initial",
    });
    assert.equal(result.skipped ?? false, false);
    assert.ok(result.job);
    assertNinetyDaySlices(result.job);
    assert.equal(result.job.workspaceId, "ws-meta");
  });

  it("retains Google 90-day newest-first slices covering exactly 90 inclusive days", async () => {
    const result = await enqueueOauthWarehouseBackfill({
      workspaceId: "ws-google",
      userId: "user-g",
      connectionId: "conn-google-90",
      connectionWorkspaceId: "ws-google",
      provider: "google_ads",
      kind: "initial",
    });
    assert.equal(result.skipped ?? false, false);
    assert.ok(result.job);
    assertNinetyDaySlices(result.job);
  });

  it("preserves each slice's exact range across retries", async () => {
    const first = await enqueueOauthWarehouseBackfill({
      workspaceId: "ws-retry",
      userId: "user-r",
      connectionId: "conn-retry-1",
      connectionWorkspaceId: "ws-retry",
      provider: "meta_ads",
      kind: "initial",
    });
    assert.ok(first.job);
    const firstRanges = first.job.items.map((item) => `${item.executionSince}..${item.executionUntil}`);
    const second = await enqueueOauthWarehouseBackfill({
      workspaceId: "ws-retry",
      userId: "user-r",
      connectionId: "conn-retry-1",
      connectionWorkspaceId: "ws-retry",
      provider: "meta_ads",
      kind: "initial",
    });
    assert.equal((second as { reused?: boolean }).reused, true);
    assert.ok(second.job);
    assert.ok(first.job);
    assert.equal(second.job.id, first.job.id);
    assert.deepEqual(
      second.job.items.map((item) => `${item.executionSince}..${item.executionUntil}`),
      firstRanges,
    );
  });

  it("retains previous fallback only when ingestion is supported", async () => {
    for (const provider of ["tiktok_business", "shopee", "lazada"] as const) {
      const result = await enqueueOauthWarehouseBackfill({
        workspaceId: `ws-${provider}`,
        userId: "user-o",
        connectionId: `conn-${provider}-1`,
        connectionWorkspaceId: `ws-${provider}`,
        provider,
        kind: "initial",
      });
      assert.equal(result.skipped ?? false, false);
      assert.ok(result.job);
      assert.equal(result.job.items.length, 1);
      assert.equal(windowDays(result.job.since, result.job.until), 30);
    }
  });

  it("fails closed for a future unavailable provider without hardcoding names", async () => {
    assert.equal(isAutomaticWarehouseIngestionAvailable("future_provider_xyz"), false);
    const result = await enqueueOauthWarehouseBackfill({
      workspaceId: "ws-future",
      userId: "user-f",
      connectionId: "conn-future-1",
      connectionWorkspaceId: "ws-future",
      provider: "future_provider_xyz",
      kind: "initial",
    });
    assert.equal(result.skipped, true);
    assert.equal((result as { reason?: string }).reason, "historical_ingestion_unavailable");
    assert.equal(result.job, null);
    assert.equal(jobs.size, 0);
  });

  it("refuses to enqueue a job for another workspace's connection", async () => {
    await assert.rejects(
      () =>
        enqueueOauthWarehouseBackfill({
          workspaceId: "ws-a",
          userId: "user-a",
          connectionId: "conn-b",
          connectionWorkspaceId: "ws-b",
          provider: "meta_ads",
          kind: "initial",
        }),
      /WorkspaceBoundaryError|does not belong/,
    );
    assert.equal(jobs.size, 0);
  });
});
