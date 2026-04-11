import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * GET /api/workspaces/[id]/health-stats
 * 
 * Returns aggregated stats for the dashboard:
 * - Rows synced per day (last 7 days)
 * - Error breakdown
 * - Stale connection count
 */
export async function GET(req: Request, context: { params: any }) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const params = await context.params;
        const workspaceId = params.id;

        // Verify membership
        const membership = await prisma.workspaceMember.findUnique({
            where: {
                workspaceId_userId: {
                    workspaceId,
                    userId: session.user.id
                }
            }
        });

        if (!membership) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        // 1. Get Row Counts per day
        const logs = await prisma.syncLog.findMany({
            where: {
                pipeline: { workspaceId },
                createdAt: { gte: sevenDaysAgo },
                status: "success"
            },
            select: {
                rowsSynced: true,
                createdAt: true
            }
        });

        const dailyStats: Record<string, number> = {};
        for (let i = 0; i < 7; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            dailyStats[d.toISOString().split('T')[0]] = 0;
        }

        logs.forEach(log => {
            const dateStr = log.createdAt.toISOString().split('T')[0];
            if (dailyStats[dateStr] !== undefined) {
                dailyStats[dateStr] += log.rowsSynced;
            }
        });

        const chartData = Object.entries(dailyStats)
            .map(([date, count]) => ({ date, count }))
            .sort((a, b) => a.date.localeCompare(b.date));

        // 2. Get Recent Errors
        const errors = await prisma.syncLog.findMany({
            where: {
                pipeline: { workspaceId },
                status: "error"
            },
            take: 5,
            orderBy: { createdAt: "desc" },
            include: {
                pipeline: {
                    select: { name: true }
                }
            }
        });

        // 3. Connection Health Summary
        const connections = await prisma.connection.findMany({
            where: { workspaceId },
            select: { status: true, provider: true }
        });

        const health = {
            total: connections.length,
            online: connections.filter(c => c.status === "connected").length,
            offline: connections.filter(c => c.status !== "connected").length,
        };

        return NextResponse.json({
            chartData,
            recentErrors: errors.map(e => ({
                id: e.id,
                pipelineName: e.pipeline.name,
                message: e.errorMsg,
                at: e.createdAt
            })),
            health
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
