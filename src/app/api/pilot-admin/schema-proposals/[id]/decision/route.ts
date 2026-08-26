import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireOperator } from "@/lib/admin-auth";
import { productionRouteDisabled } from "@/lib/request-auth";

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

  const updated = await prisma.schemaPatchProposal.updateMany({
    where: { id: params.id, status: "pending" },
    data: {
      status: decision,
      note: typeof body.note === "string" ? body.note : undefined,
      decidedAt: new Date(),
      decidedBy: gate.session?.user?.id ?? null,
    },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, decision });
}
