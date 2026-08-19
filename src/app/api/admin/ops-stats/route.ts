import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { withSystemScope } from "@/lib/tenant-guard";

/** Classify a sync error message into a broad bucket. */
function classifyError(msg: string | null): "timeout" | "oauth" | "rateLimit" | "schema" | "other" {
    if (!msg) return "other";
    const m = msg.toLowerCase();
    if (/timeout|etimedout|econnreset|socket hang up/.test(m)) return "timeout";
    if (/oauth|token|unauthorized|401|expired|invalid_grant/.test(m)) return "oauth";
    if (/rate.?limit|429|too many|quota/.test(m)) return "rateLimit";
    if (/schema|column|field|datatype|type mismatch/.test(m)) return "schema";
    return "other";
}

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !(await prisma.user.findFirst({ where: { id: session.user.id, platformRole: "OPERATOR" }, select: { id: true } }))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return withSystemScope(() => collectOpsStats());
}

async function collectOpsStats() {
    const now = new Date();
    const ago24h = new Date(now.getTime() - 24 * 3_600_000);
    const ago1h = new Date(now.getTime() - 3_600_000);
    const ago7d = new Date(now.getTime() - 7 * 24 * 3_600_000);
    const ago30min = new Date(now.getTime() - 30 * 60_000);

    // ─── ETL / SyncLog ───────────────────────────────────────────────
    const logs24h = await prisma.syncLog.findMany({
        where: { createdAt: { gte: ago24h } },
        select: {
            status: true,
            rowsSynced: true,
            durationMs: true,
            errorMsg: true,
            createdAt: true,
            pipeline: { select: { sourceConnection: { select: { provider: true } } } },
        },
    });

    const logs1h = logs24h.filter((l) => l.createdAt >= ago1h);

    const etlLast24h = {
        total: logs24h.length,
        success: logs24h.filter((l) => l.status === "success").length,
        error: logs24h.filter((l) => l.status === "error").length,
        rowsSynced: logs24h.reduce((s, l) => s + (l.rowsSynced || 0), 0),
        avgMs:
            logs24h.length > 0
                ? Math.round(logs24h.reduce((s, l) => s + (l.durationMs || 0), 0) / logs24h.length)
                : 0,
    };
    const etlLast1h = {
        total: logs1h.length,
        success: logs1h.filter((l) => l.status === "success").length,
        error: logs1h.filter((l) => l.status === "error").length,
    };

    // by platform
    const platformMap: Record<string, { total: number; success: number; error: number; ms: number }> = {};
    for (const l of logs24h) {
        const p = l.pipeline?.sourceConnection?.provider?.toLowerCase() ?? "unknown";
        if (!platformMap[p]) platformMap[p] = { total: 0, success: 0, error: 0, ms: 0 };
        platformMap[p].total++;
        if (l.status === "success") platformMap[p].success++;
        if (l.status === "error") platformMap[p].error++;
        platformMap[p].ms += l.durationMs || 0;
    }
    const byPlatform = Object.entries(platformMap)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([platform, v]) => ({
            platform,
            total: v.total,
            success: v.success,
            error: v.error,
            avgMs: v.total > 0 ? Math.round(v.ms / v.total) : 0,
        }));

    // error classification
    const errorLogs = logs24h.filter((l) => l.status === "error");
    const errorClasses = { timeout: 0, oauth: 0, rateLimit: 0, schema: 0, other: 0 };
    for (const l of errorLogs) {
        errorClasses[classifyError(l.errorMsg)]++;
    }

    // connection health
    const connections = await prisma.connection.findMany({
        select: { status: true, lastSyncAt: true },
    });
    let connHealthy = 0, connError = 0, connStale = 0;
    for (const c of connections) {
        if (c.status === "error" || c.status === "failed") { connError++; continue; }
        if (c.lastSyncAt && c.lastSyncAt < ago24h) { connStale++; continue; }
        connHealthy++;
    }

    // ─── SyncJob queue ────────────────────────────────────────────────
    const jobsByStatus = await prisma.syncJob.groupBy({
        by: ["status"],
        _count: { _all: true },
    });
    const queueByStatus: Record<string, number> = {};
    for (const row of jobsByStatus) queueByStatus[row.status] = row._count._all;

    const doneJobs24h = await prisma.syncJob.findMany({
        where: { status: "done", finishedAt: { gte: ago24h }, startedAt: { not: null } },
        select: { startedAt: true, finishedAt: true },
    });
    const avgLatencyMs =
        doneJobs24h.length > 0
            ? Math.round(
                  doneJobs24h.reduce((s, j) => s + (j.finishedAt!.getTime() - j.startedAt!.getTime()), 0) /
                      doneJobs24h.length,
              )
            : 0;

    const failedLast1h = await prisma.syncJob.count({
        where: { status: "failed", finishedAt: { gte: ago1h } },
    });

    // long-running jobs (running and startedAt > 30min ago)
    const stuckJobs = await prisma.syncJob.count({
        where: { status: "running", startedAt: { lte: ago30min } },
    });

    // ─── Platform usage ───────────────────────────────────────────────
    const totalWorkspaces = await prisma.workspace.count();
    const newWorkspaces7d = await prisma.workspace.count({ where: { createdAt: { gte: ago7d } } });
    const newWorkspaces24h = await prisma.workspace.count({ where: { createdAt: { gte: ago24h } } });

    const totalPipelines = await prisma.pipeline.count();
    const activePipelines = await prisma.pipeline.count({ where: { status: "active" } });

    const allConnections = await prisma.connection.groupBy({
        by: ["provider"],
        _count: { _all: true },
    });
    const byProvider = allConnections
        .sort((a, b) => b._count._all - a._count._all)
        .map((r) => ({ provider: r.provider, count: r._count._all }));

    const pipelineHealthRows = await prisma.pipeline.groupBy({
        by: ["healthStatus"],
        _count: { _all: true },
    });
    const pipelineHealth: Record<string, number> = {};
    for (const r of pipelineHealthRows) pipelineHealth[r.healthStatus] = r._count._all;

    // ─── Live Alerts ──────────────────────────────────────────────────
    const alerts: Array<{ level: "critical" | "warning" | "info"; message: string }> = [];

    const failRate1h = etlLast1h.total > 0 ? etlLast1h.error / etlLast1h.total : 0;
    if (failRate1h >= 0.5 && etlLast1h.total >= 5) {
        alerts.push({ level: "critical", message: `Sync failure rate ${Math.round(failRate1h * 100)}% in the last hour (${etlLast1h.error}/${etlLast1h.total} syncs)` });
    } else if (failRate1h >= 0.2 && etlLast1h.total >= 5) {
        alerts.push({ level: "warning", message: `Elevated sync failures: ${Math.round(failRate1h * 100)}% in the last hour` });
    }
    if (stuckJobs > 0) {
        alerts.push({ level: "critical", message: `${stuckJobs} job${stuckJobs > 1 ? "s" : ""} stuck in "running" for >30 min` });
    }
    if (connStale > 3) {
        alerts.push({ level: "warning", message: `${connStale} connections haven't synced in >24 h` });
    }
    const queueBacklog = queueByStatus["queued"] || 0;
    if (queueBacklog > 50) {
        alerts.push({ level: "warning", message: `Queue backlog: ${queueBacklog} jobs waiting` });
    }
    if (errorClasses.oauth > 3) {
        alerts.push({ level: "warning", message: `${errorClasses.oauth} OAuth / token errors in last 24 h — tokens may need re-auth` });
    }
    if (alerts.length === 0) {
        alerts.push({ level: "info", message: "All systems nominal." });
    }

    return NextResponse.json({
        ts: now.getTime(),
        etl: {
            last24h: etlLast24h,
            last1h: etlLast1h,
            byPlatform,
            errorClasses,
            connectionHealth: {
                total: connections.length,
                healthy: connHealthy,
                error: connError,
                stale: connStale,
            },
        },
        queue: {
            byStatus: queueByStatus,
            avgLatencyMs,
            backlog: queueBacklog,
            failedLast1h,
            stuckJobs,
        },
        usage: {
            totalWorkspaces,
            newWorkspaces7d,
            newWorkspaces24h,
            totalPipelines,
            activePipelines,
            totalConnections: connections.length,
            byProvider,
            pipelineHealth,
        },
        alerts,
    });
}
