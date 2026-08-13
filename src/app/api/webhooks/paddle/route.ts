import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  applyPaddlePlanToWorkspace,
  initiatingUserIdFromPaddleCustomData,
  planForPriceId,
  priceIdFromTransactionItems,
  workspaceIdFromPaddleCustomData,
  verifyPaddleWebhookSignature,
} from "@/lib/paddle";
import { sendPaymentPastDueEmail } from "@/lib/mail";
import { logger } from "@/lib/logger";
import { productionRouteDisabled } from "@/lib/request-auth";

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
  if (productionRouteDisabled("ENABLE_PADDLE_BILLING")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
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
  const workspaceId = workspaceIdFromPaddleCustomData(data.custom_data);
  const priceId = firstPriceIdFromTransactionData(data);
  const plan = planForPriceId(priceId);
  const subscriptionId =
    typeof data.subscription_id === "string" ? data.subscription_id : null;

  if (!workspaceId || !plan) {
    logger.warn("[PADDLE_WEBHOOK] transaction event missing workspace_id or unknown price", {
      workspaceId,
      priceId,
    });
    return;
  }

  await applyPaddlePlanToWorkspace(workspaceId, priceId, subscriptionId);
  logger.info(`[PADDLE_WEBHOOK] Workspace ${workspaceId} → ${plan} (transaction)`);
}

async function handleSubscriptionUpsert(data: Record<string, unknown>) {
  const workspaceId = workspaceIdFromPaddleCustomData(data.custom_data);
  const priceId = firstPriceIdFromSubscriptionData(data);
  const plan = planForPriceId(priceId);
  const subscriptionId = typeof data.id === "string" ? data.id : null;

  if (!plan) {
    logger.warn("[PADDLE_WEBHOOK] subscription event — unknown price id", { priceId });
    return;
  }

  if (workspaceId) {
    await applyPaddlePlanToWorkspace(workspaceId, priceId, subscriptionId);
    logger.info(`[PADDLE_WEBHOOK] Workspace ${workspaceId} → ${plan} (subscription)`);
    return;
  }

  if (subscriptionId) {
    await prisma.workspace.updateMany({
      where: { subscriptionId },
      data: {
        plan,
        subscriptionProvider: "paddle",
      },
    });
    logger.info(`[PADDLE_WEBHOOK] subscription ${subscriptionId} → ${plan} (workspace by subscription id)`);
  }
}

async function handleSubscriptionCanceled(data: Record<string, unknown>) {
  const subscriptionId = typeof data.id === "string" ? data.id : "";
  const workspaceId = workspaceIdFromPaddleCustomData(data.custom_data);

  if (workspaceId) {
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { plan: "free", subscriptionId: null, subscriptionProvider: null },
    });
    logger.info(`[PADDLE_WEBHOOK] Workspace ${workspaceId} downgraded (subscription canceled)`);
    return;
  }

  if (subscriptionId) {
    await prisma.workspace.updateMany({
      where: { subscriptionId },
      data: { plan: "free", subscriptionId: null, subscriptionProvider: null },
    });
    logger.info(`[PADDLE_WEBHOOK] subscription ${subscriptionId} canceled — workspaces downgraded`);
  }
}

async function handleSubscriptionPastDue(data: Record<string, unknown>) {
  const subscriptionId = typeof data.id === "string" ? data.id : "";
  const workspaceId = workspaceIdFromPaddleCustomData(data.custom_data);
  const initiatingUserId = initiatingUserIdFromPaddleCustomData(data.custom_data);

  let user: { email: string | null; name: string | null } | null = null;

  if (workspaceId) {
    user = await prisma.user.findFirst({
      where: {
        OR: [
          { id: initiatingUserId },
          { workspaces: { some: { workspaceId, role: "owner" } } },
        ],
      },
      select: { email: true, name: true },
    });
  } else if (subscriptionId) {
    const workspace = await prisma.workspace.findUnique({
      where: { subscriptionId },
      select: { ownerId: true },
    });
    user = workspace ? await prisma.user.findUnique({
      where: { id: workspace.ownerId },
      select: { email: true, name: true },
    }) : null;
  }

  if (!user || !user.email) {
    logger.warn("[PADDLE_WEBHOOK] subscription.past_due — could not find user", {
      subscriptionId,
      workspaceId,
    });
    return;
  }
  await sendPaymentPastDueEmail(user.email, user.name ?? "");
  logger.info(`[PADDLE_WEBHOOK] subscription.past_due — past-due email sent to ${user.email}`);
}
