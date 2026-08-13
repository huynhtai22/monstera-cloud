import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  confirmPaddleTransactionForWorkspace,
  isPaddleConfigured,
} from "@/lib/paddle";
import { logger } from "@/lib/logger";
import { productionRouteDisabled } from "@/lib/request-auth";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";

/**
 * GET /api/checkout/paddle/confirm?transactionId=txn_...
 *
 * Fallback activation when Paddle webhooks are slow or misconfigured.
 * Verifies the transaction in Paddle and upgrades the selected workspace.
 */
export async function GET(req: Request) {
  if (productionRouteDisabled("ENABLE_PADDLE_BILLING")) {
    return NextResponse.json({ error: "Pilot billing is operator-managed" }, { status: 404 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isPaddleConfigured()) {
    return NextResponse.json({ error: "Paddle is not configured" }, { status: 503 });
  }

  const transactionId = new URL(req.url).searchParams.get("transactionId")?.trim();
  const workspaceId = new URL(req.url).searchParams.get("workspaceId")?.trim();
  if (!transactionId || !workspaceId) {
    return NextResponse.json({ error: "transactionId and workspaceId are required" }, { status: 400 });
  }

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "admin",
      operation: "confirm_paddle_checkout",
    });
    const { plan, status } = await confirmPaddleTransactionForWorkspace(
      transactionId,
      workspaceId,
      session.user.id
    );

    if (!plan) {
      return NextResponse.json(
        { plan: "free", status, pending: true },
        { status: 202 }
      );
    }

    return NextResponse.json({ plan, status, pending: false });
  } catch (err: unknown) {
    const rbac = toRbacResponse(err);
    if (rbac) return rbac;
    const message = err instanceof Error ? err.message : "Failed to confirm payment";
    logger.error("[PADDLE_CONFIRM]", err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
