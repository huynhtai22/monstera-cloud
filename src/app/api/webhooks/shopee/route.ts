import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import crypto from "crypto";

export async function POST(request: Request) {
    try {
        const url = request.url;
        const authorizationHeader = request.headers.get("authorization");
        
        if (!authorizationHeader) {
            return new NextResponse("Missing Authorization Header.", { status: 401 });
        }

        const rawBody = await request.text();
        
        // Validate Shopee Webhook Signature
        // HMAC-SHA256(partnerKey, webhook_url + request_body)
        const partnerKey = process.env.SHOPEE_PARTNER_KEY || "";
        const baseString = `${url}|${rawBody}`;
        const computedSignature = crypto
            .createHmac('sha256', partnerKey)
            .update(baseString)
            .digest('hex');

        if (computedSignature !== authorizationHeader) {
            console.warn("[SHOPEE WEBHOOK] Invalid signature detected.");
            return new NextResponse("Invalid Signature.", { status: 403 });
        }

        const payload = JSON.parse(rawBody);
        
        // Shopee sends code: 3 for shop deauthorization (authorization cancel)
        // or code: 4 for app deauthorization
        // Sometimes it's structured differently based on API v2 push configurations.
        // We will catch the universal `shop_id` + `code` indicating unbind.
        
        if (payload.code === 3 || payload.code === 4 || payload.type === "shop_authorization") {
            const shopId = payload.shop_id;
            
            if (shopId) {
                console.log(`[SHOPEE WEBHOOK] Received deauthorization for shop: ${shopId}. Purging connections...`);
                
                // Delete the connection from the database
                await prisma.connection.deleteMany({
                    where: {
                        provider: "shopee",
                        name: `Shopee ID: ${shopId}`
                    }
                });
                
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
        console.error("[SHOPEE WEBHOOK] Fatal processing error:", error);
        // We still return 200 so Shopee doesn't penalize our webhook health score, 
        // as 5xx errors can cause our app to be temporarily disabled.
        return new NextResponse("Processed with internal errors.", { status: 200 });
    }
}
