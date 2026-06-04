import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  applyPaddlePlanToUser,
  planForPriceId,
  priceIdFromTransactionItems,
  userIdFromPaddleCustomData,
  verifyPaddleWebhookSignature,
} from "@/lib/paddle";
import { sendPaymentPastDueEmail } from "@/lib/mail";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * POST /api/webhooks/paddle
 *
 * Paddle Billing notification destination (webhook). Verifies `Paddle-Signature`, then provisions
 * plans from transaction and subscription events.
 *
 * Configure in Paddle: Developer Tools → Notifications → URL → `https://<domain>/api/webhooks/paddle`
 * Subscribe to at least: transaction.completed, subscription.updated, subscription.canceled (and optionally subscription.created, subscription.activated).
 *
 * @see https://developer.paddle.com/webhooks/overview
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature =
    req.headers.get("paddle-signature") ?? req.headers.get("Paddle-Signature") ?? "";

  if (!verifyPaddleWebhookSignature(rawBody, signature)) {
    logger.warn("[PADDLE_WEBHOOK] Invalid signature — rejected");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: {
    event_type?: string;
    data?: Record<string, unknown>;
  };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = payload.event_type ?? "";
  const data = payload.data ?? {};

  try {
    switch (eventType) {
      case "transaction.completed":
      case "transaction.paid": {
        await handleTransactionLike(data);
        break;
      }
      case "subscription.created":
      case "subscription.activated":
      case "subscription.updated":
      case "subscription.resumed": {
        await handleSubscriptionUpsert(data);
        break;
      }
      case "subscription.canceled": {
        await handleSubscriptionCanceled(data);
        break;
      }
      case "subscription.past_due": {
        await handleSubscriptionPastDue(data);
        break;
      }
      default:
        break;
    }
  } catch (err: unknown) {
    logger.error("[PADDLE_WEBHOOK] Handler error:", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

function firstPriceIdFromTransactionData(data: Record<string, unknown>): string | undefined {
  return priceIdFromTransactionItems(data.items);
}

function firstPriceIdFromSubscriptionData(data: Record<string, unknown>): string | undefined {
  return priceIdFromTransactionItems(data.items);
}

async function handleTransactionLike(data: Record<string, unknown>) {
  const userId = userIdFromPaddleCustomData(data.custom_data);
  const priceId = firstPriceIdFromTransactionData(data);
  const plan = planForPriceId(priceId);
  const subscriptionId =
    typeof data.subscription_id === "string" ? data.subscription_id : null;

  if (!userId || !plan) {
    logger.warn("[PADDLE_WEBHOOK] transaction event missing user_id or unknown price", {
      userId,
      priceId,
    });
    return;
  }

  await applyPaddlePlanToUser(userId, priceId, subscriptionId);
  logger.info(`[PADDLE_WEBHOOK] User ${userId} → ${plan} (transaction)`);
}

async function handleSubscriptionUpsert(data: Record<string, unknown>) {
  const userId = userIdFromPaddleCustomData(data.custom_data);
  const priceId = firstPriceIdFromSubscriptionData(data);
  const plan = planForPriceId(priceId);
  const subscriptionId = typeof data.id === "string" ? data.id : null;

  if (!plan) {
    logger.warn("[PADDLE_WEBHOOK] subscription event — unknown price id", { priceId });
    return;
  }

  if (userId) {
    await applyPaddlePlanToUser(userId, priceId, subscriptionId);
    logger.info(`[PADDLE_WEBHOOK] User ${userId} → ${plan} (subscription)`);
    return;
  }

  if (subscriptionId) {
    await prisma.user.updateMany({
      where: { subscriptionId },
      data: {
        plan,
      },
    });
    logger.info(`[PADDLE_WEBHOOK] subscription ${subscriptionId} → ${plan} (by subscription id)`);
  }
}

async function handleSubscriptionCanceled(data: Record<string, unknown>) {
  const subscriptionId = typeof data.id === "string" ? data.id : "";
  const userId = userIdFromPaddleCustomData(data.custom_data);

  if (userId) {
    await prisma.user.update({
      where: { id: userId },
      data: { plan: "free", subscriptionId: null },
    });
    logger.info(`[PADDLE_WEBHOOK] User ${userId} downgraded (subscription canceled)`);
    return;
  }

  if (subscriptionId) {
    await prisma.user.updateMany({
      where: { subscriptionId },
      data: { plan: "free", subscriptionId: null },
    });
    logger.info(`[PADDLE_WEBHOOK] subscription ${subscriptionId} canceled — users downgraded`);
  }
}

async function handleSubscriptionPastDue(data: Record<string, unknown>) {
  const subscriptionId = typeof data.id === "string" ? data.id : "";
  const userId = userIdFromPaddleCustomData(data.custom_data);

  let user: { email: string | null; name: string | null } | null = null;

  if (userId) {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
  } else if (subscriptionId) {
    user = await prisma.user.findFirst({
      where: { subscriptionId },
      select: { email: true, name: true },
    });
  }

  if (!user || !user.email) {
    logger.warn("[PADDLE_WEBHOOK] subscription.past_due — could not find user", {
      subscriptionId,
      userId,
    });
    return;
  }
  await sendPaymentPastDueEmail(user.email, user.name ?? "");
  logger.info(`[PADDLE_WEBHOOK] subscription.past_due — past-due email sent to ${user.email}`);
}
