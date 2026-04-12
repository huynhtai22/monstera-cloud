import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/** Parse YYYYMMDD or YYYY-MM-DD (Looker Studio sends the latter when date range is required). */
function parseDateFilter(value: string): Date | null {
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (compact) {
    const y = Number(compact[1]);
    const mo = Number(compact[2]);
    const d = Number(compact[3]);
    if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return new Date(Date.UTC(y, mo - 1, d));
  }
  const dashed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dashed) {
    const y = Number(dashed[1]);
    const mo = Number(dashed[2]);
    const d = Number(dashed[3]);
    if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return new Date(Date.UTC(y, mo - 1, d));
  }
  return null;
}

function endOfUtcDayInclusive(startUtcMidnight: Date): Date {
  return new Date(startUtcMidnight.getTime() + 24 * 60 * 60 * 1000 - 1);
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");

    let apiKey =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.substring(7).trim()
        : req.nextUrl.searchParams.get("apiKey")?.trim() ?? null;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Unauthorized. Missing API key." },
        { status: 401 }
      );
    }

    const keyRecord = await prisma.apiKey.findUnique({
      where: { key: apiKey },
      include: { workspace: true },
    });

    if (!keyRecord) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    const ping = req.nextUrl.searchParams.get("ping");
    if (ping === "1") {
      return NextResponse.json({ ok: true });
    }

    await prisma.apiKey.update({
      where: { id: keyRecord.id },
      data: { lastUsedAt: new Date() },
    });

    const startDateParam = req.nextUrl.searchParams.get("startDate");
    const endDateParam = req.nextUrl.searchParams.get("endDate");
    const platformRaw = req.nextUrl.searchParams.get("platform");
    const platform =
      platformRaw === "meta"
        ? "meta_ads"
        : platformRaw === "google"
          ? "google_ads"
          : platformRaw === "tiktok"
            ? "tiktok_business"
            : platformRaw;

    const whereClause: {
      workspaceId: string;
      date?: { gte?: Date; lte?: Date };
      platform?: string;
    } = {
      workspaceId: keyRecord.workspaceId,
    };

    if (startDateParam || endDateParam) {
      whereClause.date = {};
      if (startDateParam) {
        const d = parseDateFilter(startDateParam);
        if (!d) {
          return NextResponse.json(
            { error: "Invalid startDate. Use YYYY-MM-DD or YYYYMMDD." },
            { status: 400 }
          );
        }
        whereClause.date.gte = d;
      }
      if (endDateParam) {
        const d = parseDateFilter(endDateParam);
        if (!d) {
          return NextResponse.json(
            { error: "Invalid endDate. Use YYYY-MM-DD or YYYYMMDD." },
            { status: 400 }
          );
        }
        whereClause.date.lte = endOfUtcDayInclusive(d);
      }
    }

    if (platform && platform !== "all") {
      whereClause.platform = platform;
    }

    const metrics = await prisma.campaignMetric.findMany({
      where: whereClause,
      orderBy: { date: "desc" },
      take: 50_000,
    });

    const formattedData = metrics.map((m) => ({
      date: m.date.toISOString().split("T")[0].replace(/-/g, ""),
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
      reach: m.reach ?? 0,
      cpc: m.cpc ?? 0,
      ctr: m.ctr ?? 0,
      cpm: m.impressions
        ? (m.spend / Math.max(1, m.impressions)) * 1000
        : 0,
      conversions: m.conversions ?? 0,
      revenue: m.revenue ?? 0,
      roas: m.roas ?? 0,
      currency: m.currency,
    }));

    return NextResponse.json({ data: formattedData });
  } catch (error: unknown) {
    console.error("Looker Studio API Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
