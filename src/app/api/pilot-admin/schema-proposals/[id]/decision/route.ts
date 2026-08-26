import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { productionRouteDisabled } from "@/lib/request-auth";
import { decideSchemaPatchProposal } from "@/lib/ai/mapping-overlay";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  if (productionRouteDisabled("ENABLE_SCHEMA_COPILOT")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const gate = await requireOperator();
  if (gate.error) return gate.error;

  const params = await context.params;
  const body = await req.json().catch(() => ({}));
  const decision = body.decision === "approved" || body.decision === "rejected" ? body.decision : null;
  if (!decision) {
    return NextResponse.json({ error: "decision must be approved or rejected" }, { status: 400 });
  }

  const result = await decideSchemaPatchProposal({
    proposalId: params.id,
    decision,
    operatorUserId: gate.session!.user!.id,
    note: typeof body.note === "string" ? body.note : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, message: result.message }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    decision: result.decision,
    overlayApplied: result.overlayApplied,
  });
}
