import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  mergeChartData,
  mergeClientHealth,
  mockConnectionDelta,
  mockUnassignedCount,
} from "@/lib/mock-console-data";

export async function GET(req: Request, context: { params: any }) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const params = await context.params;
        const workspaceId = params.id;

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

        const workspace = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: {
                demoMockMode: true,
                demoMockMeta: true,
                demoMockShopee: true,
                demoMockGoogleAds: true,
            },
        });
        const demoFlags = {
            demoMockMode: workspace?.demoMockMode ?? false,
            demoMockMeta: workspace?.demoMockMeta ?? false,
            demoMockShopee: workspace?.demoMockShopee ?? false,
            demoMockGoogleAds: workspace?.demoMockGoogleAds ?? false,
        };

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        // 1. Chart Data (Aggregate)
        const logs = await prisma.syncLog.findMany({
            where: {
                pipeline: { workspaceId },
                createdAt: { gte: sevenDaysAgo },
                status: "success"
            },
            select: { rowsSynced: true, createdAt: true }
        });

        const dailyStats: Record<string, number> = {};
        for (let i = 0; i < 7; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            dailyStats[d.toISOString().split('T')[0]] = 0;
        }
        logs.forEach(log => {
            const dateStr = log.createdAt.toISOString().split('T')[0];
            if (dailyStats[dateStr] !== undefined) dailyStats[dateStr] += log.rowsSynced;
        });

        let chartData = Object.entries(dailyStats)
            .map(([date, count]) => ({ date, count }))
            .sort((a, b) => a.date.localeCompare(b.date));
        chartData = mergeChartData(chartData, demoFlags);

        // 2. Per-Client Health Breakdown
        const clients = await prisma.client.findMany({
            where: { workspaceId },
            include: {
                connections: {
                    select: { status: true, lastSyncAt: true, provider: true }
                },
                pipelines: {
                    select: { healthStatus: true, lastSyncedAt: true }
                }
            }
        });

        let clientHealth: Array<{
            id: string;
            name: string;
            status: string;
            totalConnections: number;
            staleCount: number;
            lastActivity: Date | string | null;
            isDemo?: boolean;
        }> = clients.map((client) => {
            const totalConns = client.connections.length;
            const offlineConns = client.connections.filter(c => c.status !== 'connected').length;
            
            // Check for stale data (any pipeline not synced in > 26h)
            const now = Date.now();
            const stalePipelines = client.pipelines.filter(p => {
                if (!p.lastSyncedAt) return true;
                return (now - p.lastSyncedAt.getTime()) > 26 * 60 * 60 * 1000;
            }).length;

            let status = 'healthy';
            if (offlineConns > 0) status = 'error';
            else if (stalePipelines > 0) status = 'stale';

            return {
                id: client.id,
                name: client.name,
                status,
                totalConnections: totalConns,
                staleCount: stalePipelines,
                lastActivity: client.pipelines[0]?.lastSyncedAt || null
            };
        });
        clientHealth = mergeClientHealth(clientHealth, demoFlags);

        // 3. Unassigned Connections Health
        const unassignedConns = await prisma.connection.findMany({
            where: { workspaceId, clientId: null },
            select: { status: true, lastSyncAt: true }
        });

        const realConnCount = await prisma.connection.count({ where: { workspaceId } });
        const mergedHealthy = clientHealth.filter((c) => c.status === "healthy").length;

        return NextResponse.json({
            chartData,
            clientHealth,
            unassignedCount: mockUnassignedCount(unassignedConns.length, demoFlags),
            demoMockMode: demoFlags.demoMockMode,
            overall: {
                totalClients: clientHealth.length,
                healthyClients: mergedHealthy,
                totalConnections: realConnCount + mockConnectionDelta(demoFlags),
            },
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
