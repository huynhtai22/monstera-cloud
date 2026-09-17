import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requirePilotOperator, auditPilotEvent } from "@/lib/extended-backfill-pilot";
import { admitAndCreatePilotJob } from "@/lib/extended-backfill-pilot-lifecycle";
import { PilotAdmissionError } from "@/lib/extended-backfill-pilot";
import { PilotJobsSchema, invalidBody, pilotRejectionResponse } from "../_shared";

/**
 * POST /api/operator/warehouse/extended-backfill/jobs
 * Operator-only admitted creation. Full policy decision inside a serialized
 * transaction; idempotent replay returns the existing job.
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
  const parsed = PilotJobsSchema.safeParse(body);
  if (!parsed.success) return invalidBody();
  const { workspaceId, provider, connectionId, since, until } = parsed.data;
  const accountId = (parsed.data as { accountId?: unknown }).accountId;
  const clientKey = (parsed.data as { clientKey?: string }).clientKey;
  const observedRowsPerDay = (parsed.data as { observedRowsPerDay?: number }).observedRowsPerDay;
  const bytesPerRow = (parsed.data as { bytesPerRow?: number }).bytesPerRow;

  try {
    const admitted = await admitAndCreatePilotJob({
      actorUserId: auth.userId,
      workspaceId,
      provider,
      connectionId,
      accountId,
      since,
      until,
      ...(clientKey ? { clientKey } : {}),
      ...(observedRowsPerDay !== undefined ? { observedRowsPerDay } : {}),
      ...(bytesPerRow !== undefined ? { bytesPerRow } : {}),
    });
    return NextResponse.json(
      { job: admitted.job, chunks: admitted.chunks, decision: admitted.decision, capacity: admitted.capacity, reused: admitted.reused },
      { status: admitted.reused ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof PilotAdmissionError && error.reasonCode !== "OK") {
      try {
        await auditPilotEvent(prisma as any, {
          workspaceId,
          actorUserId: auth.userId,
          action: "pilot.extended_backfill.job_rejected",
          jobId: "pending",
          provider: String(provider),
          stage: "operator",
          reasonCode: error.reasonCode,
        });
      } catch {
        // Audit failure must not mask the rejection.
      }
    }
    const mapped = pilotRejectionResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}
