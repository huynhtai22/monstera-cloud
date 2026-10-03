import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";

/**
 * GET /api/report-schedules
 * List report schedules for a workspace, optionally filtered by clientId.
 */
export async function GET(req: Request) {
  try {
    const session = await getAuthSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get("workspaceId");
    const clientId = searchParams.get("clientId");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "viewer" });

    const where: any = { workspaceId };
    if (clientId) {
      where.clientId = clientId;
    }

    const schedules = await prisma.reportSchedule.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(schedules);
  } catch (error: unknown) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load schedules" }, { status: 500 });
  }
}

/**
 * POST /api/report-schedules
 * Create or update a report schedule for a client or workspace.
 */
export async function POST(req: Request) {
  try {
    const session = await getAuthSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { id, workspaceId, clientId, cron, recipients, enabled } = body;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    if (!recipients || typeof recipients !== "string" || !recipients.trim()) {
      return NextResponse.json({ error: "At least one recipient (email, Slack webhook, or Telegram ID) is required" }, { status: 400 });
    }

    await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "member" });

    // If an existing ID is provided, update
    if (id) {
      const existing = await prisma.reportSchedule.findFirst({
        where: { id, workspaceId },
      });
      if (!existing) {
        return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
      }

      const updated = await prisma.reportSchedule.update({
        where: { id },
        data: {
          clientId: clientId ?? existing.clientId,
          cron: cron?.trim() || existing.cron,
          recipients: recipients.trim(),
          enabled: enabled ?? existing.enabled,
        },
      });

      return NextResponse.json(updated);
    }

    // Otherwise, check if a schedule already exists for this client in the workspace
    if (clientId) {
      const existingClientSchedule = await prisma.reportSchedule.findFirst({
        where: { workspaceId, clientId },
      });

      if (existingClientSchedule) {
        const updated = await prisma.reportSchedule.update({
          where: { id: existingClientSchedule.id },
          data: {
            cron: cron?.trim() || existingClientSchedule.cron,
            recipients: recipients.trim(),
            enabled: enabled ?? existingClientSchedule.enabled,
          },
        });
        return NextResponse.json(updated);
      }
    }

    // Create a new schedule
    const created = await prisma.reportSchedule.create({
      data: {
        workspaceId,
        clientId: clientId || null,
        cron: cron?.trim() || "0 9 * * 1",
        recipients: recipients.trim(),
        enabled: enabled ?? true,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error: unknown) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save schedule" }, { status: 500 });
  }
}

/**
 * DELETE /api/report-schedules
 * Delete a report schedule.
 */
export async function DELETE(req: Request) {
  try {
    const session = await getAuthSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const workspaceId = searchParams.get("workspaceId");

    if (!id || !workspaceId) {
      return NextResponse.json({ error: "id and workspaceId are required" }, { status: 400 });
    }

    await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "member" });

    const existing = await prisma.reportSchedule.findFirst({
      where: { id, workspaceId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    }

    await prisma.reportSchedule.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, deletedId: id });
  } catch (error: unknown) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete schedule" }, { status: 500 });
  }
}
