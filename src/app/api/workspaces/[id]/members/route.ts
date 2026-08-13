import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import type { WorkspaceRole } from "@prisma/client";

async function context(params: Promise<{ id: string }>) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  const { id: workspaceId } = await params;
  const access = await requireWorkspaceAccess({
    userId: session.user.id,
    workspaceId,
    minimumRole: "admin",
    operation: "manage_members",
  });
  return { session, workspaceId, access };
}

function errorResponse(error: unknown) {
  if (error instanceof Response) return error;
  return toRbacResponse(error) ?? NextResponse.json({ error: "Member operation failed" }, { status: 500 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { workspaceId } = await context(params);
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: [{ role: "asc" }, { user: { email: "asc" } }],
      select: { id: true, role: true, userId: true, user: { select: { name: true, email: true, image: true } } },
    });
    return NextResponse.json({ members });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, workspaceId, access } = await context(params);
    const body = await request.json();
    const userId = typeof body.userId === "string" ? body.userId : "";
    const role = body.role as WorkspaceRole;
    if (!userId || !["admin", "member", "viewer"].includes(role)) {
      return NextResponse.json({ error: "userId and a valid role are required" }, { status: 400 });
    }
    const target = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId }, select: { role: true } });
    if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    if (target.role === "owner" || userId === session.user.id) {
      return NextResponse.json({ error: "The owner or current member cannot be changed here" }, { status: 409 });
    }
    if (role === "admin" && access.membership.role !== "owner") {
      return NextResponse.json({ error: "Only the owner can grant admin access" }, { status: 403 });
    }
    await prisma.workspaceMember.updateMany({ where: { workspaceId, userId }, data: { role } });
    await prisma.auditEvent.create({ data: { workspaceId, actorUserId: session.user.id, action: "member.role_changed", resource: "workspace_member", resourceId: userId, metadata: { role } } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, workspaceId } = await context(params);
    const userId = new URL(request.url).searchParams.get("userId") ?? "";
    const target = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId }, select: { role: true } });
    if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    if (target.role === "owner" || userId === session.user.id) {
      return NextResponse.json({ error: "The workspace owner or current member cannot be removed" }, { status: 409 });
    }
    await prisma.workspaceMember.deleteMany({ where: { workspaceId, userId } });
    await prisma.auditEvent.create({ data: { workspaceId, actorUserId: session.user.id, action: "member.removed", resource: "workspace_member", resourceId: userId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
