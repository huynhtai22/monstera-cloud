import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getCanonicalDateRange } from "@/lib/warehouse-date-range";
import {
  auditPilotEvent,
  decideExtendedBackfill,
  estimatePilotCapacity,
  loadExtendedBackfillPilotConfig,
  normalizePilotProvider,
  pilotJobStageFromKey,
  requirePilotOperator,
  PILOT_ROWS_PER_CALL_PLANNING_ASSUMPTION,
  PilotAdmissionError,
} from "@/lib/extended-backfill-pilot";
import {
  loadPilotJob,
  runPilotBackfillJob,
  countProviderCallsToday,
  PILOT_ACTIVE_JOB_STATUSES,
  PilotStateError,
} from "@/lib/extended-backfill-pilot-lifecycle";
import { createWarehouseChunkExecutor } from "@/lib/warehouse-import-worker";
import { LeaseLostError } from "@/lib/warehouse-import-job";
import { PilotExecuteSchema, invalidBody, pilotRejectionResponse } from "../../../_shared";

/**
 * POST /api/operator/warehouse/extended-backfill/jobs/:id/execute
 * Operator-driven bounded execution of an admitted pilot job. Live warehouse
 * execution only: synthetic-created jobs are refused (409), Meta live
 * execution is refused by policy, and unknown capacity fails closed.
 * Resumable: each invocation executes a bounded slice of the remaining work.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePilotOperator();
  if (auth.error) return auth.error;

  const { id } = await context.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = PilotExecuteSchema.safeParse(body);
  if (!parsed.success) return invalidBody();
  const { workspaceId } = parsed.data;

  let config;
  try {
    config = loadExtendedBackfillPilotConfig();
  } catch (error) {
    const mapped = pilotRejectionResponse(error);
    if (mapped) return mapped;
    throw error;
  }

  const ctx = await loadPilotJob({ workspaceId, jobId: id });
  if (!ctx) {
    return NextResponse.json({ error: "Pilot job not found in workspace.", code: "PILOT_JOB_NOT_FOUND" }, { status: 404 });
  }
  const creationStage = pilotJobStageFromKey(ctx.job.idempotencyKey);
  if (creationStage === "synthetic") {
    return NextResponse.json(
      { error: "Synthetic pilot jobs never execute against live providers.", code: "SYNTHETIC_EXECUTION_ONLY" },
      { status: 409 },
    );
  }
  const provider = normalizePilotProvider(ctx.chunks[0]?.provider ?? "");
  if (!provider) {
    return NextResponse.json(
      { error: "Extended pilot request refused: PROVIDER_INELIGIBLE", code: "PROVIDER_INELIGIBLE" },
      { status: 400 },
    );
  }

  let requestedDays = 0;
  try {
    const canonical = getCanonicalDateRange(ctx.job.since, ctx.job.until);
    requestedDays = Math.round((canonical.endUtc.getTime() - canonical.startUtc.getTime()) / 86_400_000) + 1;
  } catch {
    return NextResponse.json(
      { error: "Extended pilot request refused: INVALID_DATE_RANGE", code: "INVALID_DATE_RANGE" },
      { status: 400 },
    );
  }

  const connectionId = ctx.chunks[0]?.connectionId ?? "";
  const accountId = ctx.chunks[0]?.accountId ?? "";
  const [activeJobs, providerCallsToday, runningWs, runningAcct, existingScopeRows] = await Promise.all([
    prisma.warehouseImportJob.count({
      where: {
        workspaceId,
        idempotencyKey: { startsWith: "xbpilot:" },
        status: { in: [...PILOT_ACTIVE_JOB_STATUSES] },
        NOT: { id },
      },
    }),
    countProviderCallsToday(prisma as any, { workspaceId, provider }),
    prisma.warehouseBackfillChunk.count({ where: { workspaceId, status: "running" } }),
    prisma.warehouseBackfillChunk.count({ where: { workspaceId, status: "running", connectionId, accountId } }),
    prisma.campaignMetric.count({ where: { workspaceId, connectionId } }),
  ]);
  const capacity = estimatePilotCapacity({
    provider,
    requestedDays,
    plannedChunks: ctx.chunks.length,
    observedRowsPerDay: parsed.data.observedRowsPerDay ?? null,
    existingScopeRows,
    activeJobs,
    activeChunks: runningWs,
    bytesPerRow: parsed.data.bytesPerRow ?? null,
    limits: {
      maxChunksPerJob: config.maxChunksPerJob,
      maxEstimatedRows: config.maxProviderCallsPerDay * PILOT_ROWS_PER_CALL_PLANNING_ASSUMPTION,
    },
  });
  const decision = decideExtendedBackfill(
    { entryPoint: "operator", operation: "execute", provider, since: ctx.job.since, until: ctx.job.until, operatorAuthorized: true, executorKind: "live" },
    config,
    {
      workspaceExists: true,
      connectionExists: true,
      workspaceAllowlisted: config.allowedWorkspaceIds.includes(workspaceId),
      activeJobsInWorkspace: activeJobs,
      overlappingActiveJobs: 0,
      plannedChunks: ctx.chunks.length,
      providerCallsToday,
      runningChunksWorkspace: runningWs,
      runningChunksAccount: runningAcct,
      capacity,
    },
  );
  if (!decision.allowed) {
    try {
      await auditPilotEvent(prisma as any, {
        workspaceId, actorUserId: auth.userId, action: "pilot.extended_backfill.execute_rejected",
        jobId: id, provider, stage: config.stage, reasonCode: decision.reasonCode, requestedDays,
      });
    } catch {
      // Audit failure must not mask the rejection.
    }
    return pilotRejectionResponse(new PilotAdmissionError(decision.reasonCode, decision));
  }

  const startedAt = Date.now();
  try {
    const aggregation = await runPilotBackfillJob(id, {
      workspaceId,
      createExecutor: (parentLeaseId: string) =>
        createWarehouseChunkExecutor({
          jobId: id,
          leaseId: parentLeaseId,
          plan: ctx.job.plan ?? "pilot",
          isLeaseLost: () => false,
        }),
      concurrency: {
        workspaceLimit: config.maxConcurrentChunksPerWorkspace,
        accountLimit: config.maxConcurrentChunksPerAccount,
      },
    });
    try {
      await auditPilotEvent(prisma as any, {
        workspaceId, actorUserId: auth.userId, action: "pilot.extended_backfill.executed",
        jobId: id, provider, stage: config.stage, reasonCode: aggregation.status,
        requestedDays, plannedChunks: aggregation.totalChunks,
      });
    } catch {
      // Audit failure must not mask a successful execution.
    }
    return NextResponse.json({ jobId: id, aggregation, decision, durationMs: Date.now() - startedAt });
  } catch (error) {
    if (error instanceof LeaseLostError) {
      return NextResponse.json({ error: error.message, code: "LEASE_LOST" }, { status: 409 });
    }
    if (error instanceof PilotStateError) {
      return NextResponse.json({ error: error.message, code: "PILOT_STATE_CONFLICT" }, { status: 409 });
    }
    logger.error("[pilot/execute]", error);
    return NextResponse.json({ error: "Pilot execution failed" }, { status: 500 });
  }
}
