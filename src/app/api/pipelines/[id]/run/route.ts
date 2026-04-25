import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plan-config";
import { safeDecrypt } from "@/lib/encryption";
import { sendSyncFailureEmail } from "@/lib/mail";
import { runEtlPipeline } from "@/etl/runner";
import type { EtlProvider } from "@/etl/types";
import { sendAgencyAlert } from "@/lib/alerts";
import { classifyIngestionError, formatLogError } from "@/lib/ingestion/error-taxonomy";
import { markConnectionsSyncedOk, markConnectionsSyncError } from "@/lib/ingestion/connection-sync-state";
import { logger } from "@/lib/logger";

export async function POST(req: Request, context: { params: any }) {
    const syncStartTime = Date.now();
    let pipelineId: string | undefined;
    let notifyEmail: string | undefined;
    let pipelineNameForNotify: string | undefined;
    let activePipeline: any = null;

    try {
        // 0. Auth Check: Allow either Session OR Cron Secret
        const session = await getServerSession(authOptions);
        const authHeader = req.headers.get("x-cron-secret") || req.headers.get("Authorization")?.replace("Bearer ", "");
        const isCron = authHeader && authHeader === process.env.CRON_SECRET;

        if (!session?.user && !isCron) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        notifyEmail = (session?.user as any)?.email;

        const params = await context.params;
        pipelineId = params?.id;

        if (!pipelineId) {
            return NextResponse.json({ error: "Missing pipeline ID" }, { status: 400 });
        }

        const pipeline = await prisma.pipeline.findUnique({
            where: { id: String(pipelineId) },
            include: {
                sourceConnection: true,
                destinationConnection: true,
                workspace: true,
            },
        });

        if (!pipeline) {
            return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
        }

        activePipeline = pipeline;
        pipelineNameForNotify = pipeline.name ?? "Pipeline";

        const userIdForLimits = session?.user?.id || pipeline.workspace.ownerId;
        const user = await prisma.user.findUnique({ where: { id: userIdForLimits }, select: { plan: true } });
        const limits = getPlanLimits(user?.plan ?? "free");

        if (pipeline.lastSyncedAt) {
            const msSinceLast = Date.now() - pipeline.lastSyncedAt.getTime();
            if (msSinceLast < limits.syncIntervalMs) {
                const waitSec = Math.ceil((limits.syncIntervalMs - msSinceLast) / 1000);
                const waitMin = Math.ceil(waitSec / 60);
                return NextResponse.json(
                    {
                        error: `Your ${user?.plan ?? "free"} plan syncs ${limits.syncLabel.toLowerCase()}. Please wait ${waitMin} more minute${waitMin === 1 ? "" : "s"} before re-running.`,
                        code: "SYNC_COOLDOWN",
                        retry_after_seconds: waitSec,
                    },
                    { status: 429 }
                );
            }
        }

        const provider = pipeline.sourceConnection.provider as EtlProvider;
        const sourceCreds = JSON.parse(safeDecrypt(pipeline.sourceConnection.credentials));

        const requestOrigin = new URL(req.url).origin;
        const etl = await runEtlPipeline({
            userId: userIdForLimits,
            provider,
            pipeline,
            ctx: {
                requestOrigin,
                pipelineId: pipeline.id,
                pipelineName: pipeline.name,
                sourceConnectionId: pipeline.sourceConnectionId,
            },
            sourceCreds,
        });

        const durationMs = Date.now() - syncStartTime;
        const now = new Date();
        const connIds = {
            sourceId: pipeline.sourceConnectionId,
            destinationId: pipeline.destinationConnectionId,
        };

        const syncLog = await prisma.syncLog.create({
            data: {
                pipelineId: pipeline.id,
                status: "success",
                rowsSynced: etl.rowsSynced,
                durationMs,
            },
        });

        await prisma.pipeline.update({
            where: { id: pipeline.id },
            data: {
                lastSyncedAt: now,
                healthStatus: "healthy",
                ...(etl.nextCursor ? { syncCursor: JSON.stringify(etl.nextCursor) } : {}),
            },
        });

        await markConnectionsSyncedOk(connIds, now);

        if (etl.rowsSynced === 0) {
            return NextResponse.json({
                success: true,
                message: "No new data to sync.",
                rowsSynced: 0,
                logId: syncLog.id,
            });
        }

        return NextResponse.json({
            success: true,
            message: `Successfully synced ${etl.rowsSynced} rows to Google Sheets.`,
            spreadsheetId: etl.spreadsheetId,
            logId: syncLog.id,
            rowsSynced: etl.rowsSynced,
        });
    } catch (error: any) {
        logger.error("Pipeline Sync Error:", error);

        const classified = classifyIngestionError(error);
        const logLine = formatLogError(classified);
        const durationMs = Date.now() - syncStartTime;

        if (notifyEmail) {
            await sendSyncFailureEmail(
                notifyEmail,
                pipelineNameForNotify ?? "Pipeline",
                logLine
            ).catch(() => {});
        }

        if (activePipeline) {
            await sendAgencyAlert({
                workspaceId: activePipeline.workspaceId,
                pipelineName: activePipeline.name,
                errorMsg: logLine,
                clientId: activePipeline.clientId,
            }).catch(() => {});
        }

        if (pipelineId) {
            try {
                await prisma.pipeline.update({
                    where: { id: String(pipelineId) },
                    data: { healthStatus: "error" },
                });

                await prisma.syncLog.create({
                    data: {
                        pipelineId: String(pipelineId),
                        status: "error",
                        rowsSynced: 0,
                        durationMs,
                        errorMsg: logLine,
                    },
                });

                if (activePipeline?.sourceConnectionId && activePipeline?.destinationConnectionId) {
                    await markConnectionsSyncError(
                        {
                            sourceId: activePipeline.sourceConnectionId,
                            destinationId: activePipeline.destinationConnectionId,
                        },
                        logLine
                    );
                }
            } catch (e) {
                logger.error("[pipeline/run] failed to persist error state", e);
            }
        }

        return NextResponse.json(
            {
                error: classified.message,
                code: classified.kind,
                tag: classified.tag.replace(/[\[\]]/g, ""),
            },
            { status: 500 }
        );
    }
}
