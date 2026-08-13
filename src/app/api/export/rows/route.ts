import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { shopeeDataClient } from "@/lib/shopee";
import { safeDecrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { resolveApiKey } from "@/lib/api-key-security";

/**
 * GET /api/export/rows
 * 
 * Headers:
 *   Authorization: Bearer mc_xxxxx
 * 
 * Query Params:
 *   sourceId (optional): Connection ID to pull from
 * 
 * Purpose: Used by Google Sheets Add-on to pull flattened, live data arrays.
 */
export async function GET(request: Request) {
    try {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Missing or invalid Authorization header" }, { status: 401 });
        }

        const apiKeyString = authHeader.split(" ")[1];

        // 1. Authenticate API Key
        const apiKey = await resolveApiKey(apiKeyString);

        if (!apiKey) {
            return NextResponse.json({ error: "Invalid API Key" }, { status: 401 });
        }

        // Update lastUsedAt
        await prisma.apiKey.update({
            where: { id: apiKey.id },
            data: { lastUsedAt: new Date() }
        });

        const workspaceId = apiKey.workspaceId;

        // 2. Find a Source Connection to pull from (Assuming Shopee for now)
        const { searchParams } = new URL(request.url);
        const sourceId = searchParams.get("sourceId");

        // Build query that ALWAYS enforces workspace ownership
        const connectionQuery: any = { workspaceId, type: "source" };
        if (sourceId) {
            // Don't replace workspaceId — add id constraint alongside it
            connectionQuery.id = sourceId;
        }

        const sourceConnection = await prisma.connection.findFirst({
            where: connectionQuery,
            orderBy: { createdAt: "desc" }
        });

        // If sourceId was specified but not found in this workspace, reject
        if (!sourceConnection && sourceId) {
            return NextResponse.json({ error: "Connection not found or access denied." }, { status: 404 });
        }

        if (!sourceConnection) {
            return NextResponse.json({ error: "No active source connections found in this workspace." }, { status: 404 });
        }

        const provider = sourceConnection.provider;
        const sourceCreds = JSON.parse(safeDecrypt(sourceConnection.credentials));

        // rows: array-of-arrays, first row is headers
        const rows: any[][] = [];

        if (provider === "shopee") {
            const headers = ["Order ID", "Customer Name", "Status", "Total Amount", "Currency", "Item Count", "Created At"];
            rows.push(headers);

            // Pull live data if OAuth creds exist
            if (sourceCreds.access_token && sourceCreds.shop_id) {
                logger.info("[EXPORT API] Pulling live Shopee data via extension request...");
                try {
                    const timeTo = Math.floor(Date.now() / 1000);
                    const timeFrom = timeTo - (14 * 24 * 60 * 60);
                    const opts = { accessToken: sourceCreds.access_token, shopId: Number(sourceCreds.shop_id) };

                    const shopeeData = await shopeeDataClient.getOrderList(opts, timeFrom, timeTo);

                    if (shopeeData.response && shopeeData.response.order_list) {
                        shopeeData.response.order_list.forEach((o: any) => {
                            rows.push([
                                o.order_sn,
                                "Hidden (Live API)",
                                o.order_status,
                                o.total_amount,
                                o.currency || "Local",
                                1,
                                new Date(o.create_time * 1000).toISOString()
                            ]);
                        });
                    }
                } catch (liveErr) {
                    logger.error("[EXPORT API] Live pull failed.", liveErr);
                }
            }

        } else if (provider === "meta_ads" || provider === "google_ads" || provider === "tiktok_business") {
            const headers = ["Date", "Campaign", "Impressions", "Clicks", "Spend", "CPC", "CTR", "Conversions", "ROAS"];
            rows.push(headers);

            const metrics = await prisma.campaignMetric.findMany({
                where: { connectionId: sourceConnection.id },
                orderBy: { date: "desc" },
                take: 10000,
            });

            metrics.forEach((m: any) => {
                rows.push([
                    new Date(m.date).toISOString().split("T")[0],
                    m.campaignName,
                    m.impressions,
                    m.clicks,
                    m.spend,
                    m.cpc,
                    m.ctr,
                    m.conversions,
                    m.roas,
                ]);
            });
        } else {
            return NextResponse.json(
                { error: `Unsupported source provider: ${provider}` },
                { status: 400 }
            );
        }

        return NextResponse.json({ success: true, rows }, { status: 200 });

    } catch (error) {
        logger.error("Error in /api/export/rows:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
