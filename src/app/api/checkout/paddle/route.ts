import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createPaddleCheckoutUrl, isPaddleConfigured, paddleEnvironmentName } from "@/lib/paddle";
import { logger } from "@/lib/logger";

/**
 * POST /api/checkout/paddle
 * Body: { plan: "starter" | "professional", billingCycle?: "monthly" | "annual" }
 * Returns: { url } — Paddle Checkout (hosted) URL
 *
 * @see https://developer.paddle.com/api-reference/transactions/create-transaction
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isPaddleConfigured()) {
    return NextResponse.json(
      { error: "Paddle checkout is not configured. Set PADDLE_API_KEY and PADDLE_PRICE_* price IDs." },
      { status: 503 }
    );
  }

  const body = (await req.json()) as {
    plan?: string;
    billingCycle?: string;
  };

  const plan = body.plan;
  const billingCycle = body.billingCycle === "annual" ? "annual" : "monthly";

  if (plan !== "starter" && plan !== "professional") {
    return NextResponse.json(
      { error: "Invalid plan. Must be 'starter' or 'professional'." },
      { status: 400 }
    );
  }

  try {
    const { url, transactionId } = await createPaddleCheckoutUrl(plan, billingCycle, session.user.id);
    return NextResponse.json({
      url,
      transactionId,
      paddleEnvironment: paddleEnvironmentName(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create Paddle checkout";
    logger.error("[PADDLE_CHECKOUT]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
