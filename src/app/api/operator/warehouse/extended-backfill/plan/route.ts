import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  decideExtendedBackfill,
  estimatePilotCapacity,
  getProviderPilotEligibility,
  loadExtendedBackfillPilotConfig,
  normalizePilotAccountId,
  normalizePilotProvider,
  PILOT_ROWS_PER_CALL_PLANNING_ASSUMPTION,
  requirePilotOperator,
} from "@/lib/extended-backfill-pilot";
import { planHistoricalBackfill } from "@/lib/historical-backfill-plan";
import { PilotRangeSchema, invalidBody, pilotRejectionResponse } from "../_shared";

/**
 * POST /api/operator/warehouse/extended-backfill/plan
 * Operator-only extended planning preview. Pure read path: zero persistent
 * side effects (no jobs, chunks, audits, or provider contact).
 */
export async function POST(req: Request) {
  const auth = await requirePilotOperator();
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = PilotRangeSchema.safeParse(body);
  if (!parsed.success) return invalidBody();
  const { workspaceId, provider: rawProvider, since, until } = parsed.data;

  const provider = normalizePilotProvider(rawProvider);
  const accountId = normalizePilotAccountId((parsed.data as { accountId?: unknown }).accountId);
  if (!provider || accountId === null) {
    return NextResponse.json(
      { error: "Extended pilot request refused: PROVIDER_INELIGIBLE", code: "PROVIDER_INELIGIBLE" },
      { status: 400 },
    );
  }

  let config;
  try {
    config = loadExtendedBackfillPilotConfig();
  } catch (error) {
    const mapped = pilotRejectionResponse(error);
    if (mapped) return mapped;
    throw error;
  }

  const eligibility = getProviderPilotEligibility(provider);
  let plan: ReturnType<typeof planHistoricalBackfill> | null = null;
  let planError: string | null = null;
  if (eligibility) {
    try {
      plan = planHistoricalBackfill({ provider, since, until, asOf: until, execution: "plan" });
    } catch (error) {
      planError = error instanceof Error ? error.message : "Planning failed";
    }
  }

  const activeJobsInWorkspace = await prisma.warehouseImportJob.count({
    where: {
      workspaceId,
      idempotencyKey: { startsWith: "xbpilot:" },
      status: { in: ["queued", "running", "paused", "pause_requested"] },
    },
  });
  const capacity = estimatePilotCapacity({
    provider,
    requestedDays: plan?.requestedRange.days ?? 0,
    plannedChunks: plan?.chunks.length ?? 0,
    observedRowsPerDay: null,
    existingScopeRows: 0,
    activeJobs: activeJobsInWorkspace,
    activeChunks: 0,
    bytesPerRow: null,
    limits: {
      maxChunksPerJob: config.maxChunksPerJob,
      maxEstimatedRows: config.maxProviderCallsPerDay * PILOT_ROWS_PER_CALL_PLANNING_ASSUMPTION,
    },
  });

  const decision = decideExtendedBackfill(
    { entryPoint: "operator", operation: "plan", provider, since, until, operatorAuthorized: true },
    config,
    {
      workspaceExists: Boolean(await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } })),
      connectionExists: true,
      workspaceAllowlisted: config.allowedWorkspaceIds.includes(workspaceId),
      activeJobsInWorkspace,
      overlappingActiveJobs: 0,
      plannedChunks: plan?.chunks.length ?? 0,
      providerCallsToday: 0,
      runningChunksWorkspace: 0,
      runningChunksAccount: 0,
      capacity,
    },
  );

  return NextResponse.json({
    decision,
    capacity,
    plan: plan
      ? {
          provider: plan.provider,
          requestedRange: plan.requestedRange,
          chunkCount: plan.chunkCount,
          chunks: plan.chunks.map((chunk) => ({ since: chunk.since, until: chunk.until, ordinal: chunk.ordinal })),
          executionAllowed: plan.executionAllowed,
        }
      : null,
    planError,
  });
}
