import assert from "node:assert/strict";
import { assertCiDatabaseReachable, assertCiDatabaseReachableWhenMissing } from "./pg-test-discipline";
import { describe, it, before, after } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  createImportJob,
  claimImportJob,
  updateImportJobProgress,
  completeImportJob,
  failImportJob,
  LeaseLostError,
} from "./warehouse-import-job";

describe("PostgreSQL Integration: Real Database Atomicity & Concurrency Fencing", () => {
  let prisma: PrismaClient | null = null;
  let isDbAvailable = false;
      isDbAvailable = false;

  const testWorkspace1 = "ws_pg_test_1";
  const testWorkspace2 = "ws_pg_test_2";
  const testUser = "usr_pg_test_1";

  before(async () => {
    assertCiDatabaseReachableWhenMissing();
    if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("mock")) {
      try {
        prisma = new PrismaClient();
        await prisma.$connect();
        await prisma.$queryRaw`SELECT 1`;
        isDbAvailable = true;

        // Ensure prerequisite test user and workspace records exist
        await prisma.user.upsert({
          where: { id: testUser },
          update: {},
          create: { id: testUser, email: "pg-test@example.com", name: "PG Test User" },
        });

        await prisma.workspace.upsert({
          where: { id: testWorkspace1 },
          update: {},
          create: { id: testWorkspace1, name: "PG Test Workspace 1", slug: "pg-test-ws-1", ownerId: testUser, plan: "pilot" },
        });

        await prisma.workspace.upsert({
          where: { id: testWorkspace2 },
          update: {},
          create: { id: testWorkspace2, name: "PG Test Workspace 2", slug: "pg-test-ws-2", ownerId: testUser, plan: "pilot" },
        });
      } catch {
        assertCiDatabaseReachable();
        isDbAvailable = false;
      }
    }
  });

  after(async () => {
    if (prisma && isDbAvailable) {
      try {
        await prisma.warehouseImportJob.deleteMany({
          where: { workspaceId: { in: [testWorkspace1, testWorkspace2] } },
        });
        await prisma.$disconnect();
      } catch {}
    }
  });

  it("REAL POSTGRES CONCURRENCY: Two workers concurrently claiming the same job results in exactly one claim", async (t) => {
    if (!isDbAvailable) {
      t.skip("PostgreSQL database not reachable; run with real DATABASE_URL in CI");
      return;
    }

    const job = await createImportJob({
      workspaceId: testWorkspace1,
      userId: testUser,
      since: "2026-01-01",
      until: "2026-01-10",
      items: [{ connectionId: "conn-1" }],
    });

    // Concurrently invoke claimImportJob with Promise.all
    const [claimA, claimB] = await Promise.all([
      claimImportJob(job.id, 60000),
      claimImportJob(job.id, 60000),
    ]);

    // Exactly one worker must succeed; the other must receive claimed: false
    const successCount = (claimA.claimed ? 1 : 0) + (claimB.claimed ? 1 : 0);
    assert.equal(successCount, 1);

    const winnerLease = claimA.claimed ? claimA.leaseId : claimB.leaseId;
    assert.ok(winnerLease);
  });

  it("REAL POSTGRES CONCURRENCY: Concurrent same-workspace creation with identical idempotencyKey creates 1 row and exercises P2002 recovery", async (t) => {
    if (!isDbAvailable) {
      t.skip("PostgreSQL database not reachable; run with real DATABASE_URL in CI");
      return;
    }

    const sharedKey = `idem_pg_race_${Date.now()}`;

    // Execute 5 concurrent createImportJob calls with identical workspace and idempotencyKey
    const jobs = await Promise.all([
      createImportJob({ workspaceId: testWorkspace1, userId: testUser, since: "2026-01-01", until: "2026-01-10", items: [{ connectionId: "c1" }], idempotencyKey: sharedKey }),
      createImportJob({ workspaceId: testWorkspace1, userId: testUser, since: "2026-01-01", until: "2026-01-10", items: [{ connectionId: "c1" }], idempotencyKey: sharedKey }),
      createImportJob({ workspaceId: testWorkspace1, userId: testUser, since: "2026-01-01", until: "2026-01-10", items: [{ connectionId: "c1" }], idempotencyKey: sharedKey }),
      createImportJob({ workspaceId: testWorkspace1, userId: testUser, since: "2026-01-01", until: "2026-01-10", items: [{ connectionId: "c1" }], idempotencyKey: sharedKey }),
      createImportJob({ workspaceId: testWorkspace1, userId: testUser, since: "2026-01-01", until: "2026-01-10", items: [{ connectionId: "c1" }], idempotencyKey: sharedKey }),
    ]);

    // All 5 returned states must share the exact same job ID
    const firstId = jobs[0].id;
    for (const j of jobs) {
      assert.equal(j.id, firstId);
    }

    // Verify in PostgreSQL table that exactly ONE record was inserted
    const dbCount = await prisma!.warehouseImportJob.count({
      where: { workspaceId: testWorkspace1, idempotencyKey: sharedKey },
    });
    assert.equal(dbCount, 1);
  });

  it("REAL POSTGRES CONCURRENCY: Different workspaces independently reuse the same idempotency key", async (t) => {
    if (!isDbAvailable) {
      t.skip("PostgreSQL database not reachable; run with real DATABASE_URL in CI");
      return;
    }

    const sharedKey = `idem_cross_ws_${Date.now()}`;

    const [job1, job2] = await Promise.all([
      createImportJob({ workspaceId: testWorkspace1, userId: testUser, since: "2026-01-01", until: "2026-01-10", items: [{ connectionId: "c1" }], idempotencyKey: sharedKey }),
      createImportJob({ workspaceId: testWorkspace2, userId: testUser, since: "2026-01-01", until: "2026-01-10", items: [{ connectionId: "c1" }], idempotencyKey: sharedKey }),
    ]);

    assert.notEqual(job1.id, job2.id);
    assert.equal(job1.workspaceId, testWorkspace1);
    assert.equal(job2.workspaceId, testWorkspace2);

    const count = await prisma!.warehouseImportJob.count({
      where: { idempotencyKey: sharedKey },
    });
    assert.equal(count, 2);
  });

  it("REAL POSTGRES FENCING: Stale/expired worker cannot update progress, fail, or complete after lease expiry in PostgreSQL", async (t) => {
    if (!isDbAvailable) {
      t.skip("PostgreSQL database not reachable; run with real DATABASE_URL in CI");
      return;
    }

    const job = await createImportJob({
      workspaceId: testWorkspace1,
      userId: testUser,
      since: "2026-01-01",
      until: "2026-01-10",
      items: [{ connectionId: "conn-1" }],
    });

    // Claim with 50ms lease duration
    const workerA = await claimImportJob(job.id, 50);
    assert.equal(workerA.claimed, true);
    const leaseA = workerA.leaseId!;

    // Wait 100ms for lease to expire in PostgreSQL
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Stale Worker A attempts update -> PostgreSQL leaseExpiresAt check rejects with LeaseLostError
    await assert.rejects(
      async () => {
        await updateImportJobProgress(job.id, leaseA, { completedItems: 1 });
      },
      (err: any) => err instanceof LeaseLostError
    );

    // Stale Worker A attempts fail -> PostgreSQL rejects with LeaseLostError
    await assert.rejects(
      async () => {
        await failImportJob(job.id, leaseA, "Stale worker error");
      },
      (err: any) => err instanceof LeaseLostError
    );

    // Stale Worker A attempts complete -> PostgreSQL rejects with LeaseLostError
    await assert.rejects(
      async () => {
        await completeImportJob(job.id, leaseA, [], 0);
      },
      (err: any) => err instanceof LeaseLostError
    );

    // Worker B claims the expired job from PostgreSQL
    const workerB = await claimImportJob(job.id, 60000);
    assert.equal(workerB.claimed, true);
    const leaseB = workerB.leaseId!;
    assert.notEqual(leaseA, leaseB);

    // Worker B completes the job successfully in PostgreSQL
    const completed = await completeImportJob(job.id, leaseB, [{ connectionId: "conn-1", provider: "meta_ads", ok: true }], 100);
    assert.equal(completed.status, "completed");
  });
});
