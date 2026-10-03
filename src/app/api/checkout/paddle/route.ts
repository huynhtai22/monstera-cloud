import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createPaddleCheckoutUrl, isPaddleConfigured, paddleEnvironmentName } from "@/lib/paddle";
import { logger } from "@/lib/logger";
import { productionRouteDisabled } from "@/lib/request-auth";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";

/**
 * POST /api/checkout/paddle
 * Body: { plan: "starter" | "professional", billingCycle?: "monthly" | "annual" }
 * Returns: { url } — Paddle Checkout (hosted) URL
 *
 * @see https://developer.paddle.com/api-reference/transactions/create-transaction
 */
export async function POST(req: Request) {
  if (productionRouteDisabled("ENABLE_PADDLE_BILLING")) {
    return NextResponse.json({ error: "Pilot billing is operator-managed" }, { status: 404 });
  }
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
    workspaceId?: string;
    invoiceCurrency?: string;
    currency?: string;
  };

  const plan = body.plan;
  const workspaceId = body.workspaceId?.trim();
  const billingCycle = body.billingCycle === "annual" ? "annual" : "monthly";
  const invoiceCurrency = (body.invoiceCurrency || body.currency || "USD").toUpperCase();
  if (invoiceCurrency === "VND") {
    return NextResponse.json(
      { error: "Paddle is USD-only. VND uses PayOS/VietQR." },
      { status: 400 },
    );
  }

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  if (plan !== "starter" && plan !== "professional") {
    return NextResponse.json(
      { error: "Invalid plan. Must be 'starter' or 'professional'." },
      { status: 400 }
    );
  }

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "admin",
      operation: "create_paddle_checkout",
    });
    const { url, transactionId } = await createPaddleCheckoutUrl(
      plan,
      billingCycle,
      workspaceId,
      session.user.id,
      "USD",
    );
    return NextResponse.json({
      url,
      transactionId,
      paddleEnvironment: paddleEnvironmentName(),
    });
  } catch (err: unknown) {
    const rbac = toRbacResponse(err);
    if (rbac) return rbac;
    const message = err instanceof Error ? err.message : "Failed to create Paddle checkout";
    logger.error("[PADDLE_CHECKOUT]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
