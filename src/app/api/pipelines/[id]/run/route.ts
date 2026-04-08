import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { google } from "googleapis";
import { shopeeDataClient } from "@/lib/shopee";
import { getPlanLimits } from "@/lib/plan-config";
import { encrypt, safeDecrypt } from "@/lib/encryption";

export async function POST(req: Request, context: { params: any }) {
    let syncLogId;
    let pipelineId: string | undefined;

    try {
        const syncStartTime = Date.now();
        const session = await getServerSession(authOptions);
        if (!session || !session.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Properly extract params safely for Next.js 15+
        const params = await context.params;
        pipelineId = params?.id;

        if (!pipelineId) {
            return NextResponse.json({ error: "Missing pipeline ID" }, { status: 400 });
        }

        // 1. Fetch Pipeline with Relations
        const pipeline = await prisma.pipeline.findUnique({
            where: { id: String(pipelineId) },
            include: {
                sourceConnection: true,
                destinationConnection: true,
                workspace: true
            }
        });

        if (!pipeline) {
            return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
        }

        // Enforce sync cooldown — prevent re-runs faster than the plan allows
        const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { plan: true } });
        const limits = getPlanLimits(user?.plan ?? "free");

        if (pipeline.lastSyncedAt) {
            const msSinceLast = Date.now() - pipeline.lastSyncedAt.getTime();
            if (msSinceLast < limits.syncIntervalMs) {
                const waitSec = Math.ceil((limits.syncIntervalMs - msSinceLast) / 1000);
                const waitMin = Math.ceil(waitSec / 60);
                return NextResponse.json(
                    {
                        error: `Your ${user?.plan ?? "free"} plan syncs ${limits.syncLabel.toLowerCase()}. Please wait ${waitMin} more minute${waitMin === 1 ? "" : "s"} before re-running.`,
                        code: "SYNC_COOLDOWN",
                        retry_after_seconds: waitSec,
                    },
                    { status: 429 }
                );
            }
        }

        // 2. Locate User's Google OAuth Account
        const googleAccount = await prisma.account.findFirst({
            where: {
                userId: session.user.id,
                provider: "google"
            }
        });

        if (!googleAccount || !googleAccount.access_token) {
            return NextResponse.json({ error: "Google Account not linked or missing access token" }, { status: 403 });
        }

        // 3. Extract + Transform: build sheet headers + rows
        const provider = pipeline.sourceConnection.provider;
        const sourceCreds = JSON.parse(safeDecrypt(pipeline.sourceConnection.credentials));

        let headers: string[] = [];
        let rows: any[][] = [];

        switch (provider) {
            case "shopee": {
                let orders: any[] = [];

                if (sourceCreds.access_token && sourceCreds.shop_id) {
                    console.log("[PIPELINE] Detected real Shopee OAuth credentials. Fetching live data...");
                    try {
                        const timeTo = Math.floor(Date.now() / 1000);
                        const timeFrom = timeTo - (14 * 24 * 60 * 60);
                        const opts = { accessToken: sourceCreds.access_token, shopId: Number(sourceCreds.shop_id) };

                        const shopeeData = await shopeeDataClient.getOrderList(opts, timeFrom, timeTo);

                        if (shopeeData.response && shopeeData.response.order_list) {
                            orders = shopeeData.response.order_list.map((o: any) => ({
                                order_id: o.order_sn,
                                customer_name: "Hidden by Shopee Privacy",
                                status: o.order_status,
                                total_amount: o.total_amount,
                                currency: o.currency || "Local",
                                items_count: 1,
                                created_at: new Date(o.create_time * 1000).toISOString()
                            }));
                        }
                    } catch (liveErr) {
                        console.error("[PIPELINE] Live pull failed. Falling back to mock.", liveErr);
                    }
                }

                // Fallback to Mock API
                if (orders.length === 0) {
                    console.log("[PIPELINE] Utilizing Mock Shopee API.");
                    const apiKey = sourceCreds.apiKey || "mock-api-key";
                    const shopeeRes = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/mock/shopee/orders?page=1&limit=50`, {
                        headers: { 'Authorization': `Bearer ${apiKey}` }
                    });

                    if (!shopeeRes.ok) {
                        throw new Error(`Shopee Mock API Error: ${shopeeRes.status}`);
                    }

                    const shopeeData = await shopeeRes.json();
                    orders = shopeeData.data || [];
                }

                if (orders.length === 0) {
                    return NextResponse.json({ message: "No new data to sync." });
                }

                headers = ["Order ID", "Customer Name", "Status", "Total Amount", "Currency", "Item Count", "Created At"];
                rows = orders.map((order: any) => [
                    order.order_id,
                    order.customer_name,
                    order.status,
                    order.total_amount,
                    order.currency,
                    order.items_count,
                    order.created_at
                ]);
                break;
            }

            case "meta_ads": {
                headers = ["Date", "Campaign", "Impressions", "Clicks", "Spend", "CPC", "CTR", "Conversions", "ROAS"];
                const metaMetrics = await prisma.campaignMetric.findMany({
                    where: { connectionId: pipeline.sourceConnectionId },
                    orderBy: { date: "desc" },
                    take: 10000,
                });
                rows = metaMetrics.map((m: any) => [
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
                break;
            }

            case "google_ads": {
                headers = ["Date", "Campaign", "Impressions", "Clicks", "Spend", "CPC", "CTR", "Conversions", "ROAS"];
                const googleMetrics = await prisma.campaignMetric.findMany({
                    where: { connectionId: pipeline.sourceConnectionId },
                    orderBy: { date: "desc" },
                    take: 10000,
                });
                rows = googleMetrics.map((m: any) => [
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
                break;
            }

            case "tiktok_business": {
                headers = ["Date", "Campaign", "Impressions", "Clicks", "Spend", "CPC", "CTR", "Conversions", "ROAS"];
                const tiktokMetrics = await prisma.campaignMetric.findMany({
                    where: { connectionId: pipeline.sourceConnectionId },
                    orderBy: { date: "desc" },
                    take: 10000,
                });
                rows = tiktokMetrics.map((m: any) => [
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
                break;
            }

            default:
                return NextResponse.json(
                    { error: `Unsupported source provider: ${provider}` },
                    { status: 400 }
                );
        }

        const sheetData = [headers, ...rows];

        // 5. Load: Push Data to Google Sheets using googleapis SDK
        const destCreds = JSON.parse(safeDecrypt(pipeline.destinationConnection.credentials));
        const spreadsheetId = destCreds.spreadsheetId;

        const auth = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET
        );

        auth.setCredentials({
            access_token: googleAccount.access_token,
            refresh_token: googleAccount.refresh_token,
            expiry_date: googleAccount.expires_at ? googleAccount.expires_at * 1000 : null
        });

        const sheets = google.sheets({ version: "v4", auth });

        // Check if spreadsheet exists, if not, create one? 
        // For simplicity, we assume they provided an ID or we create one if "target_spreadsheet" is the dummy ID.
        let actualSpreadsheetId = spreadsheetId;

        if (actualSpreadsheetId === "target_spreadsheet" || !actualSpreadsheetId) {
            // Auto-create a new spreadsheet
            const newSheet = await sheets.spreadsheets.create({
                requestBody: {
                    properties: { title: `Monstera Sync: ${pipeline.name}` }
                }
            });
            actualSpreadsheetId = newSheet.data.spreadsheetId;

            // Save the real ID back to the database
            await prisma.connection.update({
                where: { id: pipeline.destinationConnection.id },
                data: {
                    credentials: encrypt(JSON.stringify({ ...destCreds, spreadsheetId: actualSpreadsheetId }))
                }
            });
        }

        // Clear existing data first to prevent duplication on repeated syncs
        await sheets.spreadsheets.values.clear({
            spreadsheetId: actualSpreadsheetId,
            range: "A1:Z",
        });

        // Write (not append) the full dataset including headers
        await sheets.spreadsheets.values.update({
            spreadsheetId: actualSpreadsheetId,
            range: "A1",
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: sheetData
            }
        });

        // 6. Log the Sync Job
        const syncLog = await prisma.syncLog.create({
            data: {
                pipelineId: pipeline.id,
                status: "success",
                rowsSynced: rows.length,
                durationMs: Date.now() - syncStartTime,
            }
        });

        // Update pipeline last synced
        await prisma.pipeline.update({
            where: { id: pipeline.id },
            data: { lastSyncedAt: new Date() }
        });

        return NextResponse.json({
            success: true,
            message: `Successfully synced ${rows.length} rows to Google Sheets.`,
            spreadsheetId: actualSpreadsheetId,
            logId: syncLog.id
        });

    } catch (error: any) {
        console.error("Pipeline Sync Error:", error);

        // Optionally log the error to the database
        if (pipelineId) {
            await prisma.syncLog.create({
                data: {
                    pipelineId: String(pipelineId),
                    status: "error",
                    errorMsg: error.message || "Unknown error occurred"
                }
            }).catch(() => { });
        }

        return NextResponse.json({ error: error.message || "Pipeline execution failed" }, { status: 500 });
    }
}
