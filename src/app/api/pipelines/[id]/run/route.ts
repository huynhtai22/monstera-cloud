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

export async function POST(req: Request, context: { params: any }) {
    let syncLogId;
    let pipelineId: string | undefined;
    let notifyEmail: string | undefined;
    let pipelineNameForNotify: string | undefined;
    let pipeline: any = null;

    try {
        const syncStartTime = Date.now();
        
        // 0. Auth Check: Allow either Session OR Cron Secret
        const session = await getServerSession(authOptions);
        const authHeader = req.headers.get("x-cron-secret");
        const isCron = authHeader && authHeader === process.env.CRON_SECRET;

        if (!session?.user && !isCron) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        
        // Identify who is running this for logging/context
        const runnerUserId = session?.user?.id || (isCron ? "SYSTEM_CRON" : null);
        notifyEmail = (session?.user as any)?.email;

        // Properly extract params safely for Next.js 15+
        const params = await context.params;
        pipelineId = params?.id;

        if (!pipelineId) {
            return NextResponse.json({ error: "Missing pipeline ID" }, { status: 400 });
        }

        // 1. Fetch Pipeline with Relations
        pipeline = await prisma.pipeline.findUnique({
            where: { id: String(pipelineId) },
            include: {
                sourceConnection: true,
                destinationConnection: true,
                workspace: true
            }
        });

        if (!pipeline) {
            return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
        }
        pipelineNameForNotify = pipeline.name ?? "Pipeline";

        // Enforce sync cooldown — prevent re-runs faster than the plan allows
        const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { plan: true } });
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

        // 2. Locate User's Google OAuth Account
        const googleAccount = await prisma.account.findFirst({
            where: {
                userId: session.user.id,
                provider: "google"
            }
        });

        if (!googleAccount || !googleAccount.access_token) {
            return NextResponse.json({ error: "Google Account not linked or missing access token" }, { status: 403 });
        }

        const provider = pipeline.sourceConnection.provider as EtlProvider;
        const sourceCreds = JSON.parse(safeDecrypt(pipeline.sourceConnection.credentials));

        const requestOrigin = new URL(req.url).origin;
        const etl = await runEtlPipeline({
            userId: session.user.id,
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

        if (etl.rowsSynced === 0) {
            return NextResponse.json({ message: "No new data to sync." });
        }

        // 6. Log the Sync Job
        const syncLog = await prisma.syncLog.create({
            data: {
                pipelineId: pipeline.id,
                status: "success",
                rowsSynced: etl.rowsSynced,
                durationMs: Date.now() - syncStartTime,
            }
        });

        // Update pipeline last synced
        await prisma.pipeline.update({
            where: { id: pipeline.id },
            data: {
                lastSyncedAt: new Date(),
                ...(etl.nextCursor ? { syncCursor: JSON.stringify(etl.nextCursor) } : {}),
            }
        });

        return NextResponse.json({
            success: true,
            message: `Successfully synced ${etl.rowsSynced} rows to Google Sheets.`,
            spreadsheetId: etl.spreadsheetId,
            logId: syncLog.id
        });

    } catch (error: any) {
        console.error("Pipeline Sync Error:", error);

        // Send email alert (best-effort) for manual runs
        if (notifyEmail) {
            await sendSyncFailureEmail(
                notifyEmail,
                pipelineNameForNotify ?? "Pipeline",
                error?.message || "Unknown error occurred"
            ).catch(() => { });
        }

        // Agency Polish: Send Telegram Alert
        if (pipeline) {
            await sendAgencyAlert({
                workspaceId: pipeline.workspaceId,
                pipelineName: pipeline.name,
                errorMsg: error?.message || "Unknown error",
                clientId: pipeline.clientId
            }).catch(() => { });
        }

        // Optionally log the error to the database
        if (pipelineId) {
            await prisma.syncLog.create({
                data: {
                    pipelineId: String(pipelineId),
                    status: "error",
                    errorMsg: error.message || "Unknown error occurred"
                }
            }).catch(() => { });
        }

        return NextResponse.json({ error: error.message || "Pipeline execution failed" }, { status: 500 });
    }
}
