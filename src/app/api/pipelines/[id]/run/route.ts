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
import { requireWorkspaceAccess, RbacError } from "@/lib/rbac";
import { hasBearerSecret } from "@/lib/request-auth";
import { isPilotMode } from "@/lib/pilot-mode";

import { runPostSyncQualityChecks } from "@/lib/observability/data-quality";

export async function POST(req: Request, context: { params: any }) {
    const syncStartTime = Date.now();
    let pipelineId: string | undefined;
    let notifyEmail: string | undefined;
    let pipelineNameForNotify: string | undefined;
    let activePipeline: any = null;

    try {
        // 0. Auth Check: Allow either Session OR Cron Secret
        const session = await getServerSession(authOptions);
        const isCron = hasBearerSecret(req, process.env.CRON_SECRET);

        if (!session?.user && !isCron) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (isPilotMode() && !isCron) {
            return NextResponse.json({ error: "Destination pipelines are deferred during the agency pilot." }, { status: 410 });
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

        // RBAC: Interactive users must be workspace members.
        // Cron/system calls bypass membership check (trusted infra).
        if (!isCron && session?.user?.id) {
            try {
                await requireWorkspaceAccess(
                    session.user.id,
                    pipeline.workspaceId,
                    "member"
                );
            } catch (err) {
                if (err instanceof RbacError) {
                    logger.warn(`[RBAC] Pipeline run denied for user ${session.user.id} on workspace ${pipeline.workspaceId}: ${err.message}`);
                    return NextResponse.json(
                        { error: err.message, code: err.code },
                        { status: err.statusCode }
                    );
                }
                throw err;
            }
        }

        const userIdForLimits = session?.user?.id || pipeline.workspace.ownerId;
        const workspacePlan = pipeline.workspace.plan ?? "pilot";
        const limits = getPlanLimits(workspacePlan);

        // Interactive runs are queued and executed by the cron worker.
        // This keeps heavy ETL work outside the end-user request lifecycle.
        if (!isCron) {
            let queuedJob: { id: string; status: string; scheduledAt: Date } | null = null;

            try {
                queuedJob = await (prisma.syncJob as any).create({
                    data: {
                        pipelineId: pipeline.id,
                        activeKey: pipeline.id,
                        userId: userIdForLimits,
                        plan: workspacePlan,
                        status: "queued",
                        priority: limits.priority,
                        scheduledAt: new Date(),
                    },
                    select: { id: true, status: true, scheduledAt: true },
                });
            } catch (err: any) {
                // Unique activeKey collision means another request already queued/running this pipeline.
                if (err?.code === "P2002") {
                    const existingJob = await (prisma.syncJob as any).findFirst({
                        where: {
                            pipelineId: pipeline.id,
                            status: { in: ["queued", "running"] },
                        },
                        select: { id: true, status: true, scheduledAt: true },
                    });

                    if (existingJob) {
                        logger.info(`[pipeline/run] enqueue skipped due to active job for pipeline ${pipeline.id}`, {
                            pipelineId: pipeline.id,
                            jobId: existingJob.id,
                            status: existingJob.status,
                        });
                        return NextResponse.json({
                            success: true,
                            queued: true,
                            message: "A sync is already queued or running for this pipeline.",
                            job: existingJob,
                        }, { status: 202 });
                    }
                }

                throw err;
            }

            logger.info(`[pipeline/run] queued sync job for pipeline ${pipeline.id}`, {
                pipelineId: pipeline.id,
                jobId: queuedJob?.id,
                priority: limits.priority,
            });

            return NextResponse.json({
                success: true,
                queued: true,
                message: "Pipeline sync queued successfully.",
                job: queuedJob,
            }, { status: 202 });
        }

        if (pipeline.lastSyncedAt) {
            const msSinceLast = Date.now() - pipeline.lastSyncedAt.getTime();
            if (msSinceLast < limits.syncIntervalMs) {
                const waitSec = Math.ceil((limits.syncIntervalMs - msSinceLast) / 1000);
                const waitMin = Math.ceil(waitSec / 60);
                return NextResponse.json(
                    {
                        error: `This workspace refreshes ${limits.syncLabel.toLowerCase()}. Please wait ${waitMin} more minute${waitMin === 1 ? "" : "s"} before re-running.`,
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

        // For ad platforms, first sync from API to CampaignMetric
        // This ensures Data Explorer has data and pipeline can read from DB
        const adPlatforms = ["meta_ads", "google_ads", "tiktok_business", "shopee", "lazada"];
        if (adPlatforms.includes(provider)) {
            logger.info(`[Pipeline Run] Pre-syncing ad platform data for ${provider} before ETL. SourceConnectionId: ${pipeline.sourceConnectionId}, WorkspaceId: ${pipeline.workspaceId}`);
            try {
                // Call sync endpoint internally with service role
                const { syncConnectionData } = await import('@/lib/sync-connection');
                logger.info(`[Pipeline Run] Calling syncConnectionData for ${provider}`);
                const syncResult = await syncConnectionData({
                    connectionId: pipeline.sourceConnectionId,
                    provider,
                    credentials: sourceCreds,
                    workspaceId: pipeline.workspaceId,
                    userPlan: workspacePlan,
                });
                logger.info(`[Pipeline Run] Pre-sync complete for ${provider}:`, JSON.stringify(syncResult));
            } catch (syncErr: unknown) {
                logger.error(`[Pipeline Run] Pre-sync failed for ${provider}:`, syncErr);
                throw syncErr;
            }
        } else {
            logger.info(`[Pipeline Run] Provider ${provider} is not an ad platform, skipping pre-sync`);
        }

        const etl = await runEtlPipeline({
            userId: userIdForLimits,
            userPlan: workspacePlan,
            provider,
            pipeline,
            ctx: {
                requestOrigin,
                pipelineId: pipeline.id,
                pipelineName: pipeline.name,
                sourceConnectionId: pipeline.sourceConnectionId,
                workspaceId: pipeline.workspaceId,
            },
            sourceCreds,
            jobId: req.headers.get("x-sync-job-id") || undefined,
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

        // Await data quality checks
        try {
            await runPostSyncQualityChecks(pipeline.workspaceId, {
                id: syncLog.id,
                pipelineId: pipeline.id,
                rowsSynced: etl.rowsSynced,
                status: "success",
            });
        } catch (err) {
            logger.error("[Data Quality] Post-sync check error", err);
        }

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
