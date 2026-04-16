/**
 * LemonSqueezy integration — Merchant of Record payment gateway.
 * Portal: https://app.lemonsqueezy.com
 * Docs:   https://docs.lemonsqueezy.com/api
 */

import crypto from "crypto";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

function apiKey(): string {
  return (process.env.LEMONSQUEEZY_API_KEY || "").trim();
}

/**
 * Fetch the store ID from the LemonSqueezy API.
 * Falls back to the LEMONSQUEEZY_STORE_ID env var if set.
 * Auto-discovery avoids test/live mode store ID mismatches.
 */
async function resolveStoreId(): Promise<string> {
  const envId = (process.env.LEMONSQUEEZY_STORE_ID || "").trim();

  // Always verify against the API — env var may be stale or from wrong mode
  try {
    const res = await fetch("https://api.lemonsqueezy.com/v1/stores", {
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        Accept: "application/vnd.api+json",
      },
    });
    const json = await res.json();
    const firstStore = json?.data?.[0];
    if (firstStore?.id) return String(firstStore.id);
  } catch {
    // Network failure — fall back to env var
  }

  if (envId) return envId;
  throw new Error("Could not resolve LemonSqueezy Store ID. Check your API key.");
}

export function webhookSecret(): string {
  return (process.env.LEMONSQUEEZY_WEBHOOK_SECRET || "").trim();
}

/** Map plan names to LemonSqueezy Variant IDs */
export function variantIdForPlan(plan: "starter" | "professional"): string {
  if (plan === "starter") {
    return (process.env.LEMONSQUEEZY_STARTER_VARIANT_ID || "").trim();
  }
  return (process.env.LEMONSQUEEZY_PRO_VARIANT_ID || "").trim();
}

/** Map a LemonSqueezy Variant ID back to an internal plan name */
export function planForVariantId(variantId: string | number): "starter" | "professional" | null {
  const id = String(variantId);
  if (id === (process.env.LEMONSQUEEZY_STARTER_VARIANT_ID || "").trim()) return "starter";
  if (id === (process.env.LEMONSQUEEZY_PRO_VARIANT_ID || "").trim()) return "professional";
  return null;
}

/**
 * Create a hosted LemonSqueezy checkout URL.
 * Embeds userId in custom_data so the webhook can upgrade the correct user.
 */
export async function createCheckoutUrl(
  plan: "starter" | "professional",
  userEmail: string,
  userId: string
): Promise<string> {
  const key = apiKey();
  const variant = variantIdForPlan(plan);

  if (!key || !variant) {
    throw new Error(
      "LemonSqueezy is not fully configured. Check LEMONSQUEEZY_API_KEY and variant ID env vars."
    );
  }

  // Auto-resolve store ID from the API to avoid test/live mode mismatches
  const store = await resolveStoreId();

  const res = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
    },
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email: userEmail,
            custom: { user_id: userId },
          },
          product_options: {
            redirect_url: `${PRODUCT_SITE_URL}/sources`,
          },
        },
        relationships: {
          store: { data: { type: "stores", id: store } },
          variant: { data: { type: "variants", id: variant } },
        },
      },
    }),
  });

  const json = await res.json();

  if (!res.ok) {
    const detail = JSON.stringify(json.errors ?? json);
    throw new Error(`LemonSqueezy checkout error: ${detail}`);
  }

  const url = json?.data?.attributes?.url;
  if (!url) throw new Error("LemonSqueezy returned no checkout URL");
  return url;
}

/**
 * Verify the X-Signature header sent by LemonSqueezy on every webhook request.
 * Uses HMAC-SHA256 with the webhook signing secret.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string
): boolean {
  const secret = webhookSecret();
  if (!secret) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(signature, "hex")
  );
}
