import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/admin-auth";
import { withSystemScope } from "@/lib/tenant-guard";
import { mapWarehouseJobToRun, mapSyncLogToRun } from "@/lib/ingestion/runs";
import { STALE_AFTER_MS } from "@/lib/ingestion/stale-health";

export async function GET() {
  const auth = await requirePlatformAdmin();
  if (auth.error) return auth.error;

  return withSystemScope(async () => {
    const now = new Date();
    const ago24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const staleThreshold = new Date(now.getTime() - STALE_AFTER_MS);
    const queuedCutoff = new Date(now.getTime() - 15 * 60 * 1000);

    const [tickets, failedJobs, errorLogs, staleSources, oldQueued, workspaces] = await Promise.all([
      prisma.supportTicket.findMany({
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take: 80,
      }),
      prisma.warehouseImportJob.findMany({
        where: { status: { in: ["failed", "queued"] }, createdAt: { gte: ago24h } },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      prisma.syncLog.findMany({
        where: { status: "error", createdAt: { gte: ago24h } },
        include: {
          pipeline: {
            select: { id: true, name: true, sourceConnectionId: true, workspaceId: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.connection.count({
        where: {
          type: "source",
          status: "connected",
          OR: [
            { lastSyncAt: { lt: staleThreshold } },
            { lastSyncAt: null, createdAt: { lt: staleThreshold } },
          ],
        },
      }),
      prisma.warehouseImportJob.count({
        where: { status: "queued", scheduledAt: { lt: queuedCutoff } },
      }),
      prisma.workspace.findMany({
        select: { id: true, name: true, slug: true },
      }),
    ]);

    const workspaceName = new Map(workspaces.map((ws) => [ws.id, ws.name]));
    const runs = [
      ...failedJobs.map(mapWarehouseJobToRun),
      ...errorLogs.map(mapSyncLogToRun),
    ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    return NextResponse.json({
      summary: {
        openTickets: tickets.filter((ticket) => ticket.status === "open").length,
        acknowledgedTickets: tickets.filter((ticket) => ticket.status === "acknowledged").length,
        failedRuns24h: runs.length,
        staleSources,
        oldQueuedJobs: oldQueued,
      },
      tickets: tickets.map((ticket) => ({
        ...ticket,
        workspaceName: workspaceName.get(ticket.workspaceId) ?? ticket.workspaceId,
      })),
      runs,
    });
  });
}

export async function PATCH(req: Request) {
  const auth = await requirePlatformAdmin();
  if (auth.error) return auth.error;

  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    notes?: string;
  };
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (body.status && !["open", "acknowledged", "resolved"].includes(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  return withSystemScope(async () => {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: body.id } });
    if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

    const updated = await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        status: body.status ?? ticket.status,
        notes: body.notes ?? ticket.notes,
        acknowledgedAt:
          body.status === "acknowledged" ? new Date() : ticket.acknowledgedAt,
        resolvedAt: body.status === "resolved" ? new Date() : body.status === "open" ? null : ticket.resolvedAt,
      },
    });
    return NextResponse.json({ ticket: updated });
  });
}
