import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { resolveApiKey } from "@/lib/api-key-security";
import { warehouseAdsCsvRows, warehouseRetailOrdersCsvRows } from "@/lib/warehouse-csv-export";
import { assertCsvExportAllowed, toPlanLimitResponse } from "@/lib/plan-entitlements";

/**
 * GET /api/export/rows
 * 
 * Headers:
 *   Authorization: Bearer mc_xxxxx
 * 
 * Query Params:
 *   sourceId (optional): Connection ID to pull from
 * 
 * Purpose: Used by Google Sheets Add-on to pull flattened warehouse data arrays.
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
        try {
            await assertCsvExportAllowed(apiKey.workspace.plan);
        } catch (error) {
            const planLimit = toPlanLimitResponse(error);
            if (planLimit) return planLimit;
            throw error;
        }

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
        let rows: Array<Array<string | number>>;

        if (provider === "shopee") {
            const orders = await prisma.retailOrder.findMany({
                where: { workspaceId, connectionId: sourceConnection.id },
                orderBy: { createdAt: "desc" },
                take: 10000,
                select: { orderId: true, platform: true, grossRevenue: true, netRevenue: true, currency: true, createdAtIso: true },
            });
            rows = warehouseRetailOrdersCsvRows(orders);

        } else if (provider === "meta_ads" || provider === "google_ads" || provider === "tiktok_business") {
            const metrics = await prisma.campaignMetric.findMany({
                where: { workspaceId, connectionId: sourceConnection.id },
                orderBy: { date: "desc" },
                take: 10000,
                select: { date: true, campaignName: true, impressions: true, clicks: true, spend: true, cpc: true, ctr: true, conversions: true, revenue: true, roas: true, currency: true },
            });
            rows = warehouseAdsCsvRows(metrics);
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
