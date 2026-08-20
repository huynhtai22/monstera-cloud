import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import prisma from "@/lib/prisma";
import {
  INITIAL_OAUTH_BACKFILL_DAYS,
  WorkspaceBoundaryError,
  catchupOauthWindow,
  enqueueOauthWarehouseBackfill,
  initialOauthBackfillWindow,
  oauthBackfillIdempotencyKey,
} from "./oauth-warehouse-backfill";

describe("oauth warehouse backfill", () => {
  const jobs = new Map<string, any>();
  const audit: any[] = [];

  beforeEach(() => {
    jobs.clear();
    audit.length = 0;

    (prisma as any).warehouseImportJob = {
      findUnique: async ({ where }: any) => {
        if (where.workspaceId_idempotencyKey) {
          const { workspaceId, idempotencyKey } = where.workspaceId_idempotencyKey;
          for (const item of jobs.values()) {
            if (item.workspaceId === workspaceId && item.idempotencyKey === idempotencyKey) {
              return item;
            }
          }
        }
        return null;
      },
      create: async ({ data }: any) => {
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
        };
        jobs.set(record.id, record);
        return record;
      },
    };
    (prisma as any).auditEvent = {
      create: async ({ data }: any) => {
        assert.ok(!JSON.stringify(data).toLowerCase().includes("token"));
        audit.push(data);
        return data;
      },
    };
  });

  it("uses a 30-day inclusive lookback for new connections", () => {
    const now = new Date(Date.UTC(2026, 7, 20));
    const window = initialOauthBackfillWindow(now);
    assert.equal(window.until, "2026-08-20");
    assert.equal(window.since, "2026-07-22");
    const days =
      (Date.parse(`${window.until}T00:00:00Z`) - Date.parse(`${window.since}T00:00:00Z`)) /
        86400000 +
      1;
    assert.equal(days, INITIAL_OAUTH_BACKFILL_DAYS);
  });

  it("enqueues an initial job with workspace and connection identity", async () => {
    const { job, reused } = await enqueueOauthWarehouseBackfill({
      workspaceId: "ws-a",
      userId: "user-a",
      connectionId: "conn-1",
      connectionWorkspaceId: "ws-a",
      kind: "initial",
    });
    assert.equal(reused, false);
    assert.equal(job.workspaceId, "ws-a");
    assert.equal(job.items[0]?.connectionId, "conn-1");
    assert.equal(job.idempotencyKey, oauthBackfillIdempotencyKey("initial", "conn-1", job.until));
    assert.equal(job.status, "queued");
    const days =
      (Date.parse(`${job.until}T00:00:00Z`) - Date.parse(`${job.since}T00:00:00Z`)) / 86400000 + 1;
    assert.equal(days, 30);
    assert.equal(audit[0]?.action, "warehouse.import_queued");
    assert.equal(audit[0]?.metadata.connectionId, "conn-1");
  });

  it("does not create a duplicate effective job on callback retry", async () => {
    const first = await enqueueOauthWarehouseBackfill({
      workspaceId: "ws-a",
      userId: "user-a",
      connectionId: "conn-1",
      connectionWorkspaceId: "ws-a",
      kind: "initial",
    });
    const second = await enqueueOauthWarehouseBackfill({
      workspaceId: "ws-a",
      userId: "user-a",
      connectionId: "conn-1",
      connectionWorkspaceId: "ws-a",
      kind: "initial",
    });
    assert.equal(second.reused, true);
    assert.equal(second.job.id, first.job.id);
    assert.equal(jobs.size, 1);
  });

  it("uses a catch-up window from lastSyncAt instead of a fresh 30-day load", () => {
    const now = new Date(Date.UTC(2026, 7, 20));
    const lastSyncAt = new Date(Date.UTC(2026, 7, 18));
    const window = catchupOauthWindow(lastSyncAt, now);
    assert.equal(window.until, "2026-08-20");
    assert.equal(window.since, "2026-08-16");
  });

  it("refuses to enqueue a job for another workspace's connection", async () => {
    await assert.rejects(
      () =>
        enqueueOauthWarehouseBackfill({
          workspaceId: "ws-a",
          userId: "user-a",
          connectionId: "conn-b",
          connectionWorkspaceId: "ws-b",
          kind: "initial",
        }),
      WorkspaceBoundaryError
    );
    assert.equal(jobs.size, 0);
  });
});
