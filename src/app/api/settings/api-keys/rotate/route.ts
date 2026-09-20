import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { generateApiKey } from "@/lib/api-key-security";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { assertCanCreateApiKey, toPlanLimitResponse } from "@/lib/plan-entitlements";

/**
 * POST /api/settings/api-keys/rotate — P2 key rotation.
 * Body: `{ workspaceId, id }`. Creates a replacement key and revokes the
 * old one atomically. The old secret stops working immediately, so callers
 * should update Looker/Sheets configs right away. Returns the new secret
 * once (never stored in plain text).
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { workspaceId, id } = await request.json();
    if (!workspaceId || typeof id !== "string") {
      return NextResponse.json({ error: "Missing workspaceId or id" }, { status: 400 });
    }

    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "admin",
      operation: "rotate_api_key",
    });
    // Rotation is net-zero on key count: exclude the key being replaced so
    // workspaces already at cap can still rotate.
    await assertCanCreateApiKey(workspaceId, { excludingKeyId: id });

    const existing = await prisma.apiKey.findFirst({
      where: { id, workspaceId, revokedAt: null },
      select: { id: true, name: true },
    });
    if (!existing) return NextResponse.json({ error: "API key not found" }, { status: 404 });

    const generated = generateApiKey();
    const rotated = await prisma.$transaction(async (tx) => {
      const created = await tx.apiKey.create({
        data: {
          keyHash: generated.keyHash,
          keyPrefix: generated.keyPrefix,
          keyLastFour: generated.keyLastFour,
          name: existing.name,
          workspaceId,
          createdByUserId: session.user.id,
        },
      });
      await tx.apiKey.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      });
      return created;
    });

    await prisma.auditEvent.create({
      data: {
        workspaceId,
        actorUserId: session.user.id,
        action: "api_key.rotated",
        resource: "api_key",
        resourceId: rotated.id,
        metadata: { fromKeyId: existing.id },
      },
    });

    return NextResponse.json(
      {
        id: rotated.id,
        name: rotated.name,
        workspaceId: rotated.workspaceId,
        createdAt: rotated.createdAt,
        key: generated.secret,
      },
      { status: 201 },
    );
  } catch (error) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    const planLimit = toPlanLimitResponse(error);
    if (planLimit) return planLimit;
    logger.error("Error rotating API key:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
