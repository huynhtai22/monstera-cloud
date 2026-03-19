import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { google } from "googleapis";

export async function POST(req: Request, context: { params: any }) {
    let syncLogId;
    let pipelineId: string | undefined;

    try {
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

        // 3. Extract: Pull Data from Mock Shopee API
        // Parse source credentials to get the API Key (simulated)
        const sourceCreds = JSON.parse(pipeline.sourceConnection.credentials);
        const apiKey = sourceCreds.apiKey || "mock-api-key";

        const shopeeRes = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/mock/shopee/orders?page=1&limit=50`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        if (!shopeeRes.ok) {
            throw new Error(`Shopee API Error: ${shopeeRes.status}`);
        }

        const shopeeData = await shopeeRes.json();
        const orders = shopeeData.data || [];

        if (orders.length === 0) {
            return NextResponse.json({ message: "No new data to sync." });
        }

        // 4. Transform: Flatten data for Google Sheets
        // Google Sheets expects an array of arrays: [[col1, col2], [val1, val2]]
        const headers = ["Order ID", "Customer Name", "Status", "Total Amount", "Currency", "Item Count", "Created At"];
        const rows = orders.map((order: any) => [
            order.order_id,
            order.customer_name,
            order.status,
            order.total_amount,
            order.currency,
            order.items_count,
            order.created_at
        ]);

        const sheetData = [headers, ...rows];

        // 5. Load: Push Data to Google Sheets using googleapis SDK
        const destCreds = JSON.parse(pipeline.destinationConnection.credentials);
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
                    credentials: JSON.stringify({ ...destCreds, spreadsheetId: actualSpreadsheetId })
                }
            });
        }

        // Append the data
        await sheets.spreadsheets.values.append({
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
                durationMs: 1200 // Mock duration
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
