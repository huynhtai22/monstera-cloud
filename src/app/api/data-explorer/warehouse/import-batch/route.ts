import { NextResponse, after } from "next/server";
import { warehouseUsesDedicatedWorker } from "@/lib/warehouse-dispatch";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getAuthSession } from "@/lib/auth-session";
import { logger } from "@/lib/logger";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { clampTimeRangeToPlanMaxDays, getPlanLimits } from "@/lib/plan-config";
import { createImportJob, claimImportJob, type BatchImportItem } from "@/lib/warehouse-import-job";
import { runPostWarehouseRefreshQualityChecks } from "@/lib/observability/data-quality";
import { HistoricalBackfillPlanningError } from "@/lib/historical-backfill-plan";
import {
  assertExecutableWarehouseRange,
  getOversizedExecutionDetails,
  toOversizedExecutionResponse,
} from "@/lib/warehouse-execution-guard";
import { processBatchItems, runDurableImportWorker } from "@/lib/warehouse-import-worker";

const MAX_CONCURRENT_JOBS_PER_WORKSPACE = 5;
const MAX_ITEMS_PER_REQUEST = 50;

/**
 * Keeps the generic import endpoint from bypassing the historical planner.
 * OAuth is the sole current caller that can persist its approved 90-day Meta
 * and Google window as bounded item ranges; every other multi-chunk request
 * must fail closed until a general resumable chunk dispatcher exists.
 *
 * Delegates to the shared Warehouse execution guard so single-import and
 * batch-import enforce the identical raw-range policy before plan clamping,
 * job creation, worker dispatch, database writes, or provider contact.
 */
export async function assertBatchHistoricalExecutionAllowed(opts: {
  workspaceId: string;
  since: string;
  until: string;
  planMaximumDays?: number;
  items: BatchImportItem[];
}): Promise<void> {
  const connectionIds = Array.from(new Set(opts.items.map((item) => item.connectionId)));
  const connections = await prisma.connection.findMany({
    where: { id: { in: connectionIds }, workspaceId: opts.workspaceId },
    select: { provider: true },
  });

  for (const provider of new Set(connections.map((connection) => connection.provider))) {
    // A plan projection may be smaller than a dangerous raw request. The
    // guard intentionally evaluates raw provider execution first; the
    // route performs visible product clamping only after this check passes.
    assertExecutableWarehouseRange({ provider, since: opts.since, until: opts.until });
  }
}

const ItemSchema = z.object({
  connectionId: z.string().min(1, "connectionId is required"),
  accountId: z.string().optional(),
  adAccountId: z.string().optional(),
});

const ImportBatchSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  since: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "since must be formatted as YYYY-MM-DD"),
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "until must be formatted as YYYY-MM-DD"),
  items: z
    .array(ItemSchema)
    .min(1, "At least one item must be provided")
    .max(
      MAX_ITEMS_PER_REQUEST,
      `Cannot import more than ${MAX_ITEMS_PER_REQUEST} items per batch`
    ),
  async: z.boolean().optional(),
  idempotencyKey: z.string().max(128).optional(),
});

/**
 * POST /api/data-explorer/warehouse/import-batch
 * Runs warehouse refresh for selected connections (and optional Meta ad accounts).
 * Supports durable background asynchronous execution and synchronous execution.
 */
export async function POST(req: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ImportBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const {
    workspaceId,
    since: rawSince,
    until: rawUntil,
    items: rawItems,
    async: isAsync,
    idempotencyKey,
  } = parsed.data;

  // Validate date logic
  const sinceDate = new Date(rawSince);
  const untilDate = new Date(rawUntil);
  if (sinceDate.getTime() > untilDate.getTime()) {
    return NextResponse.json(
      { error: "Date 'since' cannot be after 'until'" },
      { status: 400 }
    );
  }

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "member",
      operation: "batch_import_warehouse",
    });
  } catch (err) {
    const rbacRes = toRbacResponse(err);
    if (rbacRes) return rbacRes;
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  });
  const plan = workspace?.plan ?? "pilot";

  // Plan limits: clamp date span
  const planLimits = getPlanLimits(plan);
  // Evaluate the caller's full request before a product limit can shrink it.
  // Otherwise a 90-day generic Meta/Google request could be reduced to a
  // smaller plan window and incorrectly reach the unchunked worker.
  try {
    await assertBatchHistoricalExecutionAllowed({
      workspaceId,
      since: rawSince,
      until: rawUntil,
      planMaximumDays: planLimits.maxHistoryDays,
      items: rawItems,
    });
  } catch (error) {
    const oversized = getOversizedExecutionDetails(error);
    if (oversized) {
      return NextResponse.json(
        toOversizedExecutionResponse(oversized.provider, oversized.requestedRange, oversized.maxExecutableDays),
        { status: 422 },
      );
    }
    if (error instanceof HistoricalBackfillPlanningError) {
      if (error.code === "INVALID_DATE_RANGE") {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 422 },
      );
    }
    throw error;
  }

  const { since, until, clamped } = clampTimeRangeToPlanMaxDays(plan, {
    since: rawSince,
    until: rawUntil,
  });

  if (clamped && planLimits.maxHistoryDays) {
    logger.info(
      `[warehouse/import-batch] Clamped date range for plan ${plan} to ${since}..${until} (max ${planLimits.maxHistoryDays} days)`
    );
  }

  // Deduplicate items: unique requested connection/account scope.
  const itemMap = new Map<string, BatchImportItem>();
  for (const item of rawItems) {
    const key = `${item.connectionId}:${item.accountId ?? item.adAccountId ?? ""}`;
    if (!itemMap.has(key)) {
      itemMap.set(key, item);
    }
  }
  const items = Array.from(itemMap.values());

  // Check workspace concurrency limit
  const activeJobsCount = await prisma.warehouseImportJob.count({
    where: {
      workspaceId,
      status: { in: ["queued", "running"] },
    },
  });

  if (activeJobsCount >= MAX_CONCURRENT_JOBS_PER_WORKSPACE) {
    return NextResponse.json(
      {
        error: "Too many active import jobs for this workspace",
        message: `Workspace has ${activeJobsCount} active jobs (max ${MAX_CONCURRENT_JOBS_PER_WORKSPACE}). Please wait for current jobs to finish.`,
      },
      { status: 429 }
    );
  }

  if (isAsync || warehouseUsesDedicatedWorker()) {
    const jobState = await createImportJob({
      workspaceId,
      userId: session.user.id,
      plan,
      since,
      until,
      requestedSince: rawSince,
      requestedUntil: rawUntil,
      clamped,
      items,
      idempotencyKey,
      priority: planLimits.priority,
    });

    // Durably schedule execution in the serverless background context using Next.js after()
    if (!warehouseUsesDedicatedWorker()) after(async () => {
      try {
        const claim = await claimImportJob(jobState.id);
        if (claim.claimed && claim.leaseId) {
          await runDurableImportWorker(jobState.id, claim.leaseId);
        }
      } catch (err) {
        logger.error(`[warehouse/import-batch] after() worker execution error for job ${jobState.id}:`, err);
      }
    });

    return NextResponse.json(
      {
        success: true,
        async: true,
        jobId: jobState.id,
        status: jobState.status,
        totalJobs: items.length,
        requestedRange: { since: rawSince, until: rawUntil },
        effectiveRange: { since, until },
        clamped,
        message: `Durable batch import job ${jobState.id} queued with ${items.length} task(s).`,
      },
      { status: 202 }
    );
  }

  const results = await processBatchItems({
    workspaceId,
    since,
    until,
    plan,
    items,
  });

  // Await post-refresh quality checks for successful connections
  const successfulConnections = Array.from(
    new Set(results.filter((r) => r.ok).map((r) => r.connectionId))
  );
  for (const connId of successfulConnections) {
    try {
      await runPostWarehouseRefreshQualityChecks(workspaceId, connId);
    } catch (dqErr) {
      logger.error(`[warehouse/import-batch][DATA_QUALITY] Error checking connection ${connId}:`, dqErr);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const totalUpserts = results.reduce(
    (s, r) => s + (r.upserted ?? r.rowsIngested ?? 0),
    0
  );

  return NextResponse.json({
    success: okCount > 0,
    okCount,
    totalJobs: results.length,
    approximateRows: totalUpserts,
    results,
    requestedRange: { since: rawSince, until: rawUntil },
    effectiveRange: { since, until },
    clamped,
    message:
      okCount === results.length
        ? `All ${results.length} import job(s) completed.`
        : `${okCount}/${results.length} job(s) completed; see results for detail.`,
  });
}
