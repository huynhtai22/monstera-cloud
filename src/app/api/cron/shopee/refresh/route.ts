import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ShopeeClient } from "@/lib/shopee";
import { encrypt, safeDecrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";

// Vercel Cron Jobs send a specific authorization header.
// It's recommended to secure cron endpoints using the CRON_SECRET envar.
export async function GET(request: Request) {
    try {
        const authHeader = request.headers.get('authorization');
        
        // Secure the cron endpoint natively in production
        if (process.env.NODE_ENV === "production" && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return new NextResponse('Unauthorized Cron Request', { status: 401 });
        }

        logger.info("[CRON: SHOPEE REFRESH] Initiating automated fleet token refresh protocol...");

        const connections = await prisma.connection.findMany({
            where: {
                provider: "shopee",
                status: "connected"
            }
        });

        const now = Date.now();
        const shopeeClient = new ShopeeClient();
        let refreshedCount = 0;
        let failedCount = 0;

        for (const conn of connections) {
            try {
                const creds = JSON.parse(safeDecrypt(conn.credentials));
                const expireInSecs = creds.expire_in || 259200; // Default to 3 days if missing
                
                // Calculate exactly when the token expires
                const tokenCreatedAtMs = new Date(conn.updatedAt).getTime();
                const expirationTimeMs = tokenCreatedAtMs + (expireInSecs * 1000);
                
                // If it expires within the next 24 hours (86,400,000 ms), refresh it early.
                if (expirationTimeMs - now < 86400000) {
                    logger.info(`[CRON: SHOPEE REFRESH] Refreshing connection ID: ${conn.id}`);
                    
                    // refreshAccessToken throws on API error, so no need to check fields
                    // Use sandbox flag from stored credentials (fallback to env for legacy connections)
                    const isSandbox = creds.sandbox === true || process.env.SHOPEE_SANDBOX === "true";
                    const newTokenData = await shopeeClient.refreshAccessToken(creds.refresh_token, creds.shop_id, isSandbox);

                    await prisma.connection.update({
                        where: { id: conn.id },
                        data: {
                            credentials: encrypt(JSON.stringify({
                                access_token: newTokenData.access_token,
                                refresh_token: newTokenData.refresh_token,
                                expire_in: newTokenData.expire_in,
                                shop_id: creds.shop_id,
                                sandbox: isSandbox
                            }))
                        }
                    });
                    
                    refreshedCount++;
                }

            } catch (err: any) {
                logger.error(`[CRON: SHOPEE REFRESH] Critical failure for connection ${conn.id}:`, err.message);
                failedCount++;
                
                // We could optionally update status to "disconnected" if refresh token is permanently invalid
                // But for now, just flag the error and let it retry next hour.
            }
        }

        return NextResponse.json({
            status: "Success",
            message: "Shopee Token Refresh Cron executed.",
            statistics: {
                scanned: connections.length,
                refreshed: refreshedCount,
                failed: failedCount
            }
        });

    } catch (error) {
        logger.error("[CRON: SHOPEE REFRESH] Fatal execution error:", error);
        return new NextResponse("Internal Cron Failure", { status: 500 });
    }
}
