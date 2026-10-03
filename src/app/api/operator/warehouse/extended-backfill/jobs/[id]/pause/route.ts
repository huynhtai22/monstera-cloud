import { NextRequest, NextResponse } from "next/server";
import { requirePilotOperator } from "@/lib/extended-backfill-pilot";
import { pausePilotJob } from "@/lib/extended-backfill-pilot-lifecycle";
import { PilotWorkspaceSchema, invalidBody, pilotRejectionResponse } from "../../../_shared";

/** POST /api/operator/warehouse/extended-backfill/jobs/:id/pause (idempotent). */
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
  const parsed = PilotWorkspaceSchema.safeParse(body);
  if (!parsed.success) return invalidBody();

  try {
    const result = await pausePilotJob({ workspaceId: parsed.data.workspaceId, jobId: id, actorUserId: auth.userId });
    return NextResponse.json({ jobId: id, ...result });
  } catch (error) {
    const mapped = pilotRejectionResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}
