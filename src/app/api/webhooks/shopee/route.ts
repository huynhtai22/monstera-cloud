import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import crypto from "crypto";
import { logger } from "@/lib/logger";
import { shopeePartnerKeySecretForWebhook } from "@/lib/shopee";
import { getRedis } from "@/lib/redis";
import { withSystemScope } from "@/lib/tenant-guard";

/** Optional extra secret for Push “Verify and Save” if Shopee signs with Test Push Partner Key (see Open Platform → Push). */
function trimEnvSecret(raw: string | undefined): string {
    if (!raw) return "";
    let v = raw.trim().replace(/^\uFEFF/, "");
    if (
        (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
        (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
    ) {
        v = v.slice(1, -1).trim();
    }
    return v;
}

function shopeePushHmacSecrets(): string[] {
    const keys: string[] = [];
    try {
        keys.push(shopeePartnerKeySecretForWebhook());
    } catch {
        logger.warn("[SHOPEE WEBHOOK] Selected Shopee Partner Key is missing — cannot verify with primary secret");
    }
    const extra = trimEnvSecret(process.env.SHOPEE_PUSH_VERIFICATION_KEY);
    if (extra && !keys.includes(extra)) {
        keys.push(extra);
    }
    return keys;
}

function normalizeShopeeAuthSignature(header: string): string {
    let s = header.trim();
    for (;;) {
        const low = s.toLowerCase();
        if (low.startsWith("sha256 ")) {
            s = s.slice(7).trim();
            continue;
        }
        if (low.startsWith("bearer ")) {
            s = s.slice(7).trim();
            continue;
        }
        break;
    }
    return s.toLowerCase();
}

/** Shopee may sign the exact wire body or a compact JSON re-encoding. */
function bodyStringsForSigning(rawBody: string): string[] {
    const variants = new Set<string>([rawBody]);
    try {
        const parsed = JSON.parse(rawBody) as unknown;
        variants.add(JSON.stringify(parsed));
    } catch {
        /* non-JSON body */
    }
    return [...variants];
}

function verifyShopeePushBody(rawBody: string, authorizationHeader: string): boolean {
    const expectedHex = normalizeShopeeAuthSignature(authorizationHeader);
    if (!/^[0-9a-f]{64}$/.test(expectedHex)) {
        return false;
    }
    const secrets = shopeePushHmacSecrets();
    if (secrets.length === 0) return false;
    const bodies = bodyStringsForSigning(rawBody);
    for (const secret of secrets) {
        for (const body of bodies) {
            const sig = crypto.createHmac("sha256", secret).update(body).digest("hex").toLowerCase();
            if (sig === expectedHex) return true;
        }
    }
    return false;
}

/** Shallow health check / probes (Partner Center sometimes expects any 2xx). */
export async function GET() {
    return new NextResponse("ok", { status: 200 });
}

export async function POST(request: Request) {
    try {
        const authorizationHeader =
            request.headers.get("authorization") ??
            request.headers.get("x-shopee-signature") ??
            "";

        if (!authorizationHeader) {
            logger.warn("[SHOPEE WEBHOOK] Missing Authorization / x-shopee-signature header");
            return new NextResponse("Missing Authorization Header.", { status: 401 });
        }

        const rawBody = await request.text();
        
        // Validate Shopee Webhook Signature
        // Format: HMAC-SHA256(partner_key, request_body)
        // Note: Shopee webhooks use body-only signing (not url|body like some other endpoints).
        // Push “Verify and Save” may sign with the Test Push Partner Key from the console; use SHOPEE_PUSH_VERIFICATION_KEY if it differs from the selected API Partner Key.
        // Header may be raw hex or prefixed with `SHA256 `; body bytes may match wire JSON or compact JSON.stringify(parse).
        if (!verifyShopeePushBody(rawBody, authorizationHeader)) {
            logger.warn(
                "[SHOPEE WEBHOOK] Invalid signature (no matching secret). Set SHOPEE_PUSH_VERIFICATION_KEY to the Push screen “Test Push Partner Key” if it still fails.",
                { received: authorizationHeader.slice(0, 80) }
            );
            return new NextResponse("Invalid Signature.", { status: 403 });
        }

        const payload = JSON.parse(rawBody);
        
        // Webhook Idempotency Check (Redis Cache)
        const eventId = payload.event_id || payload.id || crypto.createHash("md5").update(rawBody).digest("hex");
        const idempotencyKey = `webhook:shopee:${eventId}`;
        const redis = getRedis();
        const isUnique = await redis.set(idempotencyKey, "processing", { nx: true, ex: 172800 }); // 48-hour TTL
        if (!isUnique) {
            logger.info(`[SHOPEE WEBHOOK] Duplicate webhook event ${eventId} dropped.`);
            return new NextResponse(JSON.stringify({ message: "Webhook duplicate dropped" }), { 
                status: 200, 
                headers: { 'Content-Type': 'application/json' } 
            });
        }
        
        // Shopee sends code: 3 for shop deauthorization (authorization cancel)
        // or code: 4 for app deauthorization
        // Sometimes it's structured differently based on API v2 push configurations.
        // We will catch the universal `shop_id` + `code` indicating unbind.
        
        // Handle deauthorization webhooks (code 3 = shop deauth, code 4 = app deauth)
        if (payload.code === 3 || payload.code === 4 || payload.type === "shop_authorization") {
            const shopId = payload.shop_id;
            
            if (shopId) {
                logger.info(`[SHOPEE WEBHOOK] Received deauthorization for shop: ${shopId}. Purging connections...`);
                
                // Find connections by shopId - search in credentials JSON or by name pattern
                const connections = await withSystemScope(async () => {
                    return await prisma.connection.findMany({
                    where: {
                        provider: "shopee",
                        OR: [
                            { name: { contains: String(shopId) } },
                            { name: `Shopee Shop (${shopId})` },
                            { name: `Shopee ID: ${shopId}` },
                        ]
                    }
                    });
                });
                
                for (const conn of connections) {
                    // Delete associated pipelines first to avoid foreign key issues
                    // Webhook-driven cleanup crosses workspaces by design — narrow system scope.
                    await withSystemScope(async () => {
                        return await prisma.pipeline.deleteMany({
                            where: { sourceConnectionId: conn.id }
                        });
                    });

                    await prisma.connection.delete({
                        where: { id: conn.id }
                    });

                    logger.info(`[SHOPEE WEBHOOK] Deleted connection ${conn.id} for shop ${shopId}`);
                }
                
                // Note: Prisma will cascade delete any pipelines dependent on this connection
                // if the schema was configured with onDelete: Cascade, otherwise we might leave orphans.
                // For safety, we can just delete the pipelines where this connection is a source manually:
                
                /*
                const connections = await prisma.connection.findMany({
                    where: { provider: "shopee", name: `Shopee ID: ${shopId}` }
                });
                for (const conn of connections) {
                    await prisma.pipeline.deleteMany({
                        where: { sourceConnectionId: conn.id }
                    });
                    await prisma.connection.delete({ where: { id: conn.id } });
                }
                */
            }
        }

        // Shopee requires a strict HTTP 200 response to acknowledge receipt
        return new NextResponse(JSON.stringify({ message: "Webhook processed" }), { 
            status: 200, 
            headers: { 'Content-Type': 'application/json' } 
        });

    } catch (error) {
        logger.error("[SHOPEE WEBHOOK] Fatal processing error:", error);
        // We still return 200 so Shopee doesn't penalize our webhook health score, 
        // as 5xx errors can cause our app to be temporarily disabled.
        return new NextResponse("Processed with internal errors.", { status: 200 });
    }
}
