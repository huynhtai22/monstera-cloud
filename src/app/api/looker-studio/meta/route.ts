import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Redis } from "@upstash/redis";
import { logger } from "@/lib/logger";
import { resolveApiKey } from "@/lib/api-key-security";

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null;

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const apiKey =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.substring(7).trim()
        : null;

    if (!apiKey) {
      return NextResponse.json({ error: "Unauthorized. Missing API key." }, { status: 401 });
    }

    const keyRecord = await resolveApiKey(apiKey);
    if (!keyRecord) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });

    const workspaceId = keyRecord.workspaceId;
    const startDateParam = req.nextUrl.searchParams.get("startDate");
    const endDateParam = req.nextUrl.searchParams.get("endDate");
    const platform = req.nextUrl.searchParams.get("platform");

    const cacheKey = `looker:meta:${workspaceId}:${startDateParam || ''}:${endDateParam || ''}:${platform || 'all'}`;
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached && typeof cached === 'string') return NextResponse.json(JSON.parse(cached));
      } catch (e) {
        // ignore cache read errors
      }
    }

    const where: any = { workspaceId };
    if (platform && platform !== 'all') where.platform = platform;
    if (startDateParam || endDateParam) {
      where.date = {};
      if (startDateParam) {
        const d = new Date(startDateParam + 'T00:00:00Z');
        where.date.gte = d;
      }
      if (endDateParam) {
        const d = new Date(endDateParam + 'T00:00:00Z');
        where.date.lte = new Date(d.getTime() + 24 * 60 * 60 * 1000 - 1);
      }
    }

    const totalRows = await prisma.campaignMetric.count({ where });

    // Return list of distinct accountIds and platforms
    const accounts = await prisma.campaignMetric.findMany({
      where,
      distinct: ['accountId'],
      select: { accountId: true, accountName: true },
      orderBy: { accountName: 'asc' },
    });

    const platforms = await prisma.campaignMetric.findMany({
      where,
      distinct: ['platform'],
      select: { platform: true },
    });

    const res = {
      totalRows,
      accounts: accounts.map(a => ({ accountId: a.accountId, accountName: a.accountName || 'Unknown' })),
      platforms: platforms.map(p => p.platform),
    };

    if (redis) {
      try { await redis.set(cacheKey, JSON.stringify(res), { ex: 60 }); } catch {}
    }

    return NextResponse.json(res);
  } catch (e) {
    logger.error('Looker Studio Meta API Error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
