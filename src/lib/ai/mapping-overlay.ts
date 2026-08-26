import prisma from "@/lib/prisma";
import { getConnectorConfig, isConnectorSupported } from "@/etl/connector-registry";
import { CANONICAL_WAREHOUSE_FIELDS } from "@/lib/ai/mapping-copilot";

function compileTimeMapping(provider: string): Record<string, string> {
  if (!isConnectorSupported(provider)) return {};
  return getConnectorConfig(provider)?.fieldMapping ?? {};
}

export type MappingDecision = "approved" | "rejected";

export type DecideProposalResult =
  | { ok: true; decision: MappingDecision; overlayApplied: Record<string, string> }
  | { ok: false; status: number; error: string; message: string };

export function parseMappingDelta(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === "string" && typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Only additive maps onto known warehouse columns. Compile-time fieldMapping wins. */
export function sanitizeMappingDelta(
  delta: Record<string, string>,
  compileTimeMapping: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [source, target] of Object.entries(delta)) {
    if (!source.trim() || compileTimeMapping[source]) continue;
    if (!CANONICAL_WAREHOUSE_FIELDS.has(target)) continue;
    out[source] = target;
  }
  return out;
}

export async function loadApprovedMappingOverlay(
  workspaceId: string,
  connectionId: string,
  provider?: string,
): Promise<Record<string, string>> {
  const rows = await prisma.schemaPatchProposal.findMany({
    where: { workspaceId, connectionId, status: "approved", breaking: false },
    select: { mappingDelta: true, provider: true },
    orderBy: { createdAt: "asc" },
  });
  const merged: Record<string, string> = {};
  for (const row of rows) {
    const compileTime = compileTimeMapping(provider ?? row.provider);
    Object.assign(merged, sanitizeMappingDelta(parseMappingDelta(row.mappingDelta), compileTime));
  }
  return merged;
}

export async function decideSchemaPatchProposal(opts: {
  proposalId: string;
  decision: MappingDecision;
  operatorUserId: string;
  note?: string;
}): Promise<DecideProposalResult> {
  const proposal = await prisma.schemaPatchProposal.findUnique({ where: { id: opts.proposalId } });
  if (!proposal) {
    return { ok: false, status: 404, error: "not_found", message: "Proposal not found" };
  }
  if (proposal.status !== "pending") {
    return {
      ok: false,
      status: 409,
      error: "already_decided",
      message: `Proposal is already ${proposal.status}`,
    };
  }

  if (opts.decision === "rejected") {
    await prisma.schemaPatchProposal.updateMany({
      where: { id: proposal.id, workspaceId: proposal.workspaceId, status: "pending" },
      data: {
        status: "rejected",
        decidedAt: new Date(),
        decidedBy: opts.operatorUserId,
        note: opts.note ?? proposal.note,
      },
    });
    await prisma.auditEvent.create({
      data: {
        workspaceId: proposal.workspaceId,
        actorUserId: opts.operatorUserId,
        action: "schema_patch.rejected",
        resource: "schema_patch_proposal",
        resourceId: proposal.id,
        metadata: { provider: proposal.provider, connectionId: proposal.connectionId },
      },
    });
    return { ok: true, decision: "rejected", overlayApplied: {} };
  }

  if (proposal.breaking) {
    return {
      ok: false,
      status: 409,
      error: "breaking_requires_engineer_pr",
      message:
        "Breaking mapping diffs cannot be applied as an overlay. Open an engineer PR against compile-time fieldMapping.",
    };
  }

  const compileTime = compileTimeMapping(proposal.provider);
  const overlayApplied = sanitizeMappingDelta(parseMappingDelta(proposal.mappingDelta), compileTime);

  await prisma.schemaPatchProposal.updateMany({
    where: { id: proposal.id, workspaceId: proposal.workspaceId, status: "pending" },
    data: {
      status: "approved",
      mappingDelta: JSON.stringify(overlayApplied),
      decidedAt: new Date(),
      decidedBy: opts.operatorUserId,
      note:
        opts.note ??
        (Object.keys(overlayApplied).length > 0
          ? `OPERATOR overlay applied for ${Object.keys(overlayApplied).join(", ")}. Compile-time fieldMapping unchanged.`
          : "Approved with no overlay keys (no canonical mapping)."),
    },
  });
  await prisma.auditEvent.create({
    data: {
      workspaceId: proposal.workspaceId,
      actorUserId: opts.operatorUserId,
      action: "schema_patch.approved",
      resource: "schema_patch_proposal",
      resourceId: proposal.id,
      metadata: {
        provider: proposal.provider,
        connectionId: proposal.connectionId,
        overlayApplied,
      },
    },
  });
  return { ok: true, decision: "approved", overlayApplied };
}
