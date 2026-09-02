import crypto from "node:crypto";

const PAYOS_API_BASE = "https://api-merchant.payos.vn";

type PayOSConfig = {
  clientId: string;
  apiKey: string;
  checksumKey: string;
};

export type PayOSReadiness = {
  ready: boolean;
  missing: string[];
};

type PayOSApiResponse<T> = {
  code?: string;
  desc?: string;
  data?: T;
};

export type PayOSPaymentLink = {
  paymentLinkId: string;
  checkoutUrl: string;
  qrCode?: string;
  bin?: string;
  accountNumber?: string;
  accountName?: string;
};

function requiredConfig(): PayOSConfig {
  const clientId = process.env.PAYOS_CLIENT_ID?.trim();
  const apiKey = process.env.PAYOS_API_KEY?.trim();
  const checksumKey = process.env.PAYOS_CHECKSUM_KEY?.trim();
  if (!clientId || !apiKey || !checksumKey) {
    throw new Error("PayOS is not configured.");
  }
  return { clientId, apiKey, checksumKey };
}

/**
 * Deliberately exposes only configuration *names*, never secret values. This is
 * used to stop the checkout flow before a customer is sent to a payment link
 * that cannot be fulfilled by this deployment.
 */
export function getPayOSReadiness(): PayOSReadiness {
  const required = ["PAYOS_CLIENT_ID", "PAYOS_API_KEY", "PAYOS_CHECKSUM_KEY"];
  const missing = required.filter((name) => !process.env[name]?.trim());
  return { ready: missing.length === 0, missing };
}

function requiredChecksumKey(): string {
  const checksumKey = process.env.PAYOS_CHECKSUM_KEY?.trim();
  if (!checksumKey) throw new Error("PayOS is not configured.");
  return checksumKey;
}

function canonicalPayOSData(data: Record<string, unknown>): string {
  return Object.keys(data)
    .sort()
    .filter((key) => data[key] !== undefined)
    .map((key) => {
      const raw = data[key];
      const value = raw === null || raw === undefined || raw === "null" || raw === "undefined"
        ? ""
        : Array.isArray(raw)
          ? JSON.stringify(raw.map((item) => typeof item === "object" && item !== null ? sortObject(item as Record<string, unknown>) : item))
          : String(raw);
      return `${key}=${value}`;
    })
    .join("&");
}

function sortObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(value).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = value[key];
    return result;
  }, {});
}

function timingSafeEqualHex(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual.trim(), "utf8");
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

export function signPayOSData(data: Record<string, unknown>, checksumKey = requiredChecksumKey()): string {
  return crypto.createHmac("sha256", checksumKey).update(canonicalPayOSData(data), "utf8").digest("hex");
}

export function verifyPayOSData(data: Record<string, unknown>, signature: unknown): boolean {
  if (typeof signature !== "string" || !signature) return false;
  try {
    return timingSafeEqualHex(signPayOSData(data), signature);
  } catch {
    return false;
  }
}

async function payOSRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { clientId, apiKey } = requiredConfig();
  const response = await fetch(`${PAYOS_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-client-id": clientId,
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as PayOSApiResponse<T>;
  if (!response.ok || payload.code !== "00" || !payload.data) {
    throw new Error(`PayOS request failed${payload.desc ? `: ${payload.desc}` : ""}`);
  }
  return payload.data;
}

export async function createPayOSPaymentLink(input: {
  orderCode: number;
  amount: number;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  buyerEmail?: string;
}): Promise<PayOSPaymentLink> {
  const signable = {
    amount: input.amount,
    cancelUrl: input.cancelUrl,
    description: input.description,
    orderCode: input.orderCode,
    returnUrl: input.returnUrl,
  };
  const data = await payOSRequest<{
    paymentLinkId?: string;
    checkoutUrl?: string;
    qrCode?: string;
    bin?: string;
    accountNumber?: string;
    accountName?: string;
  }>("/v2/payment-requests", {
    ...signable,
    ...(input.buyerEmail ? { buyerEmail: input.buyerEmail } : {}),
    signature: signPayOSData(signable),
  });
  if (!data.paymentLinkId || !data.checkoutUrl) {
    throw new Error("PayOS did not return a payment link.");
  }
  return {
    paymentLinkId: data.paymentLinkId,
    checkoutUrl: data.checkoutUrl,
    qrCode: data.qrCode,
    bin: data.bin,
    accountNumber: data.accountNumber,
    accountName: data.accountName,
  };
}

/** Registers the deployed endpoint. PayOS verifies it with a signed sample before accepting it. */
export async function confirmPayOSWebhook(webhookUrl: string): Promise<void> {
  await payOSRequest("/confirm-webhook", { webhookUrl });
}
