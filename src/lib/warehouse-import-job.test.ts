import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import prisma from "@/lib/prisma";
import {
  createImportJob,
  claimImportJob,
  heartbeatImportJob,
  updateImportJobProgress,
  completeImportJob,
  failImportJob,
  getImportJob,
  updateImportJob,
} from "./warehouse-import-job";

describe("Warehouse Import Job State Manager", () => {
  // In-memory mock storage for prisma.warehouseImportJob
  const mockDb = new Map<string, any>();

  beforeEach(() => {
    mockDb.clear();

    // Mock prisma.warehouseImportJob methods
    (prisma as any).warehouseImportJob = {
      findUnique: async ({ where }: any) => {
        if (where.id) return mockDb.get(where.id) || null;
        if (where.idempotencyKey) {
          for (const item of mockDb.values()) {
            if (item.idempotencyKey === where.idempotencyKey) return item;
          }
        }
        return null;
      },
      findFirst: async ({ where }: any) => {
        for (const item of mockDb.values()) {
          let match = true;
          if (where.id && item.id !== where.id) match = false;
          if (where.workspaceId && item.workspaceId !== where.workspaceId) match = false;
          if (where.leaseId && item.leaseId !== where.leaseId) match = false;
          if (match) return item;
        }
        return null;
      },
      create: async ({ data }: any) => {
        const record = {
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          retryCount: data.retryCount ?? 0,
          maxRetries: data.maxRetries ?? 3,
        };
        mockDb.set(record.id, record);
        return record;
      },
      update: async ({ where, data }: any) => {
        const existing = mockDb.get(where.id);
        if (!existing) throw new Error("Record not found");
        const updated = {
          ...existing,
          ...data,
          retryCount:
            data.retryCount?.increment !== undefined
              ? existing.retryCount + data.retryCount.increment
              : data.retryCount ?? existing.retryCount,
          updatedAt: new Date(),
        };
        mockDb.set(where.id, updated);
        return updated;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const [id, item] of mockDb.entries()) {
          let match = true;
          if (where.id && item.id !== where.id) match = false;
          if (where.workspaceId && item.workspaceId !== where.workspaceId) match = false;
          if (where.leaseId && item.leaseId !== where.leaseId) match = false;
          if (where.status && item.status !== where.status) match = false;
          if (where.OR) {
            const orMatch = where.OR.some((clause: any) => {
              if (clause.status && item.status !== clause.status) return false;
              if (clause.leaseExpiresAt?.lt) {
                if (!item.leaseExpiresAt || item.leaseExpiresAt >= clause.leaseExpiresAt.lt) {
                  return false;
                }
              }
              return true;
            });
            if (!orMatch) match = false;
          }
          if (match) {
            mockDb.set(id, { ...item, ...data, updatedAt: new Date() });
            count++;
          }
        }
        return { count };
      },
      count: async ({ where }: any) => {
        let count = 0;
        for (const item of mockDb.values()) {
          let match = true;
          if (where.workspaceId && item.workspaceId !== where.workspaceId) match = false;
          if (where.status?.in && !where.status.in.includes(item.status)) match = false;
          if (match) count++;
        }
        return count;
      },
    };
  });

  it("creates, retrieves, and updates an import job state", async () => {
    const jobId = `test_job_${Date.now()}`;
    const initial = await createImportJob({
      id: jobId,
      workspaceId: "test-workspace-123",
      userId: "user-1",
      since: "2026-01-01",
      until: "2026-01-30",
      items: [
        { connectionId: "conn-1", adAccountId: "act-1" },
        { connectionId: "conn-2" },
        { connectionId: "conn-3" },
      ],
    });

    assert.equal(initial.id, jobId);
    assert.equal(initial.status, "queued");
    assert.equal(initial.totalItems, 3);
    assert.equal(initial.completedItems, 0);

    const fetched = await getImportJob(jobId);
    assert.ok(fetched);
    assert.equal(fetched?.workspaceId, "test-workspace-123");

    const updated = await updateImportJob(jobId, {
      status: "running",
      completedItems: 1,
      approximateRows: 150,
      results: [
        {
          connectionId: "conn-1",
          provider: "meta_ads",
          ok: true,
          upserted: 150,
        },
      ],
    });

    assert.ok(updated);
    assert.equal(updated?.status, "running");
    assert.equal(updated?.completedItems, 1);
    assert.equal(updated?.approximateRows, 150);
    assert.equal(updated?.results.length, 1);
  });

  it("atomically claims a queued job with a lease", async () => {
    const jobId = "claim_test_job_1";
    await createImportJob({
      id: jobId,
      workspaceId: "ws-1",
      userId: "user-1",
      since: "2026-02-01",
      until: "2026-02-15",
      items: [{ connectionId: "conn-1" }],
    });

    const claim1 = await claimImportJob(jobId, 30000);
    assert.equal(claim1.claimed, true);
    assert.ok(claim1.leaseId);
    assert.equal(claim1.job?.status, "running");

    // Second claim should fail because lease is active
    const claim2 = await claimImportJob(jobId, 30000);
    assert.equal(claim2.claimed, false);

    // Heartbeat should succeed with valid lease
    const hbSuccess = await heartbeatImportJob(jobId, claim1.leaseId!);
    assert.equal(hbSuccess, true);

    // Heartbeat should fail with invalid lease
    const hbFail = await heartbeatImportJob(jobId, "invalid-lease-id");
    assert.equal(hbFail, false);
  });

  it("updates progress and completes job", async () => {
    const jobId = "progress_test_job";
    await createImportJob({
      id: jobId,
      workspaceId: "ws-1",
      userId: "user-1",
      since: "2026-02-01",
      until: "2026-02-15",
      items: [{ connectionId: "conn-1" }, { connectionId: "conn-2" }],
    });

    const claim = await claimImportJob(jobId);
    assert.equal(claim.claimed, true);

    const progress = await updateImportJobProgress(jobId, claim.leaseId!, {
      completedItems: 1,
      approximateRows: 250,
      results: [{ connectionId: "conn-1", provider: "meta_ads", ok: true, upserted: 250 }],
    });

    assert.equal(progress?.completedItems, 1);
    assert.equal(progress?.approximateRows, 250);

    const completed = await completeImportJob(jobId, claim.leaseId!, {
      completedItems: 2,
      approximateRows: 500,
      results: [
        { connectionId: "conn-1", provider: "meta_ads", ok: true, upserted: 250 },
        { connectionId: "conn-2", provider: "google_ads", ok: true, rowsIngested: 250 },
      ],
    });

    assert.equal(completed?.status, "completed");
    assert.equal(completed?.completedItems, 2);
    assert.equal(completed?.approximateRows, 500);
  });

  it("schedules exponential backoff retries on failure and fails permanently on max retries", async () => {
    const jobId = "retry_test_job";
    await createImportJob({
      id: jobId,
      workspaceId: "ws-1",
      userId: "user-1",
      since: "2026-02-01",
      until: "2026-02-15",
      items: [{ connectionId: "conn-1" }],
    });

    const claim1 = await claimImportJob(jobId);
    // Failure 1 (retryCount -> 1, backoff scheduled)
    const retry1 = await failImportJob(jobId, claim1.leaseId!, "API rate limit 429", true);
    assert.equal(retry1?.status, "queued");
    assert.equal(retry1?.retryCount, 1);

    // Failure 2 (retryCount -> 2)
    const claim2 = await claimImportJob(jobId);
    const retry2 = await failImportJob(jobId, claim2.leaseId!, "API timeout", true);
    assert.equal(retry2?.status, "queued");
    assert.equal(retry2?.retryCount, 2);

    // Failure 3 (retryCount -> 3)
    const claim3 = await claimImportJob(jobId);
    const retry3 = await failImportJob(jobId, claim3.leaseId!, "API timeout 2", true);
    assert.equal(retry3?.status, "queued");
    assert.equal(retry3?.retryCount, 3);

    // Failure 4 (exceeds maxRetries 3 -> status 'failed')
    const claim4 = await claimImportJob(jobId);
    const finalFail = await failImportJob(jobId, claim4.leaseId!, "Fatal auth revoked", true);
    assert.equal(finalFail?.status, "failed");
    assert.equal(finalFail?.error, "Fatal auth revoked");
  });

  it("handles idempotency key deduplication", async () => {
    const key = "idempotent-key-xyz-123";
    const job1 = await createImportJob({
      workspaceId: "ws-1",
      userId: "user-1",
      since: "2026-01-01",
      until: "2026-01-10",
      items: [{ connectionId: "conn-1" }],
      idempotencyKey: key,
    });

    const job2 = await createImportJob({
      workspaceId: "ws-1",
      userId: "user-1",
      since: "2026-01-01",
      until: "2026-01-10",
      items: [{ connectionId: "conn-1" }],
      idempotencyKey: key,
    });

    assert.equal(job1.id, job2.id);
  });

  it("enforces workspace scoping on getImportJob", async () => {
    const jobId = "scope_test_job";
    await createImportJob({
      id: jobId,
      workspaceId: "workspace-alpha",
      userId: "user-1",
      since: "2026-01-01",
      until: "2026-01-10",
      items: [{ connectionId: "conn-1" }],
    });

    const allowed = await getImportJob(jobId, "workspace-alpha");
    assert.ok(allowed);
    assert.equal(allowed?.id, jobId);

    const denied = await getImportJob(jobId, "workspace-bravo");
    assert.equal(denied, null);
  });
});
