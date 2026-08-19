import prisma from "@/lib/prisma";
import { sendAgencyAlert } from "@/lib/alerts";
import { emitMonitor } from "@/lib/observability/monitors";
import { shouldNotifyStale } from "./alert-policy";
import { STALE_AFTER_MS } from "./stale-health";
import { withSystemScope } from "@/lib/tenant-guard";
import { getRedis } from "@/lib/redis";
import { upsertOpenTicket } from "@/lib/support-ticket";

const QUEUED_WARN_MS = 15 * 60 * 1000;

export async function emitHealthMonitorsAndStaleAlerts(now = new Date()) {
  return withSystemScope(() => emitUnsafe(now));
}

async function emitUnsafe(now: Date) {
  const staleThreshold = new Date(now.getTime() - STALE_AFTER_MS);
  const queuedCutoff = new Date(now.getTime() - QUEUED_WARN_MS);

  const [oldQueued, staleSources] = await Promise.all([
    prisma.warehouseImportJob.findMany({
      where: {
        status: "queued",
        scheduledAt: { lt: queuedCutoff },
      },
      select: { id: true, workspaceId: true, scheduledAt: true, retryCount: true },
      take: 25,
    }),
    prisma.connection.findMany({
      where: {
        type: "source",
        status: "connected",
        OR: [
          { lastSyncAt: { lt: staleThreshold } },
          { lastSyncAt: null, createdAt: { lt: staleThreshold } },
        ],
      },
      select: { workspaceId: true, lastSyncAt: true, provider: true, id: true },
      take: 100,
    }),
  ]);

  for (const job of oldQueued) {
    emitMonitor("queued_job_age", {
      jobId: job.id,
      workspaceId: job.workspaceId,
      ageMs: now.getTime() - new Date(job.scheduledAt).getTime(),
      retryCount: job.retryCount,
    });
  }

  const staleByWorkspace = new Map<string, { hours: number; count: number }>();
  for (const source of staleSources) {
    const ref = source.lastSyncAt ?? staleThreshold;
    const hours = Math.floor((now.getTime() - ref.getTime()) / (60 * 60 * 1000));
    const current = staleByWorkspace.get(source.workspaceId) ?? { hours: 0, count: 0 };
    current.count += 1;
    current.hours = Math.max(current.hours, hours);
    staleByWorkspace.set(source.workspaceId, current);
    emitMonitor("warehouse_freshness", {
      workspaceId: source.workspaceId,
      connectionId: source.id,
      provider: source.provider,
      lastSyncAt: source.lastSyncAt?.toISOString() ?? null,
      hoursStale: hours,
    });
  }

  for (const [workspaceId, info] of staleByWorkspace) {
    if (!shouldNotifyStale(info.hours)) continue;
    if (!(await claimAlertSlot(`stale:${workspaceId}`, 24 * 60 * 60))) continue;
    await upsertOpenTicket({
      workspaceId,
      reason: "stale",
      title: `${info.count} source(s) stale for ${info.hours}h`,
      tag: "[stale]",
      errorMsg: `No successful warehouse sync in ${info.hours} hours`,
    }).catch(() => {});
    await sendAgencyAlert({
      workspaceId,
      pipelineName: `${info.count} source(s) stale`,
      errorMsg: `[stale] No successful warehouse sync in ${info.hours} hours`,
      actionHint: "Open Data Explorer and run a manual refresh, or wait for the next nightly sweep.",
    }).catch(() => {});
  }

  return {
    oldQueuedJobs: oldQueued.length,
    staleSources: staleSources.length,
    staleWorkspaces: staleByWorkspace.size,
  };
}

async function claimAlertSlot(key: string, ttlSeconds: number): Promise<boolean> {
  if (!process.env.KV_URL && !process.env.KV_REST_API_URL) {
    return false;
  }
  try {
    const redis = getRedis();
    const result = await redis.set(`alert:${key}`, "1", { nx: true, ex: ttlSeconds });
    return result === "OK" || result === true || result === "1";
  } catch {
    return false;
  }
}
