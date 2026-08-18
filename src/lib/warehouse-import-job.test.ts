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
  LeaseLostError,
} from "./warehouse-import-job";

describe("Warehouse Import Job State Manager & Concurrency Fencing", () => {
  const mockDb = new Map<string, any>();

  beforeEach(() => {
    mockDb.clear();

    (prisma as any).warehouseImportJob = {
      findUnique: async ({ where }: any) => {
        if (where.id) return mockDb.get(where.id) || null;
        if (where.workspaceId_idempotencyKey) {
          const { workspaceId, idempotencyKey } = where.workspaceId_idempotencyKey;
          for (const item of mockDb.values()) {
            if (item.workspaceId === workspaceId && item.idempotencyKey === idempotencyKey) {
              return item;
            }
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
          if (where.status && item.status !== where.status) match = false;
          if (where.OR) {
            const orMatch = where.OR.some((clause: any) => {
              if (clause.status === "queued" && item.status === "queued") {
                if (clause.scheduledAt?.lte && item.scheduledAt > clause.scheduledAt.lte) return false;
                return true;
              }
              if (clause.status === "running" && item.status === "running") {
                if (clause.leaseExpiresAt?.lt && item.leaseExpiresAt < clause.leaseExpiresAt.lt) return true;
                return false;
              }
              return false;
            });
            if (!orMatch) match = false;
          }
          if (match) return item;
        }
        return null;
      },
      create: async ({ data }: any) => {
        // Enforce composite unique constraint (workspaceId, idempotencyKey)
        if (data.idempotencyKey) {
          for (const item of mockDb.values()) {
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
          retryCount: data.retryCount ?? 0,
          maxRetries: data.maxRetries ?? 3,
        };
        mockDb.set(record.id, record);
        return record;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        const now = new Date();
        for (const [id, item] of mockDb.entries()) {
          let match = true;
          if (where.id && item.id !== where.id) match = false;
          if (where.workspaceId && item.workspaceId !== where.workspaceId) match = false;
          if (where.leaseId && item.leaseId !== where.leaseId) match = false;
          if (where.status && item.status !== where.status) match = false;
          if (where.leaseExpiresAt?.gte && item.leaseExpiresAt < where.leaseExpiresAt.gte) {
            match = false;
          }
          if (where.OR) {
            const orMatch = where.OR.some((clause: any) => {
              if (clause.status === "queued" && item.status === "queued") return true;
              if (clause.status === "running" && item.status === "running") {
                if (clause.leaseExpiresAt?.lt && item.leaseExpiresAt < now) return true;
                return false;
              }
              return false;
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
    };
  });

  it("creates and retrieves a durable import job", async () => {
    const jobId = "import_test_init";
    const job = await createImportJob({
      id: jobId,
      workspaceId: "ws-test",
      userId: "user-1",
      since: "2026-01-01",
      until: "2026-01-15",
      items: [{ connectionId: "conn-1" }],
    });

    assert.equal(job.id, jobId);
    assert.equal(job.status, "queued");
    assert.equal(job.totalItems, 1);

    const fetched = await getImportJob(jobId, "ws-test");
    assert.ok(fetched);
    assert.equal(fetched?.id, jobId);
  });

  it("atomically claims a job with a lease and generates unique lease identity", async () => {
    const jobId = "claim_test_job";
    await createImportJob({
      id: jobId,
      workspaceId: "ws-1",
      userId: "user-1",
      since: "2026-01-01",
      until: "2026-01-15",
      items: [{ connectionId: "conn-1" }],
    });

    const claim1 = await claimImportJob(jobId, 30000);
    assert.equal(claim1.claimed, true);
    assert.ok(claim1.leaseId);
    assert.equal(claim1.job?.status, "running");

    // Second worker cannot claim active running job
    const claim2 = await claimImportJob(jobId, 30000);
    assert.equal(claim2.claimed, false);
  });

  it("CONCURRENCY FENCING: Worker A cannot mutate progress, fail, or complete after Worker B reclaims expired lease", async () => {
    const jobId = "fencing_test_job";
    await createImportJob({
      id: jobId,
      workspaceId: "ws-1",
      userId: "user-1",
      since: "2026-01-01",
      until: "2026-01-15",
      items: [{ connectionId: "conn-1" }],
    });

    // 1. Worker A claims job with a short lease (e.g. 50ms)
    const workerA = await claimImportJob(jobId, 50);
    assert.equal(workerA.claimed, true);
    const leaseA = workerA.leaseId!;

    // 2. Simulate lease expiration for Worker A
    const rawJob = mockDb.get(jobId);
    rawJob.leaseExpiresAt = new Date(Date.now() - 1000); // expired in past

    // 3. Worker B reclaims the expired job
    const workerB = await claimImportJob(jobId, 60000);
    assert.equal(workerB.claimed, true);
    const leaseB = workerB.leaseId!;
    assert.notEqual(leaseA, leaseB);

    // 4. Stale Worker A attempts progress update -> Must throw LeaseLostError
    await assert.rejects(
      async () => {
        await updateImportJobProgress(jobId, leaseA, {
          completedItems: 1,
          approximateRows: 100,
          results: [{ connectionId: "conn-1", provider: "meta", ok: true }],
        });
      },
      (err: any) => err instanceof LeaseLostError
    );

    // 5. Stale Worker A attempts heartbeat -> Must throw LeaseLostError
    await assert.rejects(
      async () => {
        await heartbeatImportJob(jobId, leaseA);
      },
      (err: any) => err instanceof LeaseLostError
    );

    // 6. Stale Worker A attempts completion -> Must throw LeaseLostError
    await assert.rejects(
      async () => {
        await completeImportJob(jobId, leaseA, [{ connectionId: "conn-1", provider: "meta", ok: true }], 100);
      },
      (err: any) => err instanceof LeaseLostError
    );

    // 7. Active Worker B updates progress and completes successfully
    const validProgress = await updateImportJobProgress(jobId, leaseB, {
      completedItems: 1,
      approximateRows: 250,
    });
    assert.equal(validProgress.completedItems, 1);

    const validComplete = await completeImportJob(
      jobId,
      leaseB,
      [{ connectionId: "conn-1", provider: "meta", ok: true, rowsIngested: 250 }],
      250
    );
    assert.equal(validComplete.status, "completed");
  });

  it("CONCURRENCY FENCING: Worker cannot update, fail, or complete if lease expired even BEFORE another worker claims it", async () => {
    const jobId = "expired_unclaimed_job";
    await createImportJob({
      id: jobId,
      workspaceId: "ws-expire-test",
      userId: "user-1",
      since: "2026-01-01",
      until: "2026-01-15",
      items: [{ connectionId: "conn-1" }],
    });

    const worker = await claimImportJob(jobId, 50);
    assert.equal(worker.claimed, true);
    const leaseId = worker.leaseId!;

    // Expire the lease in the past
    const rawJob = mockDb.get(jobId);
    rawJob.leaseExpiresAt = new Date(Date.now() - 5000);

    // 1. updateImportJobProgress must throw LeaseLostError
    await assert.rejects(
      async () => {
        await updateImportJobProgress(jobId, leaseId, { completedItems: 1 });
      },
      (err: any) => err instanceof LeaseLostError
    );

    // 2. failImportJob must throw LeaseLostError
    await assert.rejects(
      async () => {
        await failImportJob(jobId, leaseId, "Network failure");
      },
      (err: any) => err instanceof LeaseLostError
    );

    // 3. completeImportJob must throw LeaseLostError
    await assert.rejects(
      async () => {
        await completeImportJob(jobId, leaseId, [], 0);
      },
      (err: any) => err instanceof LeaseLostError
    );

    // 4. heartbeatImportJob must throw LeaseLostError
    await assert.rejects(
      async () => {
        await heartbeatImportJob(jobId, leaseId);
      },
      (err: any) => err instanceof LeaseLostError
    );
  });

  it("SCOPED IDEMPOTENCY: Same workspace returns existing job; different workspace creates separate job", async () => {
    const sharedKey = "idempotent-shared-key-999";

    // 1. Workspace A creates job with sharedKey
    const jobA1 = await createImportJob({
      workspaceId: "workspace-alpha",
      userId: "user-alpha",
      since: "2026-01-01",
      until: "2026-01-10",
      items: [{ connectionId: "conn-alpha" }],
      idempotencyKey: sharedKey,
    });

    // 2. Workspace A creates job again with same key -> Returns existing jobA1
    const jobA2 = await createImportJob({
      workspaceId: "workspace-alpha",
      userId: "user-alpha",
      since: "2026-01-01",
      until: "2026-01-10",
      items: [{ connectionId: "conn-alpha" }],
      idempotencyKey: sharedKey,
    });
    assert.equal(jobA1.id, jobA2.id);

    // 3. Workspace B creates job with identical key -> Creates distinct separate job
    const jobB = await createImportJob({
      workspaceId: "workspace-beta",
      userId: "user-beta",
      since: "2026-01-01",
      until: "2026-01-10",
      items: [{ connectionId: "conn-beta" }],
      idempotencyKey: sharedKey,
    });
    assert.notEqual(jobA1.id, jobB.id);
    assert.equal(jobB.workspaceId, "workspace-beta");
  });

  it("TENANT ISOLATION: getImportJob rejects access across workspace boundaries", async () => {
    const jobId = "secret_import_job";
    await createImportJob({
      id: jobId,
      workspaceId: "workspace-private",
      userId: "user-private",
      since: "2026-01-01",
      until: "2026-01-10",
      items: [{ connectionId: "conn-1" }],
    });

    const allowed = await getImportJob(jobId, "workspace-private");
    assert.ok(allowed);
    assert.equal(allowed?.id, jobId);

    const unauthorized = await getImportJob(jobId, "workspace-attacker");
    assert.equal(unauthorized, null);
  });

  it("RETRY STRATEGY: Bounded exponential backoff and terminal failure on max retries", async () => {
    const jobId = "backoff_retry_job";
    await createImportJob({
      id: jobId,
      workspaceId: "ws-1",
      userId: "user-1",
      since: "2026-01-01",
      until: "2026-01-10",
      items: [{ connectionId: "conn-1" }],
    });

    // Attempt 1: failure -> retry 1
    const claim1 = await claimImportJob(jobId);
    const r1 = await failImportJob(jobId, claim1.leaseId!, "Temporary 503");
    assert.equal(r1.status, "queued");
    assert.equal(r1.retryCount, 1);

    // Attempt 2: failure -> retry 2
    const claim2 = await claimImportJob(jobId);
    const r2 = await failImportJob(jobId, claim2.leaseId!, "Temporary 503 again");
    assert.equal(r2.status, "queued");
    assert.equal(r2.retryCount, 2);

    // Attempt 3: failure -> retry 3
    const claim3 = await claimImportJob(jobId);
    const r3 = await failImportJob(jobId, claim3.leaseId!, "Temporary 503 third time");
    assert.equal(r3.status, "queued");
    assert.equal(r3.retryCount, 3);

    // Attempt 4: exceeds maxRetries (3) -> terminal failure
    const claim4 = await claimImportJob(jobId);
    const finalFail = await failImportJob(jobId, claim4.leaseId!, "Permanent auth failure");
    assert.equal(finalFail.status, "failed");
    assert.equal(finalFail.errorMsg, "Permanent auth failure");
  });
});
