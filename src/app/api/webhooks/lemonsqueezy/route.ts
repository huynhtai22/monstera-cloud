import { NextResponse } from "next/server";
import { verifyWebhookSignature, planForVariantId } from "@/lib/lemonsqueezy";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * POST /api/webhooks/lemonsqueezy
 *
 * Receives signed webhook events from LemonSqueezy and updates the
 * user's plan in the database accordingly.
 *
 * Events handled:
 *   subscription_created  → upgrade user plan
 *   subscription_updated  → sync plan changes
 *   subscription_resumed  → restore cancelled plan
 *   subscription_cancelled / subscription_expired → downgrade to free
 *   subscription_payment_failed → log warning (grace period handled by LemonSqueezy)
 *   order_created → one-time purchase fallback
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-signature") ?? "";

  if (!verifyWebhookSignature(rawBody, signature)) {
    logger.warn("[LS_WEBHOOK] Invalid signature — request rejected");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventName: string = payload?.meta?.event_name ?? "";
  const data = payload?.data ?? {};
  const attributes = data?.attributes ?? {};

  // Extract the user_id we embedded during checkout creation
  const userId: string | undefined =
    payload?.meta?.custom_data?.user_id ??
    attributes?.first_order_item?.meta?.custom_data?.user_id;

  // Extract subscription/order identifiers
  const subscriptionId: string = data?.id ?? "";
  const variantId: string = String(
    attributes?.variant_id ?? attributes?.first_order_item?.variant_id ?? ""
  );

  logger.info("[LS_WEBHOOK]", eventName, { userId, subscriptionId, variantId });

  try {
    switch (eventName) {
      case "subscription_created":
      case "subscription_updated":
      case "subscription_resumed": {
        if (!userId) break;
        const plan = planForVariantId(variantId);
        if (!plan) {
          logger.warn("[LS_WEBHOOK] Unknown variant ID:", variantId);
          break;
        }
        await prisma.user.update({
          where: { id: userId },
          data: { plan, subscriptionId },
        });
        logger.info(`[LS_WEBHOOK] User ${userId} upgraded to ${plan}`);
        break;
      }

      case "subscription_cancelled":
      case "subscription_expired": {
        // Downgrade to free — find user by subscriptionId if userId is missing
        if (userId) {
          await prisma.user.update({
            where: { id: userId },
            data: { plan: "free", subscriptionId: null },
          });
        } else if (subscriptionId) {
          await prisma.user.updateMany({
            where: { subscriptionId },
            data: { plan: "free", subscriptionId: null },
          });
        }
        logger.info(`[LS_WEBHOOK] Subscription ${subscriptionId} cancelled — user downgraded to free`);
        break;
      }

      case "subscription_payment_failed": {
        // LemonSqueezy handles the dunning/grace period automatically.
        // Log it here so you can monitor in Vercel logs.
        logger.warn(`[LS_WEBHOOK] Payment failed for subscription ${subscriptionId} (user: ${userId})`);
        break;
      }

      case "order_created": {
        // Fallback for one-time orders (not subscriptions)
        if (!userId) break;
        const plan = planForVariantId(variantId);
        if (plan) {
          await prisma.user.update({
            where: { id: userId },
            data: { plan },
          });
          logger.info(`[LS_WEBHOOK] One-time order: user ${userId} → ${plan}`);
        }
        break;
      }

      default:
        // Unhandled event — return 200 so LemonSqueezy doesn't retry
        break;
    }
  } catch (err: any) {
    logger.error("[LS_WEBHOOK] DB update failed:", err);
    return NextResponse.json({ error: "DB update failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
