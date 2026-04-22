/**
 * Amazon SP-API Restricted Data Tokens (RDT) - Flux Architecture Compliance (Section 3.4)
 *
 * Requirement: Standard tokens cannot access PII (customer names, addresses).
 * Must exchange for RDTs scoped only to specific orders.
 */

import { getRedis } from "@/lib/redis";

// RDT Token data structure
interface RestrictedDataToken {
    restrictedDataToken: string;
    expiresIn: number; // seconds (usually 1 hour)
    requestedOrders: string[];
}

// Cache key for RDT
const RDT_PREFIX = "amazon:rdt:";

/**
 * Request Restricted Data Token from Amazon
 *
 * Amazon SP-API requires RDTs for any PII access:
 * - Buyer name, email, phone
 * - Shipping address
 * - Tax information
 */
export async function requestRestrictedDataToken(
    accessToken: string,
    orderIds: string[],
    options?: {
        dataElements?: string[]; // Specific PII fields needed
    }
): Promise<RestrictedDataToken | null> {
    try {
        // Check cache first
        const cached = await getCachedRDT(orderIds);
        if (cached) {
            console.log(`[AmazonRDT] Using cached RDT for ${orderIds.length} orders`);
            return cached;
        }

        // Build request body
        const body = {
            restrictedResources: orderIds.map((orderId) => ({
                method: "GET",
                path: `/orders/v0/orders/${orderId}`,
                dataElements: options?.dataElements || [
                    "buyerInfo",
                    "shippingAddress",
                ],
            })),
        };

        // Call Amazon Tokens API
        const response = await fetch(
            "https://sellingpartnerapi-na.amazon.com/tokens/2021-03-01/restrictedDataToken",
            {
                method: "POST",
                headers: {
                    "x-amz-access-token": accessToken,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
            }
        );

        if (!response.ok) {
            const error = await response.text();
            console.error("[AmazonRDT] Failed to request RDT:", error);
            return null;
        }

        const data = await response.json();

        const rdt: RestrictedDataToken = {
            restrictedDataToken: data.restrictedDataToken,
            expiresIn: data.expiresIn || 3600,
            requestedOrders: orderIds,
        };

        // Cache the RDT
        await cacheRDT(orderIds, rdt);

        console.log(`[AmazonRDT] New RDT acquired for ${orderIds.length} orders`);

        return rdt;
    } catch (err) {
        console.error("[AmazonRDT] Error requesting token:", err);
        return null;
    }
}

/**
 * Get cached RDT from Redis
 */
async function getCachedRDT(orderIds: string[]): Promise<RestrictedDataToken | null> {
    const redis = getRedis();
    const key = `${RDT_PREFIX}${orderIds.sort().join(",")}`;

    try {
        const cached = await redis.get(key);
        if (cached) {
            const rdt: RestrictedDataToken = JSON.parse(cached);
            // Check if still valid (at least 5 minutes remaining)
            const ttl = await redis.ttl(key);
            if (ttl > 300) {
                return rdt;
            }
        }
    } catch (err) {
        console.error("[AmazonRDT] Cache error:", err);
    }

    return null;
}

/**
 * Cache RDT with expiration
 */
async function cacheRDT(orderIds: string[], rdt: RestrictedDataToken): Promise<void> {
    const redis = getRedis();
    const key = `${RDT_PREFIX}${orderIds.sort().join(",")}`;

    // Cache for RDT lifetime minus 5 minute safety buffer
    const ttl = Math.max(60, rdt.expiresIn - 300);

    try {
        await redis.set(key, JSON.stringify(rdt), "EX", ttl);
    } catch (err) {
        console.error("[AmazonRDT] Failed to cache RDT:", err);
    }
}

/**
 * Make API call with RDT for PII data
 *
 * This is the main function to use when accessing order PII
 */
export async function fetchOrderWithPII(
    accessToken: string,
    orderId: string,
    piiFields?: string[]
): Promise<any | null> {
    // 1. Get RDT for this order
    const rdt = await requestRestrictedDataToken(
        accessToken,
        [orderId],
        { dataElements: piiFields }
    );

    if (!rdt) {
        console.error(`[AmazonRDT] Could not get RDT for order ${orderId}`);
        return null;
    }

    // 2. Call order API with RDT instead of regular access token
    try {
        const response = await fetch(
            `https://sellingpartnerapi-na.amazon.com/orders/v0/orders/${orderId}`,
            {
                headers: {
                    "x-amz-access-token": rdt.restrictedDataToken, // Use RDT here!
                    "Content-Type": "application/json",
                },
            }
        );

        if (!response.ok) {
            const error = await response.text();
            console.error(`[AmazonRDT] Order fetch failed:`, error);
            return null;
        }

        return await response.json();
    } catch (err) {
        console.error(`[AmazonRDT] Network error:`, err);
        return null;
    }
}

/**
 * Batch fetch orders with PII
 * More efficient - requests single RDT for multiple orders
 */
export async function fetchOrdersWithPII(
    accessToken: string,
    orderIds: string[],
    piiFields?: string[]
): Promise<Map<string, any>> {
    const results = new Map<string, any>();

    if (orderIds.length === 0) return results;

    // 1. Get RDT for all orders
    const rdt = await requestRestrictedDataToken(accessToken, orderIds, {
        dataElements: piiFields,
    });

    if (!rdt) {
        console.error(`[AmazonRDT] Could not get RDT for ${orderIds.length} orders`);
        return results;
    }

    // 2. Fetch each order with RDT
    await Promise.all(
        orderIds.map(async (orderId) => {
            try {
                const response = await fetch(
                    `https://sellingpartnerapi-na.amazon.com/orders/v0/orders/${orderId}`,
                    {
                        headers: {
                            "x-amz-access-token": rdt.restrictedDataToken,
                            "Content-Type": "application/json",
                        },
                    }
                );

                if (response.ok) {
                    const order = await response.json();
                    results.set(orderId, order);
                } else {
                    console.warn(`[AmazonRDT] Failed to fetch order ${orderId}`);
                }
            } catch (err) {
                console.error(`[AmazonRDT] Error fetching order ${orderId}:`, err);
            }
        })
    );

    return results;
}

/**
 * Check if data requires RDT
 */
export function requiresRDT(dataType: string): boolean {
    const piiDataTypes = [
        "buyerInfo",
        "shippingAddress",
        "billingAddress",
        "buyerTaxInformation",
        "customerName",
        "customerEmail",
        "customerPhone",
    ];

    return piiDataTypes.includes(dataType);
}

/**
 * Compliance reminder for Amazon PII
 */
export const AmazonPIIComplianceNote = `
## Amazon PII Data Handling

When accessing Personally Identifiable Information (PII) through Amazon SP-API:

### Data Protection Requirements:
1. **Encryption at Rest** - All PII must be encrypted when stored
2. **Encryption in Transit** - All PII must use HTTPS/TLS
3. **Access Logging** - Log who accessed what PII data
4. **Data Retention** - Delete PII after 30 days unless required for tax/financial purposes
5. **No Third-Party Sharing** - Never share PII with external services

### RDT Requirements:
- Standard OAuth tokens CANNOT access PII
- Must request Restricted Data Tokens (RDTs) for each order
- RDTs expire in 1 hour
- RDTs are scoped to specific orders only

### Allowed PII Use Cases:
- Order fulfillment (shipping labels)
- Customer service (responding to buyer messages)
- Tax reporting (generating invoices)
- Fraud prevention

### Prohibited Use:
- Marketing to buyers
- Building customer databases
- Selling data to third parties
- Aggregating across sellers

Violating these policies can result in:
- Immediate suspension of SP-API access
- Termination of seller account
- Legal action by Amazon
`;
