import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  confirmPaddleTransactionForUser,
  isPaddleConfigured,
} from "@/lib/paddle";
import { logger } from "@/lib/logger";

/**
 * GET /api/checkout/paddle/confirm?transactionId=txn_...
 *
 * Fallback activation when Paddle webhooks are slow or misconfigured.
 * Verifies the transaction in Paddle and upgrades the logged-in user.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isPaddleConfigured()) {
    return NextResponse.json({ error: "Paddle is not configured" }, { status: 503 });
  }

  const transactionId = new URL(req.url).searchParams.get("transactionId")?.trim();
  if (!transactionId) {
    return NextResponse.json({ error: "Missing transactionId" }, { status: 400 });
  }

  try {
    const { plan, status } = await confirmPaddleTransactionForUser(
      transactionId,
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
    const message = err instanceof Error ? err.message : "Failed to confirm payment";
    logger.error("[PADDLE_CONFIRM]", err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
