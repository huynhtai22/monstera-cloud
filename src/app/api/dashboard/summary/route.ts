import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { computeAttributionSnapshots } from "@/etl/attribution/engine";
import {
    buildMockAttributionSnapshots,
    type WorkspaceDemoFlags,
} from "@/lib/mock-console-data";

function dateKey(d: Date | string): string {
    const x = d instanceof Date ? d : new Date(d);
    return x.toISOString().slice(0, 10);
}

function mergeAttributionRows(
    real: Array<{
        date: Date;
        netRoas: number;
        adSpend: number;
        attributedRevenue: number;
        model: string;
    }>,
    mock: Array<{
        date: Date;
        netRoas: number;
        adSpend: number;
        attributedRevenue: number;
        model: string;
    }>
) {
    const map = new Map<string, (typeof real)[0]>();
    for (const m of mock) {
        map.set(dateKey(m.date), m);
    }
    for (const r of real) {
        map.set(dateKey(r.date), r);
    }
    return Array.from(map.values()).sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
}

/**
 * GET /api/dashboard/summary?workspaceId=...&days=14
 *
 * Returns a unified payload for the dashboard:
 * - pipelines (with latest log and connections)
 * - syncLogs (last 50)
 * - attribution snapshots (last N days)
 *
 * This reduces the dashboard from 3 parallel requests to 1,
 * eliminating layout shift and cutting connection overhead by ~66%.
 */
export async function GET(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get("workspaceId");
    const rawDays = Number(searchParams.get("days") ?? "14");
    const days = Math.max(1, Math.min(90, rawDays));

    if (!workspaceId) {
        return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    try {
        await requireWorkspaceAccess({
            userId: session.user.id,
            workspaceId,
            minimumRole: "viewer",
            operation: "view_dashboard_summary",
        });
    } catch (error) {
        return toRbacResponse(error) ?? NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
        // 1. Pipelines with latest log and connections
        const pipelines = await prisma.pipeline.findMany({
            where: { workspaceId },
            include: {
                sourceConnection: true,
                destinationConnection: true,
                logs: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                },
            },
            orderBy: { createdAt: "desc" },
        });

        // 2. Latest sync logs (capped at 50)
        const syncLogs = await prisma.syncLog.findMany({
            where: {
                pipeline: {
                    workspaceId,
                    workspace: {
                        members: { some: { userId: session.user.id } },
                    },
                },
            },
            include: {
                pipeline: { select: { id: true, name: true, sourceConnectionId: true, clientId: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 50,
        });

        // 3. Attribution snapshots for the requested window
        const endDate = new Date();
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        // Compute best-effort attribution so the dashboard never shows an empty
        // Performance section just because the cron hasn't run yet.
        await computeAttributionSnapshots({
            workspaceId,
            startDate,
            endDate,
            model: "time_decay",
        });

        const snapshots = await prisma.attributionSnapshot.findMany({
            where: {
                workspaceId,
                date: { gte: startDate, lte: endDate },
                model: "time_decay",
            },
            orderBy: { date: "asc" },
            take: 200,
        });

        // Merge with mock data when demo mode is active (restores parity with
        // the old /api/attribution/snapshots behaviour).
        const ws = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: {
                demoMockMode: true,
                demoMockMeta: true,
                demoMockShopee: true,
                demoMockGoogleAds: true,
            },
        });
        const demoFlags: WorkspaceDemoFlags = {
            demoMockMode: ws?.demoMockMode ?? false,
            demoMockMeta: ws?.demoMockMeta ?? false,
            demoMockShopee: ws?.demoMockShopee ?? false,
            demoMockGoogleAds: ws?.demoMockGoogleAds ?? false,
        };

        const dayCount = Math.max(1, Math.min(90, days));
        const mockRows = buildMockAttributionSnapshots(dayCount, demoFlags);
        const realRows = snapshots.map((s) => ({
            date: s.date,
            netRoas: s.netRoas,
            adSpend: s.adSpend,
            attributedRevenue: s.attributedRevenue,
            model: s.model,
        }));

        const merged =
            demoFlags.demoMockMode && mockRows.length > 0
                ? mergeAttributionRows(realRows, mockRows)
                : realRows;

        return NextResponse.json({
            pipelines,
            syncLogs,
            snapshots: merged.map((row) => ({
                date: row.date,
                netRoas: row.netRoas,
                adSpend: row.adSpend,
                attributedRevenue: row.attributedRevenue,
                model: row.model,
            })),
        });
    } catch (error) {
        logger.error("[dashboard/summary] error:", error);
        return NextResponse.json(
            { error: "Failed to fetch dashboard summary" },
            { status: 500 }
        );
    }
}
