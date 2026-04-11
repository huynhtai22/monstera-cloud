import { NextResponse } from "next/server";

/**
 * MASTER HEARTBEAT CRON
 * 
 * Strategy for Vercel Free Tier:
 * 1. This is the ONLY cron job registered in vercel.json.
 * 2. It runs every minute.
 * 3. It orchestrates sub-tasks based on the current clock.
 */
export async function GET(req: Request) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    
    const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "";
    const results: any = {};

    // 1. Task: Sync Jobs (Every minute - high priority)
    // We call this every time the master heartbeat runs.
    try {
        const res = await fetch(`${baseUrl}/api/cron/sync-jobs`, {
            headers: { "Authorization": `Bearer ${process.env.CRON_SECRET}` }
        });
        results.syncJobs = res.status;
    } catch (e) {
        results.syncJobs = "failed";
    }

    // 2. Task: Shopee Token Refresh (Once a day at 00:05 UTC)
    if (hour === 0 && minute === 5) {
        try {
            const res = await fetch(`${baseUrl}/api/cron/shopee/refresh`, {
                headers: { "Authorization": `Bearer ${process.env.CRON_SECRET}` }
            });
            results.shopeeRefresh = res.status;
        } catch (e) {
            results.shopeeRefresh = "failed";
        }
    }

    // 3. Task: Performance Alerts (Once a day at 03:00 UTC)
    if (hour === 3 && minute === 0) {
        try {
            const res = await fetch(`${baseUrl}/api/cron/performance-alerts`, {
                headers: { "Authorization": `Bearer ${process.env.CRON_SECRET}` }
            });
            results.alerts = res.status;
        } catch (e) {
            results.alerts = "failed";
        }
    }

    return NextResponse.json({
        timestamp: now.toISOString(),
        executed: results
    });
}
