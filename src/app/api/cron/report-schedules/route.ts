import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendClientWeeklyReport, type ClientWeeklyReportSummary } from "@/lib/mail";
import { logger } from "@/lib/logger";

/**
 * GET /api/cron/report-schedules
 *
 * Invoked by Vercel Cron every Monday 09:00 UTC (see vercel.json).
 * Walks enabled `ReportSchedule` rows, aggregates last-7-day sync-log stats
 * per (workspace, client), and emails the recipients a weekly recap.
 */
export async function GET(req: Request) {
    // Cron auth — matches master cron convention.
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const results: Array<{
        scheduleId: string;
        workspaceId: string;
        clientId: string | null;
        recipients: number;
        sent: number;
        errors: number;
    }> = [];

    try {
        const schedules = await (prisma as any).reportSchedule.findMany({
            where: { enabled: true },
        });

        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const weekLabel = `${weekAgo.toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)}`;

        for (const sched of schedules) {
            const recipientList = (sched.recipients || "")
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean);

            if (recipientList.length === 0) {
                results.push({
                    scheduleId: sched.id,
                    workspaceId: sched.workspaceId,
                    clientId: sched.clientId,
                    recipients: 0,
                    sent: 0,
                    errors: 0,
                });
                continue;
            }

            const workspace = await prisma.workspace.findUnique({
                where: { id: sched.workspaceId },
                select: { id: true, name: true },
            });
            if (!workspace) continue;

            const client = sched.clientId
                ? await prisma.client.findUnique({
                      where: { id: sched.clientId },
                      select: { id: true, name: true, logoUrl: true },
                  })
                : null;

            // Aggregate last-7-day sync stats via SyncLog → Pipeline filter.
            const logs = await prisma.syncLog.findMany({
                where: {
                    createdAt: { gte: weekAgo },
                    pipeline: {
                        workspaceId: sched.workspaceId,
                        ...(sched.clientId ? { clientId: sched.clientId } : {}),
                    },
                },
                select: {
                    status: true,
                    rowsSynced: true,
                    createdAt: true,
                    pipelineId: true,
                },
            });

            const syncs = logs.length;
            const errors = logs.filter((l) => l.status === "error").length;
            const rowsSynced = logs.reduce((sum, l) => sum + (l.rowsSynced || 0), 0);
            const uniquePipelines = new Set(logs.map((l) => l.pipelineId));
            const pipelines = uniquePipelines.size;

            const lastSuccess = logs
                .filter((l) => l.status === "success")
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
            const freshnessHours = lastSuccess
                ? Math.round((now.getTime() - lastSuccess.createdAt.getTime()) / 3_600_000)
                : null;

            const summary: ClientWeeklyReportSummary = {
                weekLabel,
                syncs,
                errors,
                rowsSynced,
                pipelines,
                freshnessHours,
            };

            let sent = 0;
            let failed = 0;
            for (const to of recipientList) {
                const res = await sendClientWeeklyReport(
                    to,
                    client?.name || workspace.name,
                    workspace.name,
                    summary,
                    client?.logoUrl || null,
                );
                if (res.success) sent += 1;
                else failed += 1;
            }

            if (sent > 0) {
                await (prisma as any).reportSchedule.update({
                    where: { id: sched.id },
                    data: { lastSentAt: new Date() },
                });
            }

            results.push({
                scheduleId: sched.id,
                workspaceId: sched.workspaceId,
                clientId: sched.clientId,
                recipients: recipientList.length,
                sent,
                errors: failed,
            });
        }

        return NextResponse.json({ ok: true, count: results.length, results });
    } catch (err: any) {
        logger.error("[CRON:report-schedules] error:", err);
        return NextResponse.json(
            { ok: false, error: err?.message || "Failed", results },
            { status: 500 },
        );
    }
}
