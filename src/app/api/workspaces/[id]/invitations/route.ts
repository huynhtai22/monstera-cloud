import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { generateInvitationToken, normalizeEmail } from "@/lib/invitation-security";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import type { WorkspaceRole } from "@prisma/client";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id: workspaceId } = await params;
    await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "admin", operation: "list_invitations" });
    const invitations = await prisma.workspaceInvitation.findMany({
      where: { workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    });
    return NextResponse.json({ invitations });
  } catch (error) {
    return toRbacResponse(error) ?? NextResponse.json({ error: "Could not list invitations" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id: workspaceId } = await params;
    const access = await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "admin", operation: "invite_member" });
    const body = await request.json();
    const email = normalizeEmail(String(body.email || ""));
    const role: WorkspaceRole = body.role === "admin" || body.role === "viewer" ? body.role : "member";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
    if (role === "admin" && access.membership.role !== "owner") return NextResponse.json({ error: "Only the owner can invite admins" }, { status: 403 });

    const existing = await prisma.workspaceMember.findFirst({ where: { workspaceId, user: { email } }, select: { id: true } });
    if (existing) return NextResponse.json({ error: "This user is already a member" }, { status: 409 });
    await prisma.workspaceInvitation.updateMany({ where: { workspaceId, email, acceptedAt: null }, data: { expiresAt: new Date() } });
    const generated = generateInvitationToken();
    const invitation = await prisma.workspaceInvitation.create({
      data: { workspaceId, email, role, tokenHash: generated.tokenHash, invitedByUserId: session.user.id, enabledProviders: [], expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      select: { id: true, email: true, role: true, expiresAt: true },
    });
    await prisma.auditEvent.create({ data: { workspaceId, actorUserId: session.user.id, action: "invitation.created", resource: "workspace_invitation", resourceId: invitation.id, metadata: { role, email } } });
    return NextResponse.json({ ...invitation, invitationUrl: `${new URL(request.url).origin}/invite/${generated.token}` }, { status: 201 });
  } catch (error) {
    return toRbacResponse(error) ?? NextResponse.json({ error: "Could not create invitation" }, { status: 500 });
  }
}
