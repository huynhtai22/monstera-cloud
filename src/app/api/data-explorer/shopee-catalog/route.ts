import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";

/** Warehouse-only Shopee catalog view; it never calls Shopee or exposes credentials. */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")?.trim();
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  try {
    await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "viewer", operation: "view_shopee_catalog" });
  } catch (error) {
    const response = toRbacResponse(error);
    if (response) return response;
    throw error;
  }

  const [campaigns, products, lastRun] = await Promise.all([
    (prisma as any).shopeeCampaign.findMany({
      where: { workspaceId },
      orderBy: [{ syncedAt: "desc" }, { externalCampaignId: "asc" }],
      take: 100,
    }),
    (prisma as any).shopeeProduct.findMany({
      where: { workspaceId },
      orderBy: [{ syncedAt: "desc" }, { externalItemId: "asc" }],
      take: 100,
    }),
    (prisma as any).providerSyncRun.findFirst({
      where: { workspaceId, provider: "shopee" },
      orderBy: { startedAt: "desc" },
      select: { status: true, endpoint: true, startedAt: true, rowsReceived: true, rowsWritten: true, environment: true },
    }),
  ]);
  return NextResponse.json({ campaigns, products, lastRun });
}
