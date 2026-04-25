import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createCheckoutUrl } from "@/lib/lemonsqueezy";
import { logger } from "@/lib/logger";

/**
 * POST /api/checkout/lemonsqueezy
 * Body: { plan: "starter" | "professional" }
 * Returns: { url } — the hosted LemonSqueezy checkout page URL
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { plan } = (await req.json()) as { plan?: string };

  if (plan !== "starter" && plan !== "professional") {
    return NextResponse.json(
      { error: "Invalid plan. Must be 'starter' or 'professional'." },
      { status: 400 }
    );
  }

  try {
    const url = await createCheckoutUrl(
      plan,
      session.user.email,
      session.user.id
    );
    return NextResponse.json({ url });
  } catch (err: any) {
    logger.error("[LEMONSQUEEZY_CHECKOUT]", err);
    return NextResponse.json(
      { error: err.message || "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
