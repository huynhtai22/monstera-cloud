/**
 * Amazon Restricted Data Token (RDT) - Flux Architecture Compliance (Section 3.4)
 *
 * Standard SP-API tokens cannot access PII (personally identifiable information).
 * For customer names, addresses, etc., you must exchange for RDT.
 *
 * Flux: "Endpoints hitting Amazon PII data must be isolated"
 */

import { getRedis } from "./redis";
import { logger } from "@/lib/logger";

const RDT_REDIS_PREFIX = "amazon:rdt:";
const RDT_TTL_SECONDS = 60 * 60; // RDTs expire in 1 hour

interface RestrictedDataToken {
  token: string;
  expiration: Date;
  restrictedResources: Array<{
    method: string;
    path: string;
  }>;
}

interface RDTRequestPayload {
  restrictedResources: Array<{
    method: "GET" | "POST";
    path: string;
    dataElements?: string[]; // Optional specific PII fields
  }>;
  targetApplication?: string; // Application ID for direct fulfillment
}

/**
 * Request Restricted Data Token from Amazon
 *
 * Standard tokens cannot access:
 * - buyerInfo (name, email, phone)
 * - shippingAddress (full address)
 * - recipientInfo
 */
export async function requestRDT(
  accessToken: string,
  resources: RDTRequestPayload["restrictedResources"],
  targetApplication?: string
): Promise<RestrictedDataToken> {
  const payload: RDTRequestPayload = {
    restrictedResources: resources,
    targetApplication,
  };

  // Amazon Token API endpoint
  const response = await fetch(
    "https://sellingpartnerapi-na.amazon.com/tokens/2021-03-01/restrictedDataToken",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-amz-access-token": accessToken,
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`RDT request failed: ${error.errors?.[0]?.message || response.statusText}`);
  }

  const data = await response.json();

  return {
    token: data.restrictedDataToken,
    expiration: new Date(Date.now() + RDT_TTL_SECONDS * 1000),
    restrictedResources: resources,
  };
}

/**
 * Get or create RDT for specific resources
 *
 * Flux: "Service must explicitly request an RDT scoped only to the specific order or report needed"
 */
export async function getRDT(
  connectionId: string,
  accessToken: string,
  resources: RDTRequestPayload["restrictedResources"]
): Promise<string> {
  const redis = getRedis();
  const cacheKey = `${RDT_REDIS_PREFIX}${connectionId}:${hashResources(resources)}`;

  // Check cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    const rdt: RestrictedDataToken = JSON.parse(cached);
    // Check if still valid (with 5 min buffer)
    if (new Date(rdt.expiration).getTime() > Date.now() + 5 * 60 * 1000) {
      logger.info(`[Amazon RDT] Cache hit for ${connectionId}`);
      return rdt.token;
    }
  }

  // Request new RDT
  logger.info(`[Amazon RDT] Requesting new token for ${connectionId}`);
  const rdt = await requestRDT(accessToken, resources);

  // Cache with 1 hour TTL (matches Amazon's RDT expiration)
  await redis.set(
    cacheKey,
    JSON.stringify(rdt),
    "EX",
    RDT_TTL_SECONDS
  );

  return rdt.token;
}

/**
 * Make API call with RDT (for PII data)
 */
export async function amazonPIIRequest<T>(
  endpoint: string,
  rdtToken: string,
  options: {
    method?: "GET" | "POST";
    body?: any;
  } = {}
): Promise<T> {
  const url = `https://sellingpartnerapi-na.amazon.com${endpoint}`;

  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "x-amz-access-token": rdtToken, // Use RDT instead of regular token
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `Amazon PII API error: ${error.errors?.[0]?.message || response.statusText}`
    );
  }

  return response.json() as T;
}

/**
 * Get order details with PII (buyer info, shipping address)
 */
export async function getOrderWithPII(
  connectionId: string,
  accessToken: string,
  orderId: string
): Promise<any> {
  // 1. Get RDT scoped specifically to this order
  const rdtToken = await getRDT(connectionId, accessToken, [
    {
      method: "GET",
      path: `/orders/v0/orders/${orderId}`,
      dataElements: ["buyerInfo", "shippingAddress"],
    },
  ]);

  // 2. Make PII request with RDT
  const orderDetails = await amazonPIIRequest(
    `/orders/v0/orders/${orderId}`,
    rdtToken
  );

  return orderDetails;
}

/**
 * Get shipping address for fulfillment
 */
export async function getShippingAddress(
  connectionId: string,
  accessToken: string,
  orderId: string
): Promise<{
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  phone?: string;
}> {
  const order = await getOrderWithPII(connectionId, accessToken, orderId);

  return {
    name: order.shippingAddress?.name || "",
    addressLine1: order.shippingAddress?.addressLine1 || "",
    addressLine2: order.shippingAddress?.addressLine2,
    city: order.shippingAddress?.city || "",
    state: order.shippingAddress?.stateOrRegion || "",
    postalCode: order.shippingAddress?.postalCode || "",
    countryCode: order.shippingAddress?.countryCode || "",
    phone: order.shippingAddress?.phone,
  };
}

/**
 * Check if endpoint requires RDT
 */
export function requiresRDT(endpoint: string): boolean {
  const piiEndpoints = [
    "/orders/v0/orders/", // With PII dataElements
    "/orders/v0/orders/{orderId}/buyerInfo",
    "/orders/v0/orders/{orderId}/address",
    "/mfn/v0/shipments/", // Merchant Fulfillment
  ];

  return piiEndpoints.some((pattern) => endpoint.includes(pattern));
}

/**
 * Hash resources for cache key
 */
function hashResources(resources: RDTRequestPayload["restrictedResources"]): string {
  const str = JSON.stringify(resources);
  return str
    .split("")
    .reduce((a, b) => {
      a = (a << 5) - a + b.charCodeAt(0);
      return a & a;
    }, 0)
    .toString(36);
}

/**
 * Audit logging for PII access (compliance)
 */
export async function logPIIAccess(
  connectionId: string,
  orderId: string,
  dataElements: string[],
  reason: string
): Promise<void> {
  // Log to your audit system
  logger.info(`[PII Audit] Accessed ${dataElements.join(", ")} for order ${orderId}`, {
    connectionId,
    orderId,
    dataElements,
    reason,
    timestamp: new Date().toISOString(),
  });

  // TODO: Send to compliance audit log
  // await sendToAuditLog({ ... });
}
