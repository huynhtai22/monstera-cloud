import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseYyyymmddToUtcDate(s: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d));
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    
    // Support either Bearer token or ?apiKey= query parameter
    let apiKey = authHeader && authHeader.startsWith("Bearer ") 
      ? authHeader.substring(7) 
      : req.nextUrl.searchParams.get("apiKey");

    if (!apiKey) {
      return NextResponse.json({ error: "Unauthorized. Missing API key." }, { status: 401 });
    }

    // Verify the api key
    const keyRecord = await prisma.apiKey.findUnique({
      where: { key: apiKey },
      include: { workspace: true },
    });

    if (!keyRecord) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    // Update last used
    await prisma.apiKey.update({
      where: { id: keyRecord.id },
      data: { lastUsedAt: new Date() }
    });

    // Optional query params for filtering
    const startDateParam = req.nextUrl.searchParams.get("startDate");
    const endDateParam = req.nextUrl.searchParams.get("endDate");
    const platformRaw = req.nextUrl.searchParams.get("platform");
    const platform =
      platformRaw === "meta" ? "meta_ads" :
      platformRaw === "google" ? "google_ads" :
      platformRaw === "tiktok" ? "tiktok_business" :
      platformRaw;

    const whereClause: any = {
      workspaceId: keyRecord.workspaceId,
    };

    if (startDateParam || endDateParam) {
      whereClause.date = {};
      if (startDateParam) {
        const d = parseYyyymmddToUtcDate(startDateParam);
        whereClause.date.gte = d ?? new Date(startDateParam);
      }
      if (endDateParam) {
        const d = parseYyyymmddToUtcDate(endDateParam);
        // inclusive end-of-day UTC
        whereClause.date.lte = d ? new Date(d.getTime() + 24 * 60 * 60 * 1000 - 1) : new Date(endDateParam);
      }
    }
    
    if (platform && platform !== "all") {
      whereClause.platform = platform;
    }

    // Fetch the metrics
    const metrics = await prisma.campaignMetric.findMany({
      where: whereClause,
      orderBy: { date: 'desc' },
      // Limit to 50k rows to avoid massive responses.
      // A more robust implementation would use pagination.
      take: 50000 
    });

    // Map into a flat JSON format that's easy for Apps Script to parse
    const formattedData = metrics.map(m => ({
      date: m.date.toISOString().split('T')[0].replace(/-/g, ''), // Looker expects YYYYMMDD
      platform: m.platform,
      accountId: m.accountId,
      accountName: m.accountName || "Unknown",
      campaignId: m.campaignId,
      campaignName: m.campaignName,
      adsetId: m.adsetId,
      adsetName: m.adsetName,
      impressions: m.impressions,
      clicks: m.clicks,
      spend: m.spend,
      reach: m.reach || 0,
      cpc: m.cpc || 0,
      ctr: m.ctr || 0,
      cpm: m.impressions ? (m.spend / Math.max(1, m.impressions)) * 1000 : 0,
      conversions: m.conversions || 0,
      revenue: m.revenue || 0,
      roas: m.roas || 0,
      currency: m.currency
    }));

    return NextResponse.json({ data: formattedData });
  } catch (error: any) {
    console.error("Looker Studio API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
