import { NextRequest, NextResponse } from "next/server";
import { requirePilotOperator } from "@/lib/extended-backfill-pilot";
import { resumePilotJob } from "@/lib/extended-backfill-pilot-lifecycle";
import { PilotResumeSchema, invalidBody, pilotRejectionResponse } from "../../../_shared";

/** POST /api/operator/warehouse/extended-backfill/jobs/:id/resume (idempotent). */
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
  const parsed = PilotResumeSchema.safeParse(body);
  if (!parsed.success) return invalidBody();

  try {
    const result = await resumePilotJob({
      workspaceId: parsed.data.workspaceId,
      jobId: id,
      actorUserId: auth.userId,
      ...(parsed.data.observedRowsPerDay !== undefined ? { observedRowsPerDay: parsed.data.observedRowsPerDay } : {}),
      ...(parsed.data.bytesPerRow !== undefined ? { bytesPerRow: parsed.data.bytesPerRow } : {}),
    });
    return NextResponse.json({ jobId: id, ...result });
  } catch (error) {
    const mapped = pilotRejectionResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}
