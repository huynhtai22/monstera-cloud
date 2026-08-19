import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isPlatformAdminEmail } from "@/lib/admin-auth";
import prisma from "@/lib/prisma";
import { withSystemScope } from "@/lib/tenant-guard";
import { listRecentVietQrOrders } from "@/lib/vietqr-gateway";
import { PLAN_PRICING, type PlanName } from "@/lib/plan-config";

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);

    const isEmailAdmin = isPlatformAdminEmail(session?.user?.email);

    // Check authorization: must be logged in and matching admin whitelist or OPERATOR platformRole
    const isOperator =
        session?.user?.id &&
        (await prisma.user.findFirst({
            where: { id: session.user.id, platformRole: "OPERATOR" },
            select: { id: true },
        }));

    // Allow in development or for authorized operators/admins
    if (!isOperator && !isEmailAdmin) {
        return NextResponse.json({ error: "Forbidden - Administrator access required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const timeframe = searchParams.get("timeframe") || "30d";

    const now = new Date();
    let timeframeDays = 30;
    if (timeframe === "7d") timeframeDays = 7;
    if (timeframe === "90d") timeframeDays = 90;
    if (timeframe === "all") timeframeDays = 3650;

    const startDate = new Date(now.getTime() - timeframeDays * 86_400_000);
    const prevStartDate = new Date(now.getTime() - timeframeDays * 2 * 86_400_000);
    const ago24h = new Date(now.getTime() - 24 * 3_600_000);
    const ago14d = new Date(now.getTime() - 14 * 86_400_000);

    // ── 1. Database Health & Ping ─────────────────────────────────────────────
    const dbPingStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - dbPingStart;

    const [
        totalUsers,
        totalWorkspaces,
        totalConnections,
        totalPipelines,
        totalMetrics,
        totalRetailOrders,
        totalSyncLogs,
        totalSyncJobs,
    ] = await withSystemScope(() =>
        Promise.all([
        prisma.user.count(),
        prisma.workspace.count(),
        prisma.connection.count(),
        prisma.pipeline.count(),
        prisma.campaignMetric.count(),
        prisma.retailOrder.count(),
        prisma.syncLog.count(),
        prisma.syncJob.count(),
        ]),
    );

    // ── 2. User Growth & Churn Metrics ─────────────────────────────────────────
    const newUsersInPeriod = await prisma.user.count({
        where: { emailVerified: { gte: startDate } }, // Or fallback to created proxy
    });

    const newWorkspacesInPeriod = await prisma.workspace.count({
        where: { createdAt: { gte: startDate } },
    });

    const newWorkspacesPrevPeriod = await prisma.workspace.count({
        where: { createdAt: { gte: prevStartDate, lt: startDate } },
    });

    const growthRatePercent =
        newWorkspacesPrevPeriod > 0
            ? Math.round(((newWorkspacesInPeriod - newWorkspacesPrevPeriod) / newWorkspacesPrevPeriod) * 100)
            : newWorkspacesInPeriod > 0
            ? 100
            : 0;

    // Active vs Churned Workspaces
    // Active = workspaces with at least 1 connection or sync in last 14 days
    const activeWorkspacesCount = await prisma.workspace.count({
        where: {
            status: "ACTIVE",
            connections: { some: { lastSyncAt: { gte: ago14d } } },
        },
    });

    const suspendedWorkspacesCount = await prisma.workspace.count({
        where: { status: "SUSPENDED" },
    });

    const inactiveWorkspacesCount = await prisma.workspace.count({
        where: {
            connections: { none: { lastSyncAt: { gte: ago14d } } },
        },
    });

    const churnRatePercent =
        totalWorkspaces > 0
            ? Math.round(((suspendedWorkspacesCount + inactiveWorkspacesCount) / totalWorkspaces) * 100)
            : 0;

    // Plan Distribution
    const planGroups = await prisma.workspace.groupBy({
        by: ["plan"],
        _count: { _all: true },
    });

    const planCounts: Record<string, number> = {
        free: 0,
        pilot: 0,
        starter: 0,
        professional: 0,
        enterprise: 0,
    };
    for (const g of planGroups) {
        planCounts[g.plan] = g._count._all;
    }

    // ── 3. Finance & Money-In Telemetry ────────────────────────────────────────
    // Calculate MRR from active paid workspaces
    let mrrVnd = 0;
    let mrrUsd = 0;

    const paidWorkspaces = await prisma.workspace.findMany({
        where: {
            plan: { in: ["starter", "professional", "enterprise"] },
            status: "ACTIVE",
        },
        select: { plan: true, subscriptionProvider: true },
    });

    for (const ws of paidWorkspaces) {
        const planKey = ws.plan as PlanName;
        const cfg = PLAN_PRICING[planKey] || PLAN_PRICING.free;
        if (ws.subscriptionProvider === "vietqr_domestic") {
            mrrVnd += cfg.vndMonthly;
        } else {
            mrrUsd += cfg.usdMonthly;
        }
    }

    // VietQR Realized Transactions
    const recentQrOrders = await listRecentVietQrOrders(50);
    const paidQrOrders = recentQrOrders.filter((o) => o.status === "PAID");
    const totalVndRealized = paidQrOrders.reduce((sum, o) => sum + (o.amount || 0), 0);

    const payingWorkspacesCount = paidWorkspaces.length;
    const paidConversionRate =
        totalWorkspaces > 0 ? Math.round((payingWorkspacesCount / totalWorkspaces) * 100) : 0;

    // ── 4. Sync & Connection Reliability Telemetry ─────────────────────────────
    const recentSyncLogs = await prisma.syncLog.findMany({
        where: { createdAt: { gte: ago24h } },
        select: { status: true, durationMs: true, rowsSynced: true },
    });

    const totalSyncs24h = recentSyncLogs.length;
    const successfulSyncs24h = recentSyncLogs.filter((l) => l.status === "success").length;
    const syncSuccessRate =
        totalSyncs24h > 0 ? Math.round((successfulSyncs24h / totalSyncs24h) * 100) : 100;

    // Connections by Provider
    const connectionsByProvider = await withSystemScope(() =>
        prisma.connection.groupBy({
            by: ["provider"],
            _count: { _all: true },
        }),
    );

    return NextResponse.json({
        timeframe,
        timestamp: now.toISOString(),
        dbHealth: {
            status: "healthy",
            latencyMs: dbLatencyMs,
            tables: {
                users: totalUsers,
                workspaces: totalWorkspaces,
                connections: totalConnections,
                pipelines: totalPipelines,
                campaignMetrics: totalMetrics,
                retailOrders: totalRetailOrders,
                syncLogs: totalSyncLogs,
                syncJobs: totalSyncJobs,
            },
        },
        finance: {
            mrrVnd,
            mrrUsd,
            arrVnd: mrrVnd * 12,
            arrUsd: mrrUsd * 12,
            totalVndRealized,
            payingWorkspacesCount,
            paidConversionRate,
            recentTransactions: recentQrOrders.slice(0, 15),
        },
        growth: {
            totalUsers,
            totalWorkspaces,
            newWorkspacesInPeriod,
            growthRatePercent,
            activeWorkspacesCount,
            suspendedWorkspacesCount,
            inactiveWorkspacesCount,
            churnRatePercent,
            planDistribution: planCounts,
        },
        syncTelemetry: {
            totalSyncs24h,
            syncSuccessRate,
            connectionsByProvider: connectionsByProvider.map((c) => ({
                provider: c.provider,
                count: c._count._all,
            })),
        },
    });
}
