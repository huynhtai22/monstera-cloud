import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { logger } from "@/lib/logger";

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

    // Verify workspace membership
    const membership = await (prisma.workspaceMember as any).findFirst({
        where: { workspaceId, userId: session.user.id },
        select: { id: true },
    });
    if (!membership) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

        const snapshots = await prisma.attributionSnapshot.findMany({
            where: {
                workspaceId,
                date: { gte: startDate, lte: endDate },
                model: "time_decay",
            },
            orderBy: { date: "asc" },
            take: 200,
        });

        return NextResponse.json({
            pipelines,
            syncLogs,
            snapshots: snapshots.map((s) => ({
                date: s.date,
                netRoas: s.netRoas,
                adSpend: s.adSpend,
                attributedRevenue: s.attributedRevenue,
                model: s.model,
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
