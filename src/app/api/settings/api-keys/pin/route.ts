import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { pinHashForRequest } from "@/lib/api-key-security";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";

/**
 * POST /api/settings/api-keys/pin — P2 opt-in office-IP pin.
 * Body: `{ workspaceId, id, enabled: boolean }`. When enabled, the pin is
 * set to the caller's current network (salted hash); key use from any other
 * network is rejected with `API_KEY_IP_PINNED`. Only pin keys consumed from
 * a static office IP — never Looker scheduled-refresh keys (Google IPs).
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { workspaceId, id, enabled } = await request.json();
    if (!workspaceId || typeof id !== "string" || typeof enabled !== "boolean") {
      return NextResponse.json({ error: "workspaceId, id and enabled are required" }, { status: 400 });
    }

    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "admin",
      operation: "pin_api_key",
    });

    let allowedIpHash: string | null = null;
    if (enabled) {
      allowedIpHash = pinHashForRequest(request);
      if (!allowedIpHash) {
        return NextResponse.json(
          { error: "Could not determine your network address. Pin not set." },
          { status: 400 },
        );
      }
    }

    const updated = await prisma.apiKey.updateMany({
      where: { id, workspaceId, revokedAt: null },
      data: { allowedIpHash },
    });
    if (updated.count !== 1) return NextResponse.json({ error: "API key not found" }, { status: 404 });

    await prisma.auditEvent.create({
      data: {
        workspaceId,
        actorUserId: session.user.id,
        action: enabled ? "api_key.pinned" : "api_key.unpinned",
        resource: "api_key",
        resourceId: id,
      },
    });

    return NextResponse.json({ success: true, ipPinned: enabled });
  } catch (error) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    logger.error("Error pinning API key:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
