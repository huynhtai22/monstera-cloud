import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ShopeeClient } from "@/lib/shopee";

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
        const apiKey = await prisma.apiKey.findUnique({
            where: { key: apiKeyString },
            include: { workspace: true }
        });

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

        const connectionQuery: any = { workspaceId, type: "source" };
        if (sourceId) connectionQuery.id = sourceId;

        const sourceConnection = await prisma.connection.findFirst({
            where: connectionQuery,
            orderBy: { createdAt: "desc" }
        });

        if (!sourceConnection) {
            return NextResponse.json({ error: "No active source connections found in this workspace." }, { status: 404 });
        }

        const sourceCreds = JSON.parse(sourceConnection.credentials);
        let rows: any[] = [];
        const headers = ["Order ID", "Customer Name", "Status", "Total Amount", "Currency", "Item Count", "Created At"];
        rows.push(headers);

        // 3. Pull Data
        if (sourceConnection.provider === "shopee" && sourceCreds.access_token && sourceCreds.shop_id) {
            console.log("[EXPORT API] Pulling live Shopee data via extension request...");
            try {
                const shopee = new ShopeeClient();
                const path = '/api/v2/order/get_order_list';
                const timeTo = Math.floor(Date.now() / 1000);
                const timeFrom = timeTo - (14 * 24 * 60 * 60);

                const requestUrl = shopee.buildRequestUrl(path, sourceCreds.access_token, sourceCreds.shop_id, {
                    time_range_field: 'create_time',
                    time_from: timeFrom,
                    time_to: timeTo,
                    page_size: 50
                });

                const shopeeRes = await fetch(requestUrl);
                const shopeeData = await shopeeRes.json();

                if (shopeeData.error) {
                    console.warn("[EXPORT API] Live Shopee API returned an error:", shopeeData.message);
                } else if (shopeeData.response && shopeeData.response.order_list) {
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
                console.error("[EXPORT API] Live pull failed.", liveErr);
            }
        }

        // Fallback to Mock Data if actual pull yielded nothing (useful for trial testing)
        if (rows.length === 1) {
            console.log("[EXPORT API] Using Mock Data Fallback.");
            const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
            const host = request.headers.get("host") || "localhost:3000";
            
            const shopeeRes = await fetch(`${protocol}://${host}/api/mock/shopee/orders?page=1&limit=50`);
            
            if (shopeeRes.ok) {
                const shopeeData = await shopeeRes.json();
                const orders = shopeeData.data || [];
                orders.forEach((o: any) => {
                    rows.push([
                        o.order_id,
                        o.customer_name,
                        o.status,
                        o.total_amount,
                        o.currency,
                        o.items_count,
                        o.created_at
                    ]);
                });
            }
        }

        return NextResponse.json({ success: true, rows }, { status: 200 });

    } catch (error) {
        console.error("Error in /api/export/rows:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
