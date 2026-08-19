import prisma from "@/lib/prisma";

export type TicketReason = "auth" | "exhausted_retries" | "stale" | "import_failed";

export function ticketFingerprint(input: {
  reason: string;
  connectionId?: string | null;
  tag?: string | null;
}): string {
  return [input.reason, input.connectionId || "workspace", input.tag || "none"].join(":");
}

export async function upsertOpenTicket(input: {
  workspaceId: string;
  reason: TicketReason;
  title: string;
  tag?: string | null;
  errorMsg?: string | null;
  runId?: string | null;
  connectionId?: string | null;
  pipelineId?: string | null;
}) {
  const fingerprint = ticketFingerprint(input);
  const existing = await prisma.supportTicket.findFirst({
    where: { workspaceId: input.workspaceId, fingerprint, status: { in: ["open", "acknowledged"] } },
  });
  if (existing) {
    return prisma.supportTicket.update({
      where: { id: existing.id },
      data: {
        errorMsg: input.errorMsg ?? existing.errorMsg,
        runId: input.runId ?? existing.runId,
        title: input.title,
      },
    });
  }
  return prisma.supportTicket.create({
    data: {
      workspaceId: input.workspaceId,
      reason: input.reason,
      title: input.title,
      tag: input.tag,
      errorMsg: input.errorMsg,
      runId: input.runId,
      connectionId: input.connectionId,
      pipelineId: input.pipelineId,
      fingerprint,
    },
  });
}
