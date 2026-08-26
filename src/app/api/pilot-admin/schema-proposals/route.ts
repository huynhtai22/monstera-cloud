import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireOperator } from "@/lib/admin-auth";
import { productionRouteDisabled } from "@/lib/request-auth";
import { draftMappingProposal } from "@/lib/ai/mapping-copilot";
import type { DiscoveredField } from "@/lib/payload-schema-discovery";

export async function GET() {
  if (productionRouteDisabled("ENABLE_SCHEMA_COPILOT")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const gate = await requireOperator();
  if (gate.error) return gate.error;

  const proposals = await prisma.schemaPatchProposal.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ proposals });
}

/** Scan latest discovery rows and open pending proposals for diffs. */
export async function POST() {
  if (productionRouteDisabled("ENABLE_SCHEMA_COPILOT")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const gate = await requireOperator();
  if (gate.error) return gate.error;

  const discoveries = await prisma.payloadSchemaDiscovery.findMany({
    orderBy: { discoveredAt: "desc" },
    take: 100,
  });
  const latestByConnection = new Map<string, (typeof discoveries)[number]>();
  for (const row of discoveries) {
    if (!latestByConnection.has(row.connectionId)) latestByConnection.set(row.connectionId, row);
  }

  const created: string[] = [];
  for (const row of latestByConnection.values()) {
    let fields: DiscoveredField[] = [];
    try {
      fields = JSON.parse(row.fields) as DiscoveredField[];
    } catch {
      continue;
    }
    const draft = draftMappingProposal(row.provider, fields);
    if (!draft) continue;
    const existing = await prisma.schemaPatchProposal.findFirst({
      where: {
        connectionId: row.connectionId,
        status: "pending",
        addedFields: JSON.stringify(draft.addedFields),
        removedFields: JSON.stringify(draft.removedFields),
      },
    });
    if (existing) continue;
    const proposal = await prisma.schemaPatchProposal.create({
      data: {
        workspaceId: row.workspaceId,
        connectionId: row.connectionId,
        provider: row.provider,
        addedFields: JSON.stringify(draft.addedFields),
        removedFields: JSON.stringify(draft.removedFields),
        mappingDelta: JSON.stringify(draft.mappingDelta),
        breaking: draft.breaking,
        note: draft.note,
      },
    });
    created.push(proposal.id);
  }

  return NextResponse.json({ created: created.length, ids: created });
}
