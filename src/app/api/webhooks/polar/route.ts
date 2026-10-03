import { NextRequest } from "next/server";
import { Webhooks } from "@polar-sh/nextjs";
import { logger } from "@/lib/logger";
import { productionRouteDisabled } from "@/lib/request-auth";
import { polarServer, reconcilePolarSubscriptionEvent } from "@/lib/polar-billing";

export const runtime = "nodejs";

const webhookSecret = process.env.POLAR_WEBHOOK_SECRET?.trim();

const handleWebhook = webhookSecret
  ? Webhooks({
      webhookSecret,
      onPayload: async (payload) => {
        if (payload.type === "subscription.active" || payload.type === "subscription.updated" ||
            payload.type === "subscription.canceled" || payload.type === "subscription.uncanceled" ||
            payload.type === "subscription.revoked" || payload.type === "subscription.past_due") {
          await reconcilePolarSubscriptionEvent({ type: payload.type, data: payload.data });
        }
      },
    })
  : async () => {
      logger.error("[POLAR_WEBHOOK] POLAR_WEBHOOK_SECRET is not configured");
      return Response.json({ error: "Webhook is not configured" }, { status: 503 });
    };

export async function POST(request: NextRequest) {
  if (productionRouteDisabled("ENABLE_POLAR_BILLING")) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (process.env.NODE_ENV === "production" && polarServer() !== "production") {
    return Response.json({ error: "Polar production environment is not configured" }, { status: 503 });
  }
  try {
    return await handleWebhook(request);
  } catch {
    // Provider SDK errors can carry response bodies. Retrying must not disclose them.
    logger.error("[POLAR_WEBHOOK] Reconciliation failed; retry required");
    return Response.json({ error: "Reconciliation unavailable" }, { status: 503 });
  }
}
