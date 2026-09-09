import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { resolveApiKey } from "@/lib/api-key-security";
import { warehouseAdsCsvRows, warehouseRetailOrdersCsvRows } from "@/lib/warehouse-csv-export";
import { assertCsvExportAllowed, toPlanLimitResponse } from "@/lib/plan-entitlements";
import {
  assertQueryableClientContext,
  resolveClientContext,
  toClientContextResponse,
  warehouseClientId,
} from "@/lib/client-context-server";

/**
 * GET /api/export/rows
 * 
 * Headers:
 *   Authorization: Bearer mc_xxxxx
 * 
 * Query Params:
 *   sourceId (optional): Connection ID to pull from
 *   clientId (optional): Client ID to scope warehouse metrics
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

        // 2. Find a Source Connection to pull from (with optional clientId scoping)
        const { searchParams } = new URL(request.url);
        const sourceId = searchParams.get("sourceId");
        const clientId = searchParams.get("clientId");
        let resolution;
        try {
            resolution = await resolveClientContext({
                workspaceId,
                requestedClientId: clientId,
                surface: "exports",
            });
            assertQueryableClientContext(resolution);
        } catch (error) {
            const clientCtx = toClientContextResponse(error);
            if (clientCtx) return clientCtx;
            throw error;
        }
        const scopedClientId = warehouseClientId(resolution);

        let client = null;
        let isExplicit = false;
        let clientAssignments: Array<{ connectionId: string; provider: string; accountId: string }> = [];

        if (scopedClientId) {
            client = await prisma.client.findFirst({
                where: { id: scopedClientId, workspaceId },
                select: { id: true, accountAssignmentsConfiguredAt: true },
            });
            if (!client) {
                return NextResponse.json({ error: "Client not found or access denied." }, { status: 404 });
            }
            isExplicit = client.accountAssignmentsConfiguredAt !== null;
            if (isExplicit) {
                clientAssignments = await prisma.clientProviderAccountAssignment.findMany({
                    where: {
                        workspaceId,
                        clientId: scopedClientId,
                        ...(sourceId ? { connectionId: sourceId } : {}),
                    },
                    select: { connectionId: true, provider: true, accountId: true },
                });
                if (clientAssignments.length === 0) {
                    return NextResponse.json({ success: true, rows: [] }, { status: 200 });
                }
            }
        }

        // Build connection query that ALWAYS enforces workspace ownership
        const connectionQuery: any = { workspaceId, type: "source" };
        if (sourceId) {
            connectionQuery.id = sourceId;
        }

        if (scopedClientId) {
            if (isExplicit) {
                const assignedConnIds = [...new Set(clientAssignments.map((a) => a.connectionId))];
                connectionQuery.id = sourceId ? sourceId : { in: assignedConnIds };
            } else {
                connectionQuery.clientId = client!.id;
            }
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
            if (scopedClientId) {
                return NextResponse.json({ success: true, rows: [] }, { status: 200 });
            }
            return NextResponse.json({ error: "No active source connections found in this workspace." }, { status: 404 });
        }

        const provider = sourceConnection.provider;
        let rows: Array<Array<string | number>>;

        if (provider === "shopee") {
            if (scopedClientId && !isExplicit && sourceConnection.clientId !== client!.id) {
                return NextResponse.json({ success: true, rows: [] }, { status: 200 });
            }
            const orders = await prisma.retailOrder.findMany({
                where: { workspaceId, connectionId: sourceConnection.id },
                orderBy: { createdAt: "desc" },
                take: 10000,
                select: { orderId: true, platform: true, grossRevenue: true, netRevenue: true, currency: true, createdAtIso: true },
            });
            rows = warehouseRetailOrdersCsvRows(orders);

        } else if (provider === "meta_ads" || provider === "google_ads" || provider === "tiktok_business") {
            let metricWhere: Prisma.CampaignMetricWhereInput;
            if (scopedClientId && isExplicit) {
                const matchingAssignments = clientAssignments.filter((a) => a.connectionId === sourceConnection.id);
                if (matchingAssignments.length === 0) {
                    return NextResponse.json({ success: true, rows: [] }, { status: 200 });
                }
                metricWhere = {
                    workspaceId,
                    connectionId: sourceConnection.id,
                    OR: matchingAssignments.map((a) => ({
                        connectionId: a.connectionId,
                        platform: a.provider,
                        accountId: a.accountId,
                    })),
                };
            } else if (scopedClientId && !isExplicit) {
                metricWhere = {
                    workspaceId,
                    connectionId: sourceConnection.id,
                    connection: { clientId: client!.id },
                };
            } else {
                metricWhere = {
                    workspaceId,
                    connectionId: sourceConnection.id,
                };
            }

            const metrics = await prisma.campaignMetric.findMany({
                where: metricWhere,
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
        const clientCtx = toClientContextResponse(error);
        if (clientCtx) return clientCtx;
        logger.error("Error in /api/export/rows:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
