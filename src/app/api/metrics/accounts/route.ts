import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * Distinct workspace ad accounts stored in CampaignMetric (for explorer filters).
 * GET ?workspaceId=
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = new URL(req.url).searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: session.user.id },
  });
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const grouped = await prisma.campaignMetric.groupBy({
      by: ["accountId", "platform"],
      where: { workspaceId },
      _max: { accountName: true },
      orderBy: [{ accountId: "asc" }, { platform: "asc" }],
    });

    const accounts = grouped.map((g) => ({
      accountId: g.accountId,
      platform: g.platform,
      accountName: g._max.accountName ?? "",
    }));

    return NextResponse.json({ accounts });
  } catch (e) {
    console.error("[metrics/accounts]", e);
    return NextResponse.json({ error: "Failed to load accounts" }, { status: 500 });
  }
}
