import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plan-config";
import { logger } from "@/lib/logger";

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
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

export async function GET(req: Request) {
  // Verify this was called by Vercel Cron and not a public caller
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Enqueue due pipelines for a ~4-hour cadence (respects plan cooldowns).
  // This keeps the queue filled even if nothing explicitly enqueues jobs elsewhere.
  const pipelines = await prisma.pipeline.findMany({
    where: { status: "active" },
    select: {
      id: true,
      lastSyncedAt: true,
      workspace: { select: { ownerId: true } },
    },
  });

  const ownerIds = Array.from(new Set(
    pipelines
      .map((p) => p.workspace?.ownerId)
      .filter((id): id is string => Boolean(id))
  ));

  const owners = ownerIds.length > 0
    ? await prisma.user.findMany({
      where: { id: { in: ownerIds } },
      select: { id: true, plan: true },
    })
    : [];

  const ownerPlanMap = new Map(owners.map((u) => [u.id, u.plan] as const));

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

  const jobsToCreate: { pipelineId: string; userId: string; plan: string; status: string; priority: number; scheduledAt: Date }[] = [];

  for (const p of pipelines) {
    const ownerId = p.workspace?.ownerId;
    if (!ownerId) continue;

    const ownerPlan = ownerPlanMap.get(ownerId) ?? "free";
    const limits = getPlanLimits(ownerPlan);
    const cadenceMs = Math.max(FOUR_HOURS_MS, limits.syncIntervalMs);

    const last = p.lastSyncedAt?.getTime() ?? 0;
    if (Date.now() - last < cadenceMs) continue;

    if (pendingPipelineIds.has(p.id)) continue;

    jobsToCreate.push({
      pipelineId: p.id,
      userId: ownerId,
      plan: ownerPlan,
      status: "queued",
      priority: limits.priority,
      scheduledAt: now,
    });
  }

  if (jobsToCreate.length > 0) {
    await (prisma.syncJob as any).createMany({ data: jobsToCreate });
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
    const claim = await (prisma.syncJob as any).updateMany({
      where: { id: job.id, status: "queued" },
      data: { status: "running", startedAt: now },
    });

    if (claim.count === 1) {
      claimedJobs.push(job);
    }
  }

  if (claimedJobs.length === 0) {
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
          // Internal cron calls are authenticated via CRON_SECRET
          "x-cron-secret": process.env.CRON_SECRET ?? "",
        },
      });

      if (res.ok) {
        await (prisma.syncJob as any).update({
          where: { id: job.id },
          data: { status: "done", finishedAt: new Date() },
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
              finishedAt: null,
              errorMsg,
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
            data: { status: "failed", finishedAt: new Date(), errorMsg },
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
            finishedAt: null,
            errorMsg: msg,
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
          data: { status: "failed", finishedAt: new Date(), errorMsg: msg },
        });
        results.push({ jobId: job.id, pipelineId: job.pipelineId, status: "failed", error: msg.slice(0, 200) });
      }
    }
  }

  logger.info(`[SYNC_JOBS_CRON] Claimed ${claimedJobs.length} jobs, processed ${results.length}`, results);
  return NextResponse.json({ processed: results.length, results });
}
