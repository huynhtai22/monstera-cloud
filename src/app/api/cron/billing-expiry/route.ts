import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireCronSecret } from "@/lib/request-auth";

/** Downgrade dated domestic-transfer terms and seven-day free trials. Legacy PayOS workspaces are excluded. */
export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const result = await prisma.workspace.updateMany({
    where: {
      subscriptionEndsAt: { lte: new Date() },
      plan: { not: "free" },
      OR: [
        { subscriptionProvider: "vietqr_domestic" },
        { status: "PILOT" },
      ],
    },
    data: {
      plan: "free",
      status: "ACTIVE",
      subscriptionProvider: null,
      subscriptionId: null,
      subscriptionEndsAt: null,
    },
  });

  return NextResponse.json({ expiredWorkspaces: result.count, ranAt: new Date().toISOString() });
}
