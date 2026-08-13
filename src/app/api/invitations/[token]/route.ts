import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hashInvitationToken, normalizeEmail } from "@/lib/invitation-security";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const invitation = await prisma.workspaceInvitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    select: { email: true, agencyName: true, role: true, expiresAt: true, acceptedAt: true, workspace: { select: { name: true } } },
  });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      return NextResponse.json({ error: "Invitation is invalid or expired" }, { status: 404 });
    }
    const [local, domain = ""] = invitation.email.split("@");
    return NextResponse.json({ emailHint: `${local.slice(0, 2)}***@${domain}`, agencyName: invitation.agencyName || invitation.workspace?.name, role: invitation.role, expiresAt: invitation.expiresAt });
  } catch {
    return NextResponse.json({ error: "Invitation service is temporarily unavailable" }, { status: 503 });
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Sign in with the invited email first" }, { status: 401 });
  }
  const { token } = await params;
  const tokenHash = hashInvitationToken(token);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const invitation = await tx.workspaceInvitation.findUnique({ where: { tokenHash } });
      if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
        throw new Error("INVALID_INVITATION");
      }
      if (normalizeEmail(invitation.email) !== normalizeEmail(session.user.email!)) {
        throw new Error("EMAIL_MISMATCH");
      }

      let workspaceId = invitation.workspaceId;
      if (!workspaceId) {
        if (!invitation.agencyName || !invitation.agencySlug) throw new Error("INVALID_INVITATION");
        const workspace = await tx.workspace.create({
          data: {
            name: invitation.agencyName,
            slug: invitation.agencySlug,
            ownerId: session.user.id,
            plan: invitation.plan || "pilot",
            status: "PILOT",
            members: { create: { userId: session.user.id, role: "owner" } },
            providerAccess: {
              create: invitation.enabledProviders.map((provider) => ({ provider, enabled: true })),
            },
          },
          select: { id: true, slug: true },
        });
        workspaceId = workspace.id;
      } else {
        await tx.workspaceMember.upsert({
          where: { workspaceId_userId: { workspaceId, userId: session.user.id } },
          create: { workspaceId, userId: session.user.id, role: invitation.role },
          update: { role: invitation.role },
        });
      }

      const accepted = await tx.workspaceInvitation.updateMany({
        where: { id: invitation.id, acceptedAt: null },
        data: { acceptedAt: new Date(), acceptedByUserId: session.user.id, workspaceId },
      });
      if (accepted.count !== 1) throw new Error("INVALID_INVITATION");
      await tx.auditEvent.create({
        data: {
          workspaceId,
          actorUserId: session.user.id,
          action: "invitation.accepted",
          resource: "workspace_membership",
          resourceId: session.user.id,
          metadata: { role: invitation.role },
        },
      });
      return { workspaceId };
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "EMAIL_MISMATCH") return NextResponse.json({ error: "This invitation belongs to another email" }, { status: 403 });
    if (message === "INVALID_INVITATION") return NextResponse.json({ error: "Invitation is invalid or expired" }, { status: 410 });
    return NextResponse.json({ error: "Could not accept invitation" }, { status: 500 });
  }
}
