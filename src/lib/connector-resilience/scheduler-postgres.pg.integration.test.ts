/**
 * PostgreSQL Integration Suite: Real Job Scheduler, Lease Fencing, Crash Recovery & Idempotency
 *
 * Runs against a disposable loopback PostgreSQL database to verify:
 * 1. Real WarehouseImportJob granularity (1 job = N items) and FIFO / priority claim ordering.
 * 2. Why workspace-level job claiming does not interleave items within a single multi-account job.
 * 3. Real worker crash simulation, lease expiration, and atomic reclaim.
 * 4. Fencing token advancement and stale-worker write rejection (LeaseLostError / SyncLease error).
 * 5. Concurrent connection lease mutual exclusion (acquireConnectionSyncLease).
 * 6. Warehouse metric row upsert idempotency (CampaignMetric).
 */

import assert from "node:assert/strict";
import { describe, it, before, after, beforeEach } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  createImportJob,
  claimImportJob,
  claimNextImportJob,
  updateImportJobProgress,
  completeImportJob,
  LeaseLostError,
  type BatchImportItem,
} from "@/lib/warehouse-import-job";
import {
  acquireConnectionSyncLease,
  assertConnectionSyncLease,
  releaseConnectionSyncLease,
} from "@/lib/connection-sync-lease";
import { ingestMetaRows } from "@/lib/meta-ingest";
import { acquireMetaSyncLock } from "@/lib/meta-sync-lock";
import { assertConnectorResilienceTestDatabase } from "@/lib/pg-test-discipline";

const DB_URL = assertConnectorResilienceTestDatabase();

describe("PostgreSQL Integration: Real Scheduler, Leases, Crashes & Idempotency", () => {
  let prisma: PrismaClient;

  const wsHeavy = "ws_sched_heavy";
  const wsSmall1 = "ws_sched_small_1";
  const wsSmall2 = "ws_sched_small_2";
  const testUser = "usr_sched_test";
  const testConn = "conn_sched_test_1";

  before(async () => {
    prisma = new PrismaClient({
        datasources: { db: { url: DB_URL } },
      });
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;

      // Ensure test user and workspaces exist
      await prisma.user.upsert({
        where: { id: testUser },
        update: {},
        create: { id: testUser, email: "scheduler-test@example.com", name: "Scheduler Test User" },
      });

      for (const wsId of [wsHeavy, wsSmall1, wsSmall2]) {
        await prisma.workspace.upsert({
          where: { id: wsId },
          update: {},
          create: { id: wsId, name: `Workspace ${wsId}`, slug: wsId, ownerId: testUser, plan: "pilot" },
        });
      }

      await prisma.connection.upsert({
        where: { id: testConn },
        update: {},
        create: {
          id: testConn,
          workspaceId: wsSmall1,
          name: "Test Connection",
          provider: "meta_ads",
          type: "source",
          status: "connected",
          credentials: "encrypted-creds",
          remoteAccountId: "act_1001",
        },
      });
  });

  beforeEach(async () => {
      await prisma.warehouseImportJob.deleteMany({
        where: { workspaceId: { in: [wsHeavy, wsSmall1, wsSmall2] } },
      });
      await (prisma as any).syncLock.deleteMany({
        where: { workspaceId: { in: [wsHeavy, wsSmall1, wsSmall2] } },
      });
      await prisma.campaignMetric.deleteMany({
        where: { workspaceId: { in: [wsHeavy, wsSmall1, wsSmall2] } },
      });
  });

  after(async () => {
      await prisma.warehouseImportJob.deleteMany({
        where: { workspaceId: { in: [wsHeavy, wsSmall1, wsSmall2] } },
      });
      await (prisma as any).syncLock.deleteMany({
        where: { workspaceId: { in: [wsHeavy, wsSmall1, wsSmall2] } },
      });
      await prisma.campaignMetric.deleteMany({
        where: { workspaceId: { in: [wsHeavy, wsSmall1, wsSmall2] } },
      });
      await prisma.$disconnect();
  });

  it("SCHEDULER FINDING 1 (Job Granularity): One claimed job contains all 50 items and is processed in a single lease", async () => {

    // Heavy tenant creates 1 job with 50 account items
    const heavyItems: BatchImportItem[] = Array.from({ length: 50 }, (_, i) => ({
      connectionId: "conn-heavy",
      accountId: `act_heavy_${i + 1}`,
    }));

    const job = await createImportJob({
      workspaceId: wsHeavy,
      userId: testUser,
      since: "2026-01-01",
      until: "2026-01-30",
      items: heavyItems,
      priority: 1,
    });

    assert.equal(job.totalItems, 50);
    assert.equal(job.items.length, 50);

    // Worker claims the next job
    const claim = await claimNextImportJob(60000);
    assert.equal(claim.claimed, true);
    assert.equal(claim.job?.id, job.id);
    assert.equal(claim.job?.workspaceId, wsHeavy);
    assert.equal(claim.job?.items.length, 50);

    // EVIDENCE: The worker holds the lease for all 50 items.
    // Workspace-level round-robin job claiming operates on rows in WarehouseImportJob;
    // it DOES NOT interleave items inside this single multi-item job!
  });

  it("SCHEDULER FINDING 2 (Claim Ordering & Eligibility): When both jobs are due, Priority DESC takes precedence; future scheduled jobs are not claimed until due", async () => {

    const past1 = new Date(Date.now() - 10000);
    const past2 = new Date(Date.now() - 5000);
    const future = new Date(Date.now() + 60000);

    // Scenario 2A: Both due now. Job A (Priority 1, past1) vs Job B (Priority 10, past2).
    const jobA = await createImportJob({
      id: "job_standard_early",
      workspaceId: wsSmall1,
      userId: testUser,
      since: "2026-01-01",
      until: "2026-01-30",
      items: [{ connectionId: "conn-1" }],
      priority: 1,
    });
    await prisma.warehouseImportJob.update({
      where: { id: jobA.id },
      data: { scheduledAt: past1 },
    });

    const jobB = await createImportJob({
      id: "job_enterprise_later",
      workspaceId: wsSmall2,
      userId: testUser,
      since: "2026-01-01",
      until: "2026-01-30",
      items: [{ connectionId: "conn-2" }],
      priority: 10,
    });
    await prisma.warehouseImportJob.update({
      where: { id: jobB.id },
      data: { scheduledAt: past2 },
    });

    // Job C: High priority (20) but scheduled in the future (+60s retry delay)
    const jobC = await createImportJob({
      id: "job_future_retry",
      workspaceId: wsSmall2,
      userId: testUser,
      since: "2026-01-01",
      until: "2026-01-30",
      items: [{ connectionId: "conn-3" }],
      priority: 20,
    });
    await prisma.warehouseImportJob.update({
      where: { id: jobC.id },
      data: { scheduledAt: future },
    });

    // First claim: Job B (Priority 10) must be claimed FIRST because both A and B are due, and B has higher priority.
    // Job C (Priority 20) is ignored because scheduledAt is in the future.
    const firstClaim = await claimNextImportJob(60000);
    assert.equal(firstClaim.claimed, true);
    assert.equal(firstClaim.job?.id, jobB.id);

    // Second claim: Job A (Priority 1) is claimed next.
    const secondClaim = await claimNextImportJob(60000);
    assert.equal(secondClaim.claimed, true);
    assert.equal(secondClaim.job?.id, jobA.id);

    // Third claim: No eligible jobs remain (Job C is still in future).
    const thirdClaim = await claimNextImportJob(60000);
    assert.equal(thirdClaim.claimed, false);
  });

  it("CRASH RECOVERY: Orphaned job with expired lease is reclaimed; stale worker update throws LeaseLostError", async () => {

    const job = await createImportJob({
      workspaceId: wsSmall1,
      userId: testUser,
      since: "2026-01-01",
      until: "2026-01-30",
      items: [{ connectionId: "conn-crash-test" }],
      priority: 1,
    });

    // Worker 1 claims job with 10s lease
    const claim1 = await claimImportJob(job.id, 10000);
    assert.equal(claim1.claimed, true);
    const leaseId1 = claim1.leaseId!;

    // Worker 1 simulates crash: stops heartbeating and lease expires in DB
    const pastDate = new Date(Date.now() - 5000);
    await prisma.warehouseImportJob.update({
      where: { id: job.id },
      data: { leaseExpiresAt: pastDate },
    });

    // Worker 2 reclaims the expired running job
    const claim2 = await claimNextImportJob(60000);
    assert.equal(claim2.claimed, true);
    assert.equal(claim2.job?.id, job.id);
    const leaseId2 = claim2.leaseId!;
    assert.notEqual(leaseId1, leaseId2);

    // Worker 1 (stale/revived) attempts to update progress with leaseId1 -> LeaseLostError
    await assert.rejects(
      async () => {
        await updateImportJobProgress(job.id, leaseId1, { completedItems: 1 });
      },
      (err: unknown) => {
        assert.ok(err instanceof LeaseLostError);
        return true;
      }
    );

    // Worker 1 attempts to complete job with leaseId1 -> LeaseLostError
    await assert.rejects(
      async () => {
        await completeImportJob(job.id, leaseId1, [], 0, "completed");
      },
      (err: unknown) => {
        assert.ok(err instanceof LeaseLostError);
        return true;
      }
    );

    // Worker 2 successfully completes the job under active leaseId2
    const completed = await completeImportJob(job.id, leaseId2, [{ connectionId: "conn-crash-test", provider: "meta_ads", ok: true }], 10, "completed");
    assert.equal(completed.status, "completed");
    assert.equal(completed.completedItems, 1);
  });

  it("CONNECTION LEASE & FENCING: Concurrent sync attempts serialize; stolen lease throws on outcome persistence", async () => {

    // Worker A acquires lease for connection
    const attemptA = await acquireConnectionSyncLease({
      provider: "meta_ads",
      workspaceId: wsSmall1,
      connectionId: testConn,
      jobId: "job-worker-a",
    });
    assert.equal(attemptA.acquired, true);
    const leaseA = (attemptA as { acquired: true; lease: any }).lease;
    assert.equal(leaseA.fencingToken, BigInt(1));

    // Worker B attempts to acquire lease for the SAME connection concurrently -> refused
    const attemptB = await acquireConnectionSyncLease({
      provider: "meta_ads",
      workspaceId: wsSmall1,
      connectionId: testConn,
      jobId: "job-worker-b",
    });
    assert.equal(attemptB.acquired, false);
    assert.equal((attemptB as any).reason, "active");

    // Simulate Worker A lease expiring in DB
    await (prisma as any).syncLock.update({
      where: { scope: leaseA.scope },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });

    // Worker B can now steal/acquire the expired lease, advancing the monotonic fencing token to 2
    const attemptB2 = await acquireConnectionSyncLease({
      provider: "meta_ads",
      workspaceId: wsSmall1,
      connectionId: testConn,
      jobId: "job-worker-b",
    });
    assert.equal(attemptB2.acquired, true);
    const leaseB2 = (attemptB2 as { acquired: true; lease: any }).lease;
    assert.equal(leaseB2.fencingToken, BigInt(2));

    // Worker A (stale) asserts its old lease -> Fencing check fails!
    await assert.rejects(
      async () => {
        await assertConnectionSyncLease(leaseA);
      },
      (err: unknown) => {
        assert.match(String(err), /Stale worker detected/);
        return true;
      }
    );

    // Clean up
    await releaseConnectionSyncLease(leaseB2, true);
  });

  it("METRIC IDEMPOTENCY: Repeated ingestion of identical warehouse rows produces zero duplicates", async () => {

    const lock = await acquireMetaSyncLock({
      workspaceId: wsSmall1,
      connectionId: testConn,
      adAccountId: "act_1001",
      jobId: "test-idempotency",
    });
    assert.equal(lock.acquired, true);
    const metaLock = lock as { scope: string; leaseId: string; fencingToken: bigint };

    const sampleRows = [
      {
        campaign_id: "cmp_idemp_1",
        campaign_name: "Idempotent Campaign 1",
        adset_id: "adset_1",
        ad_id: "ad_1",
        date_start: "2026-01-01",
        date_stop: "2026-01-01",
        spend: "100.00",
        impressions: "5000",
        clicks: "200",
      },
      {
        campaign_id: "cmp_idemp_1",
        campaign_name: "Idempotent Campaign 1",
        adset_id: "adset_1",
        ad_id: "ad_1",
        date_start: "2026-01-02",
        date_stop: "2026-01-02",
        spend: "150.00",
        impressions: "7000",
        clicks: "250",
      },
    ];

    // First Ingestion
    const firstIngest = await ingestMetaRows({
      workspaceId: wsSmall1,
      connectionId: testConn,
      accountId: "act_1001",
      accountName: "Test Account",
      currency: "USD",
      level: "ad",
      rows: sampleRows,
      syncJobId: "job-1",
      lockScope: metaLock.scope,
      leaseId: metaLock.leaseId,
      fencingToken: metaLock.fencingToken,
    });
    assert.equal(firstIngest.upserted, 2);
    assert.equal(firstIngest.failed, 0);

    const countAfterFirst = await prisma.campaignMetric.count({
      where: { workspaceId: wsSmall1, connectionId: testConn },
    });
    assert.equal(countAfterFirst, 2);

    // Second Ingestion (exact same rows re-delivered / retried)
    const secondIngest = await ingestMetaRows({
      workspaceId: wsSmall1,
      connectionId: testConn,
      accountId: "act_1001",
      accountName: "Test Account",
      currency: "USD",
      level: "ad",
      rows: sampleRows,
      syncJobId: "job-2",
      lockScope: metaLock.scope,
      leaseId: metaLock.leaseId,
      fencingToken: metaLock.fencingToken,
    });
    assert.equal(secondIngest.upserted, 2);
    assert.equal(secondIngest.failed, 0);

    // Total count MUST remain exactly 2 in PostgreSQL
    const countAfterSecond = await prisma.campaignMetric.count({
      where: { workspaceId: wsSmall1, connectionId: testConn },
    });
    assert.equal(countAfterSecond, 2);
  });
});
