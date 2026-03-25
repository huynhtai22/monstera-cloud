import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plan-config";

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

export async function GET(req: Request) {
  // Verify this was called by Vercel Cron and not a public caller
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

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

  // Mark all as running atomically before executing
  const jobIds = jobs.map((j: any) => j.id);
  await (prisma.syncJob as any).updateMany({
    where: { id: { in: jobIds } },
    data: { status: "running", startedAt: now },
  });

  const results: { jobId: string; pipelineId: string; status: string; error?: string }[] = [];

  for (const job of jobs) {
    try {
      const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "";
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
        await (prisma.syncJob as any).update({
          where: { id: job.id },
          data: { status: "failed", finishedAt: new Date(), errorMsg: err.slice(0, 500) },
        });
        results.push({ jobId: job.id, pipelineId: job.pipelineId, status: "failed", error: err.slice(0, 200) });
      }
    } catch (err: any) {
      await (prisma.syncJob as any).update({
        where: { id: job.id },
        data: { status: "failed", finishedAt: new Date(), errorMsg: err.message?.slice(0, 500) },
      });
      results.push({ jobId: job.id, pipelineId: job.pipelineId, status: "failed", error: err.message });
    }
  }

  console.log(`[SYNC_JOBS_CRON] Processed ${results.length} jobs`, results);
  return NextResponse.json({ processed: results.length, results });
}

/**
 * Helper: enqueue a sync job for a pipeline.
 * Call this when a pipeline is created or when scheduling the next run.
 */
export async function enqueueSyncJob(
  pipelineId: string,
  userId: string,
  plan: string,
  scheduledAt: Date,
) {
  const limits = getPlanLimits(plan);
  return (prisma.syncJob as any).create({
    data: {
      pipelineId,
      userId,
      plan,
      status: "queued",
      priority: limits.priority,
      scheduledAt,
    },
  });
}
