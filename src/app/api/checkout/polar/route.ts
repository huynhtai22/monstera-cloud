import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isPolarCheckoutConfigured, polarServer, type PolarBillingCycle } from "@/lib/polar-billing";
import { preparePolarCheckout } from "@/lib/polar-checkout";
import { logger } from "@/lib/logger";
import { productionRouteDisabled } from "@/lib/request-auth";
import { PaymentWorkspaceError, requireSelfServeAgencyPro } from "@/lib/payment-workspace";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";

/** Create a Polar hosted checkout for international Agency Pro subscriptions. */
export async function POST(req: Request) {
  if (productionRouteDisabled("ENABLE_POLAR_BILLING")) {
    return NextResponse.json({ error: "International checkout is not enabled" }, { status: 404 });
  }
  if (process.env.NODE_ENV === "production" && polarServer() !== "production") {
    return NextResponse.json({ error: "Polar production environment is not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isPolarCheckoutConfigured()) {
    return NextResponse.json({ error: "Polar checkout is not configured" }, { status: 503 });
  }

  let body: { workspaceId?: string; billingCycle?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  if (body.billingCycle !== undefined && body.billingCycle !== "annual" && body.billingCycle !== "monthly") return NextResponse.json({ error: "Invalid billing cycle" }, { status: 400 });
  const billingCycle: PolarBillingCycle = body.billingCycle === "annual" ? "annual" : "monthly";
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "owner",
      operation: "create_polar_checkout",
    });
    await requireSelfServeAgencyPro(workspaceId);
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { subscriptionProvider: true },
    });
    if (workspace?.subscriptionProvider && workspace.subscriptionProvider !== "polar") {
      return NextResponse.json({ error: "This workspace has an existing billing provider. Contact sales to change providers." }, { status: 409 });
    }
    const checkout = await preparePolarCheckout({ workspaceId, userId: session.user.id, email: session.user.email, cycle: billingCycle });
    return NextResponse.json({ url: checkout.url, checkoutId: checkout.id, polarServer: process.env.POLAR_SERVER?.trim() || "sandbox" });
  } catch (err: unknown) {
    const rbac = toRbacResponse(err);
    if (rbac) return rbac;
    if (err instanceof PaymentWorkspaceError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    logger.error("[POLAR_CHECKOUT] Checkout unavailable; operator review may be required");
    return NextResponse.json({ error: "Failed to create Polar checkout" }, { status: 500 });
  }
}
