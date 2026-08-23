import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plan-config";
import { logger } from "@/lib/logger";
import { requireCronSecret } from "@/lib/request-auth";
import { isPilotMode } from "@/lib/pilot-mode";
import { evaluateStaleHealth } from "@/lib/ingestion/stale-health";
import { withSystemScope } from "@/lib/tenant-guard";

/**
 * GET /api/cron/sync-jobs
 *
 * Runs every minute via Vercel Cron (see vercel.json).
 * Picks up to 10 queued SyncJobs ordered by priority DESC → scheduledAt ASC,
 * then calls the pipeline run endpoint for each one.
 *
 * Priority mapping (from plan-config): enterprise=4, professional=3, starter=2, free=1
 * 10 jobs/min = ~0.17 jobs/sec, well within TikTok's 20 QPS shared limit.
 */

const BATCH_SIZE = 10;
const NIGHTLY_CADENCE_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;

export async function GET(req: Request) {
  // Verify this was called by Vercel Cron and not a public caller
  const denied = requireCronSecret(req);
  if (denied) return denied;
  if (isPilotMode()) {
    return NextResponse.json({ error: "Scheduled destination pipelines are disabled during the agency pilot." }, { status: 410 });
  }

  const now = new Date();

  try {
    const stale = await evaluateStaleHealth(now);
    if (stale.pipelinesMarkedStale > 0) {
      logger.warn(`[SYNC_JOBS_CRON] Marked ${stale.pipelinesMarkedStale} stale pipelines`);
    }
  } catch (err) {
    logger.error("[SYNC_JOBS_CRON] Failed to update stale pipelines:", err);
  }

  // Recover jobs whose worker lease expired (worker crashed/aborted).
  const recovered = await (prisma.syncJob as any).updateMany({
    where: {
      status: "running",
      leaseExpiresAt: { lt: now },
    },
    data: {
      status: "queued",
      startedAt: null,
      leaseId: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      errorMsg: "Lease expired; requeued for retry",
    },
  });

  if (recovered.count > 0) {
    logger.warn(`[SYNC_JOBS_CRON] Recovered ${recovered.count} expired lease jobs`);
  }

  // Enqueue due pipelines for a ~4-hour cadence (respects plan cooldowns).
  // This keeps the queue filled even if nothing explicitly enqueues jobs elsewhere.
  // Fleet sweep across all workspaces — requires the explicit system scope.
  const pipelines = await withSystemScope(async () => {
    return await prisma.pipeline.findMany({
      where: { status: "active" },
      select: {
        id: true,
        lastSyncedAt: true,
        workspace: { select: { ownerId: true, plan: true } },
      },
    });
  });

  const pipelineIds = pipelines.map((p) => p.id);
  const pipelinesWithPendingJobs = pipelineIds.length > 0
    ? await (prisma.syncJob as any).findMany({
      where: {
        pipelineId: { in: pipelineIds },
        status: { in: ["queued", "running"] },
      },
      select: { pipelineId: true },
      distinct: ["pipelineId"],
    })
    : [];
  const pendingPipelineIds = new Set(
    pipelinesWithPendingJobs.map((job: { pipelineId: string }) => job.pipelineId)
  );

  const jobsToCreate: { pipelineId: string; activeKey: string; userId: string; plan: string; status: string; priority: number; scheduledAt: Date }[] = [];

  for (const p of pipelines) {
    const ownerId = p.workspace?.ownerId;
    if (!ownerId) continue;

    const workspacePlan = p.workspace?.plan ?? "pilot";
    const limits = getPlanLimits(workspacePlan);

    const last = p.lastSyncedAt?.getTime() ?? 0;
    if (Date.now() - last < NIGHTLY_CADENCE_MS) continue;

    if (pendingPipelineIds.has(p.id)) continue;

    jobsToCreate.push({
      pipelineId: p.id,
      activeKey: p.id,
      userId: ownerId,
      plan: workspacePlan,
      status: "queued",
      priority: limits.priority,
      scheduledAt: now,
    });
  }

  if (jobsToCreate.length > 0) {
    await (prisma.syncJob as any).createMany({ data: jobsToCreate, skipDuplicates: true });
  }

  // Claim up to BATCH_SIZE queued jobs that are due, highest priority first
  const jobs = await (prisma.syncJob as any).findMany({
    where: {
      status: "queued",
      scheduledAt: { lte: now },
    },
    orderBy: [
      { priority: "desc" },
      { scheduledAt: "asc" },
    ],
    take: BATCH_SIZE,
    include: { pipeline: { select: { workspaceId: true } } },
  });

  if (jobs.length === 0) {
    return NextResponse.json({ processed: 0, message: "No jobs due" });
  }

  // Claim jobs with compare-and-set updates so parallel cron invocations cannot double-run them.
  const claimedJobs: any[] = [];
  for (const job of jobs) {
    const leaseId = randomUUID();
    const claim = await (prisma.syncJob as any).updateMany({
      where: {
        id: job.id,
        status: "queued",
      },
      data: {
        status: "running",
        startedAt: now,
        leaseId,
        leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        heartbeatAt: now,
      },
    });

    if (claim.count === 1) {
      claimedJobs.push({ ...job, leaseId });
    }
  }

  if (claimedJobs.length === 0) {
    logger.info("[SYNC_JOBS_CRON] No jobs claimed after compare-and-set");
    return NextResponse.json({ processed: 0, message: "No jobs claimed" });
  }

  const results: { jobId: string; pipelineId: string; status: string; error?: string }[] = [];

  const computeBackoffMs = (retryCount: number) => {
    // retryCount starts at 0 → first retry waits 2^0 * 60s = 60s
    const minutes = Math.pow(2, Math.max(0, retryCount));
    return minutes * 60_000;
  };

  for (const job of claimedJobs) {
    try {
      const baseUrl = (process.env.NEXTAUTH_URL?.replace(/\/$/, "") || new URL(req.url).origin).replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/pipelines/${job.pipelineId}/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.CRON_SECRET}`,
          "x-sync-job-id": job.id,
        },
      });

      if (res.ok) {
        await (prisma.syncJob as any).update({
          where: { id: job.id },
          data: {
            status: "done",
            finishedAt: new Date(),
            activeKey: null,
            leaseId: null,
            leaseExpiresAt: null,
            heartbeatAt: new Date(),
          },
        });
        results.push({ jobId: job.id, pipelineId: job.pipelineId, status: "done" });
      } else {
        const err = await res.text();
        const errorMsg = err.slice(0, 500);
        const retryCount = Number(job.retryCount ?? 0);
        const maxRetries = Number(job.maxRetries ?? 3);

        if (retryCount < maxRetries) {
          const nextRetryCount = retryCount + 1;
          const delayMs = computeBackoffMs(retryCount);
          await (prisma.syncJob as any).update({
            where: { id: job.id },
            data: {
              status: "queued",
              retryCount: nextRetryCount,
              scheduledAt: new Date(Date.now() + delayMs),
              startedAt: null,
              finishedAt: null,
              errorMsg,
              leaseId: null,
              leaseExpiresAt: null,
              heartbeatAt: new Date(),
            },
          });
          results.push({
            jobId: job.id,
            pipelineId: job.pipelineId,
            status: "queued",
            error: `retry ${nextRetryCount}/${maxRetries} in ${Math.round(delayMs / 1000)}s: ${err.slice(0, 120)}`,
          });
        } else {
          await (prisma.syncJob as any).update({
            where: { id: job.id },
            data: {
              status: "failed",
              finishedAt: new Date(),
              errorMsg,
              activeKey: null,
              leaseId: null,
              leaseExpiresAt: null,
              heartbeatAt: new Date(),
            },
          });
          results.push({ jobId: job.id, pipelineId: job.pipelineId, status: "failed", error: err.slice(0, 200) });
        }
      }
    } catch (err: any) {
      const msg = String(err?.message ?? err).slice(0, 500);
      const retryCount = Number(job.retryCount ?? 0);
      const maxRetries = Number(job.maxRetries ?? 3);

      if (retryCount < maxRetries) {
        const nextRetryCount = retryCount + 1;
        const delayMs = computeBackoffMs(retryCount);
        await (prisma.syncJob as any).update({
          where: { id: job.id },
          data: {
            status: "queued",
            retryCount: nextRetryCount,
            scheduledAt: new Date(Date.now() + delayMs),
            startedAt: null,
            finishedAt: null,
            errorMsg: msg,
            leaseId: null,
            leaseExpiresAt: null,
            heartbeatAt: new Date(),
          },
        });
        results.push({
          jobId: job.id,
          pipelineId: job.pipelineId,
          status: "queued",
          error: `retry ${nextRetryCount}/${maxRetries} in ${Math.round(delayMs / 1000)}s: ${msg.slice(0, 120)}`,
        });
      } else {
        await (prisma.syncJob as any).update({
          where: { id: job.id },
          data: {
            status: "failed",
            finishedAt: new Date(),
            errorMsg: msg,
            activeKey: null,
            leaseId: null,
            leaseExpiresAt: null,
            heartbeatAt: new Date(),
          },
        });
        results.push({ jobId: job.id, pipelineId: job.pipelineId, status: "failed", error: msg.slice(0, 200) });
      }
    }
  }

  logger.info(`[SYNC_JOBS_CRON] Claimed ${claimedJobs.length} jobs, processed ${results.length}`, results);
  return NextResponse.json({ processed: results.length, results });
}
