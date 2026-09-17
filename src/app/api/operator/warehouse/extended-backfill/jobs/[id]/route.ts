import { NextRequest, NextResponse } from "next/server";
import {
  requirePilotOperator,
  summarizePilotTelemetry,
} from "@/lib/extended-backfill-pilot";
import { loadPilotJob } from "@/lib/extended-backfill-pilot-lifecycle";
import { aggregateChunkStates } from "@/lib/warehouse-backfill-chunks";

/**
 * GET /api/operator/warehouse/extended-backfill/jobs/:id?workspaceId=
 * Operator-only pilot job inspection with bounded sanitized telemetry.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePilotOperator();
  if (auth.error) return auth.error;

  const { id } = await context.params;
  const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? "";
  if (!id || !workspaceId) {
    return NextResponse.json({ error: "Job ID and workspaceId are required" }, { status: 400 });
  }

  const ctx = await loadPilotJob({ workspaceId, jobId: id });
  if (!ctx) {
    return NextResponse.json({ error: "Pilot job not found in workspace.", code: "PILOT_JOB_NOT_FOUND" }, { status: 404 });
  }
  // Chunk rows carry BigInt fencing tokens, which JSON cannot serialize.
  const chunks = ctx.chunks.map((chunk) => ({ ...chunk, fencingToken: String(chunk.fencingToken) }));
  const aggregation = aggregateChunkStates(ctx.chunks);
  const attempts = ctx.chunks.reduce((sum, chunk) => sum + (chunk.attempts ?? 0), 0);
  const started = ctx.job.startedAt ? new Date(ctx.job.startedAt).getTime() : null;
  const finished = ctx.job.finishedAt ? new Date(ctx.job.finishedAt).getTime() : null;
  const telemetry = summarizePilotTelemetry({
    workspaceId,
    jobId: ctx.job.id,
    provider: ctx.chunks[0]?.provider ?? "",
    accountId: ctx.chunks[0]?.accountId ?? "",
    requestedRange: { since: ctx.job.since, until: ctx.job.until },
    effectiveRange: aggregation.coverage,
    plannedChunks: aggregation.totalChunks,
    claimedChunks: aggregation.totalChunks - aggregation.queuedChunks,
    completedChunks: aggregation.completedChunks,
    failedChunks: aggregation.failedChunks,
    partialChunks: aggregation.partialChunks,
    cancelledChunks: aggregation.cancelledChunks,
    rowsWritten: aggregation.approximateRows,
    durationMs: started !== null && finished !== null ? Math.max(0, finished - started) : null,
    retryCount: attempts,
    providerCalls: attempts,
    rateLimitedResponses: 0,
    estimatedRows: null,
    terminalStatus: ["completed", "partial", "failed", "cancelled", "partial_cancelled"].includes(String(ctx.job.status))
      ? String(ctx.job.status)
      : null,
    reasonCode: "OK",
  });

  return NextResponse.json({ job: ctx.job, chunks, aggregation, telemetry });
}
