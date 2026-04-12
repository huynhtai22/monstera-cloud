import prisma from "@/lib/prisma";

/**
 * Compact factual JSON for LLM summarization (last 7 days).
 */
export async function buildPerformanceContext(workspaceId: string) {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [
        syncAgg,
        pipelines,
        connections,
        clientCount,
        attributionRows,
        recentFailures,
    ] = await Promise.all([
        prisma.syncLog.groupBy({
            by: ["status"],
            where: {
                createdAt: { gte: sevenDaysAgo },
                pipeline: { workspaceId },
            },
            _count: { id: true },
            _sum: { rowsSynced: true },
        }),
        prisma.pipeline.findMany({
            where: { workspaceId },
            select: {
                name: true,
                healthStatus: true,
                status: true,
                lastSyncedAt: true,
            },
        }),
        prisma.connection.findMany({
            where: { workspaceId },
            select: { type: true, provider: true, status: true, name: true },
        }),
        prisma.client.count({ where: { workspaceId } }),
        prisma.attributionSnapshot.findMany({
            where: {
                workspaceId,
                date: { gte: sevenDaysAgo },
                model: "time_decay",
            },
            select: {
                date: true,
                netRoas: true,
                adSpend: true,
                attributedRevenue: true,
            },
            orderBy: { date: "asc" },
            take: 14,
        }),
        prisma.syncLog.findMany({
            where: {
                createdAt: { gte: sevenDaysAgo },
                status: { not: "success" },
                pipeline: { workspaceId },
            },
            select: { status: true, errorMsg: true, createdAt: true, pipeline: { select: { name: true } } },
            orderBy: { createdAt: "desc" },
            take: 8,
        }),
    ]);

    const syncByStatus = Object.fromEntries(
        syncAgg.map((r) => [
            r.status,
            { runs: r._count.id, rowsSynced: r._sum.rowsSynced ?? 0 },
        ])
    );

    const pipelineHealth = pipelines.reduce(
        (acc, p) => {
            acc[p.healthStatus] = (acc[p.healthStatus] || 0) + 1;
            return acc;
        },
        {} as Record<string, number>
    );

    const sources = connections.filter((c) => c.type === "source").length;
    const destinations = connections.filter((c) => c.type === "destination").length;
    const disconnected = connections.filter((c) => c.status !== "connected").length;

    let attribution7d: {
        daysWithData: number;
        avgNetRoas: number | null;
        totalAdSpend: number;
        totalAttributedRevenue: number;
    } | null = null;
    if (attributionRows.length > 0) {
        const totalSpend = attributionRows.reduce((s, r) => s + r.adSpend, 0);
        const totalRev = attributionRows.reduce((s, r) => s + r.attributedRevenue, 0);
        const avgRoas =
            attributionRows.length > 0
                ? attributionRows.reduce((s, r) => s + r.netRoas, 0) / attributionRows.length
                : null;
        attribution7d = {
            daysWithData: attributionRows.length,
            avgNetRoas: avgRoas !== null ? Number(avgRoas.toFixed(2)) : null,
            totalAdSpend: Number(totalSpend.toFixed(2)),
            totalAttributedRevenue: Number(totalRev.toFixed(2)),
        };
    }

    return {
        period: { from: sevenDaysAgo.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) },
        workspaceId,
        clients: clientCount,
        connections: { sources, destinations, disconnected },
        pipelines: {
            total: pipelines.length,
            byHealth: pipelineHealth,
        },
        syncLogsLast7Days: syncByStatus,
        attributionLast7Days: attribution7d,
        recentSyncIssues: recentFailures.map((f) => ({
            pipeline: f.pipeline?.name ?? "?",
            status: f.status,
            at: f.createdAt.toISOString(),
            errorPreview: f.errorMsg ? String(f.errorMsg).slice(0, 120) : null,
        })),
    };
}
