/**
 * Paddle Billing (Merchant of Record) — checkout + webhooks.
 * Docs: https://developer.paddle.com/webhooks/overview
 */

import crypto from "crypto";
import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import prisma from "@/lib/prisma";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export type PaddlePlan = "starter" | "professional";
export type PaddleBillingCycle = "monthly" | "annual";

function apiKey(): string {
  return (process.env.PADDLE_API_KEY || "").trim();
}

function webhookSecret(): string {
  return (process.env.PADDLE_WEBHOOK_SECRET || "").trim();
}

export function isPaddleConfigured(): boolean {
  if (!apiKey()) return false;
  const ids = [
    process.env.PADDLE_PRICE_STARTER_MONTHLY,
    process.env.PADDLE_PRICE_STARTER_ANNUAL,
    process.env.PADDLE_PRICE_PROFESSIONAL_MONTHLY,
    process.env.PADDLE_PRICE_PROFESSIONAL_ANNUAL,
  ].map((s) => (s || "").trim());
  return ids.every(Boolean);
}

function paddleEnvironment(): Environment {
  const env = (process.env.PADDLE_ENVIRONMENT || "").toLowerCase();
  if (env === "production") return Environment.production;
  if (env === "sandbox") return Environment.sandbox;
  // Vercel Production deployment → live Paddle API (real catalog + charges).
  // Preview / local default to sandbox so test keys don’t hit production by accident.
  if (process.env.VERCEL_ENV === "production") return Environment.production;
  return Environment.sandbox;
}

export function getPaddleClient(): Paddle {
  const key = apiKey();
  if (!key) {
    throw new Error("PADDLE_API_KEY is not set.");
  }
  return new Paddle(key, { environment: paddleEnvironment() });
}

export function paddleEnvironmentName(): "sandbox" | "production" {
  return paddleEnvironment() === Environment.production ? "production" : "sandbox";
}

/** Map internal plan + billing cycle → Paddle catalog `pri_` price ID (set in Paddle dashboard). */
export function priceIdForPlan(
  plan: PaddlePlan,
  billingCycle: PaddleBillingCycle
): string {
  const monthly = billingCycle === "monthly";
  if (plan === "starter") {
    return monthly
      ? (process.env.PADDLE_PRICE_STARTER_MONTHLY || "").trim()
      : (process.env.PADDLE_PRICE_STARTER_ANNUAL || "").trim();
  }
  return monthly
    ? (process.env.PADDLE_PRICE_PROFESSIONAL_MONTHLY || "").trim()
    : (process.env.PADDLE_PRICE_PROFESSIONAL_ANNUAL || "").trim();
}

/** Reverse-map a Paddle price ID to our plan name. */
export function planForPriceId(priceId: string | undefined | null): PaddlePlan | null {
  if (!priceId) return null;
  const id = priceId.trim();
  const pairs: [string, PaddlePlan][] = [
    [(process.env.PADDLE_PRICE_STARTER_MONTHLY || "").trim(), "starter"],
    [(process.env.PADDLE_PRICE_STARTER_ANNUAL || "").trim(), "starter"],
    [(process.env.PADDLE_PRICE_PROFESSIONAL_MONTHLY || "").trim(), "professional"],
    [(process.env.PADDLE_PRICE_PROFESSIONAL_ANNUAL || "").trim(), "professional"],
  ];
  for (const [envId, plan] of pairs) {
    if (envId && envId === id) return plan;
  }
  return null;
}

/**
 * Create a draft transaction and return Paddle Checkout URL (`checkout.url`).
 * Embeds both tenant and initiating user in `custom_data` for webhook provisioning.
 */
export async function createPaddleCheckoutUrl(
  plan: PaddlePlan,
  billingCycle: PaddleBillingCycle,
  workspaceId: string,
  userId: string
): Promise<{ url: string; transactionId: string }> {
  const priceId = priceIdForPlan(plan, billingCycle);
  if (!priceId) {
    throw new Error(
      "Paddle is not fully configured: set PADDLE_PRICE_* env vars for this plan and billing cycle."
    );
  }

  const paddle = getPaddleClient();
  const tx = await paddle.transactions.create({
    items: [{ priceId, quantity: 1 }],
    collectionMode: "automatic",
    customData: { workspace_id: workspaceId, initiated_by_user_id: userId },
    checkout: {
      url: `${PRODUCT_SITE_URL}/success`,
    },
  });

  const url = tx.checkout?.url;
  if (!url) {
    throw new Error("Paddle did not return a checkout URL. Check default payment link / approved domains in Paddle.");
  }
  return { url, transactionId: tx.id };
}

/**
 * Verify `Paddle-Signature` per https://developer.paddle.com/webhooks/signature-verification
 * Uses HMAC-SHA256 over `{ts}:{rawBody}`.
 *
 * Timestamp tolerance is relaxed (10 minutes) so serverless cold starts are less likely to reject
 * legitimate deliveries; signature verification remains the primary authenticity check.
 */
export function verifyPaddleWebhookSignature(
  rawBody: string,
  paddleSignatureHeader: string | null | undefined
): boolean {
  const secret = webhookSecret();
  if (!secret || !paddleSignatureHeader) return false;

  try {
    let ts = "";
    let h1 = "";
    for (const part of paddleSignatureHeader.split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key === "ts") ts = value;
      else if (key === "h1") h1 = value;
    }
    if (!ts || !h1) return false;

    const tsNum = parseInt(ts, 10);
    if (Number.isNaN(tsNum)) return false;
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - tsNum) > 600) return false;

    const signedPayload = `${ts}:${rawBody}`;
    const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");

    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(h1, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function paddleCustomData(customData: unknown): Record<string, unknown> | undefined {
  if (customData == null) return undefined;

  let parsed: unknown = customData;
  if (typeof customData === "string") {
    try {
      parsed = JSON.parse(customData) as unknown;
    } catch {
      return undefined;
    }
  }

  return typeof parsed === "object" && parsed !== null
    ? parsed as Record<string, unknown>
    : undefined;
}

export function workspaceIdFromPaddleCustomData(customData: unknown): string | undefined {
  const value = paddleCustomData(customData)?.workspace_id;
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function initiatingUserIdFromPaddleCustomData(customData: unknown): string | undefined {
  const value = paddleCustomData(customData)?.initiated_by_user_id;
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function priceIdFromTransactionItems(items: unknown): string | undefined {
  if (!Array.isArray(items) || items.length === 0) return undefined;
  const first = items[0] as Record<string, unknown>;
  if (typeof first.price_id === "string") return first.price_id;
  const price = first.price as Record<string, unknown> | undefined;
  if (price && typeof price.id === "string") return price.id;
  return undefined;
}

const PAID_TRANSACTION_STATUSES = new Set(["completed", "paid", "billed"]);

/** Apply catalog price → internal plan after verified Paddle payment. */
export async function applyPaddlePlanToWorkspace(
  workspaceId: string,
  priceId: string | undefined,
  subscriptionId?: string | null
): Promise<PaddlePlan | null> {
  const plan = planForPriceId(priceId);
  if (!plan) return null;

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      plan,
      subscriptionProvider: "paddle",
      subscriptionId: subscriptionId ?? undefined,
    },
  });
  return plan;
}

/**
 * Fallback when webhooks are delayed or misconfigured: verify transaction in Paddle
 * and upgrade the explicitly selected workspace when payment is complete.
 */
export async function confirmPaddleTransactionForWorkspace(
  transactionId: string,
  expectedWorkspaceId: string,
  expectedUserId: string
): Promise<{ plan: PaddlePlan | null; status: string }> {
  const paddle = getPaddleClient();
  const tx = await paddle.transactions.get(transactionId);
  const status = String(tx.status ?? "");

  if (!PAID_TRANSACTION_STATUSES.has(status)) {
    return { plan: null, status };
  }

  const workspaceId = workspaceIdFromPaddleCustomData(tx.customData);
  const userId = initiatingUserIdFromPaddleCustomData(tx.customData);
  if (workspaceId !== expectedWorkspaceId || userId !== expectedUserId) {
    throw new Error("Transaction does not belong to this workspace and account.");
  }

  const priceId = tx.items?.[0]?.price?.id ?? priceIdFromTransactionItems(tx.items);
  const plan = await applyPaddlePlanToWorkspace(workspaceId, priceId, tx.subscriptionId);
  return { plan, status };
}
