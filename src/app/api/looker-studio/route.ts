import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { logger } from "@/lib/logger";
import { getGoogleIdTokenAudienceAllowlist, verifyGoogleIdToken } from "@/lib/google-id-token";
import { getCachedQuery, setCachedQuery, generateCacheKey } from "@/lib/redis-cache";
import { hashApiKey, resolveApiKey } from "@/lib/api-key-security";
import { queryWarehouse } from "@/lib/warehouse-query";

const UPSTASH_AVAILABLE = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

type RateLimitResult = {
  success: boolean;
  limit?: number;
  remaining?: number;
  reset?: number;
};

async function checkPerKeyRateLimit(key: string, plan: string | null): Promise<RateLimitResult> {
  if (!UPSTASH_AVAILABLE) return { success: true };

  // Map plan -> requests per minute
  const planMap: Record<string, number> = {
    free: 60,
    pilot: 1000,
    starter: 300,
    professional: 1000,
    pro: 1000,
    enterprise: 5000,
  };
  const limit = plan && planMap[plan] ? planMap[plan] : 60;

  const rl = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(limit, "1 m"),
    analytics: false,
    prefix: "monstera:ratelimit:perkey",
  });

  const res = await rl.limit(`key:${key}`);
  return {
    success: res.success,
    limit: res.limit,
    remaining: res.remaining,
    reset: res.reset,
  };
}

const MAX_ROWS_PER_REQUEST = 100000; // server-side hard cap

function isGoogleJwt(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3 && parts[0].startsWith('eyJ');
}

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

    const apiKey =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.substring(7).trim()
        : null;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Unauthorized. Missing API key." },
        { status: 401 }
      );
    }

    let workspaceId: string;
    let workspacePlan: string;

    if (isGoogleJwt(apiKey)) {
      // Google Sheets add-on: identity token auth
      const verification = await verifyGoogleIdToken(apiKey, {
        audiences: getGoogleIdTokenAudienceAllowlist(),
      });
      if (!verification) {
        return NextResponse.json({ error: "Invalid or expired Google token" }, { status: 401 });
      }
      const email = verification.email;
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return NextResponse.json({ error: "No Monstera account found", code: "NO_ACCOUNT" }, { status: 404 });
      }
      const requestedWorkspaceId = req.nextUrl.searchParams.get("workspaceId")?.trim();
      let workspace;
      if (requestedWorkspaceId) {
        workspace = await prisma.workspace.findFirst({
          where: {
            id: requestedWorkspaceId,
            members: { some: { userId: user.id } },
          },
          select: { id: true, plan: true },
        });
      } else {
        workspace = await prisma.workspace.findFirst({
          where: {
            OR: [
              { ownerId: user.id },
              { members: { some: { userId: user.id } } },
            ],
          },
          select: { id: true, plan: true },
          orderBy: { updatedAt: "desc" },
        });
      }
      if (!workspace) {
        return NextResponse.json({ error: "No workspace found", code: "NO_WORKSPACE" }, { status: 404 });
      }
      workspaceId = workspace.id;
      workspacePlan = workspace.plan;

      const ping = req.nextUrl.searchParams.get("ping");
      if (ping === "1") return NextResponse.json({ ok: true });
    }
    else {
      // Looker Studio connector: API key auth
      const keyRecord = await resolveApiKey(apiKey);
      if (!keyRecord) {
        return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
      }

      const ping = req.nextUrl.searchParams.get("ping");
      if (ping === "1") return NextResponse.json({ ok: true });

      await prisma.apiKey.update({
        where: { id: keyRecord.id },
        data: { lastUsedAt: new Date() },
      });
      workspaceId = keyRecord.workspaceId;
      workspacePlan = keyRecord.workspace.plan;
    }

    // Apply per-API-key rate limiting. For Google JWT we key by workspace id; for API keys we key by the key string.
    try {
      const rateKey = isGoogleJwt(apiKey) ? `workspace:${workspaceId}` : `apikey:${hashApiKey(apiKey)}`;

      const rlRes = await checkPerKeyRateLimit(rateKey, workspacePlan);
      if (!rlRes.success) {
        const reset = rlRes.reset ? Math.floor(rlRes.reset / 1000) : undefined;
        const headers: Record<string, string> = {};
        if (typeof rlRes.limit === "number") headers["x-ratelimit-limit"] = String(rlRes.limit);
        if (typeof rlRes.remaining === "number") headers["x-ratelimit-remaining"] = String(rlRes.remaining);
        if (reset) headers["x-ratelimit-reset"] = String(reset);
        return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429, headers });
      }
    } catch (e) {
      // If rate limit check fails unexpectedly, log and continue (fail-open)
      logger.warn("Per-key rate limiting check failed:", e);
    }

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

    // Get all accountId parameters (supports multiple: ?accountId=123&accountId=456)
    const accountIdParams = req.nextUrl.searchParams.getAll("accountId");

    const limitParam = parseInt(req.nextUrl.searchParams.get("limit") || "0", 10) || 0;
    const limit = Math.min(limitParam > 0 ? limitParam : 10000, MAX_ROWS_PER_REQUEST);
    const cursorParam = req.nextUrl.searchParams.get("cursor");
    const includeCount = req.nextUrl.searchParams.get("includeCount") === "1";

    // Check cache early
    const cacheKey = generateCacheKey("looker", {
      workspaceId,
      search: req.nextUrl.search,
    });
    
    // Looker Studio dashboards change infrequently and trigger many concurrent queries.
    // Cache for 15 minutes (900 seconds).
    const cached = await getCachedQuery(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    let startDate: Date | undefined;
    let endDate: Date | undefined;
    if (startDateParam || endDateParam) {
      if (startDateParam) {
        const d = parseDateFilter(startDateParam);
        if (!d) {
          return NextResponse.json(
            { error: "Invalid startDate. Use YYYY-MM-DD or YYYYMMDD." },
            { status: 400 }
          );
        }
        startDate = d;
      }
      if (endDateParam) {
        const d = parseDateFilter(endDateParam);
        if (!d) {
          return NextResponse.json(
            { error: "Invalid endDate. Use YYYY-MM-DD or YYYYMMDD." },
            { status: 400 }
          );
        }
        endDate = endOfUtcDayInclusive(d);
      }
    }

    const result = await queryWarehouse({
      workspaceId,
      startDate,
      endDate,
      platforms: platform && platform !== "all" ? [platform] : undefined,
      accountIds: accountIdParams.length ? accountIdParams : undefined,
      cursor: cursorParam,
      limit,
      includeTotalCount: includeCount,
    });

    const formattedData = result.rows.map((m) => ({
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

    const resObj: Record<string, unknown> = {
      data: formattedData,
      asOf: result.asOf,
      freshness: result.freshness,
    };
    if (result.pagination.nextCursor) resObj.nextCursor = result.pagination.nextCursor;
    if (typeof result.totalCount === "number") resObj.totalRows = result.totalCount;

    // Cache the Looker Studio page for 15 minutes
    await setCachedQuery(cacheKey, resObj, 900);

    return NextResponse.json(resObj);
  } catch (error: unknown) {
    logger.error("Looker Studio API Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
