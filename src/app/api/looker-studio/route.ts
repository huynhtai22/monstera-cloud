import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const UPSTASH_AVAILABLE = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const redis = UPSTASH_AVAILABLE ? Redis.fromEnv() : null;

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

async function verifyGoogleIdToken(idToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.email || data.email_verified !== 'true') return null;
    if (data.exp && Number(data.exp) * 1000 < Date.now()) return null;
    return data.email as string;
  } catch {
    return null;
  }
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

    let workspaceId: string;

    if (isGoogleJwt(apiKey)) {
      // Google Sheets add-on: identity token auth
      const email = await verifyGoogleIdToken(apiKey);
      if (!email) {
        return NextResponse.json({ error: "Invalid or expired Google token" }, { status: 401 });
      }
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return NextResponse.json({ error: "No Monstera account found", code: "NO_ACCOUNT" }, { status: 404 });
      }
      const workspace = await prisma.workspace.findFirst({
        where: {
          OR: [
            { ownerId: user.id },
            { members: { some: { userId: user.id } } },
          ],
        },
        select: { id: true, ownerId: true },
      });
      if (!workspace) {
        return NextResponse.json({ error: "No workspace found" }, { status: 404 });
      }
      workspaceId = workspace.id;

      const ping = req.nextUrl.searchParams.get("ping");
      if (ping === "1") return NextResponse.json({ ok: true });
    }
    else {
      // Looker Studio connector: API key auth
      const keyRecord = await prisma.apiKey.findUnique({
        where: { key: apiKey },
        include: { workspace: true },
      });
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
      // fetch owner plan for this workspace
      const owner = await prisma.user.findUnique({ where: { id: keyRecord.workspace.ownerId } });
      (req as any)._ownerPlan = owner ? owner.plan : null;
    }

    // Apply per-API-key rate limiting. For Google JWT we key by workspace id; for API keys we key by the key string.
    try {
      // Determine plan: prefer owner plan attached earlier for API keys, otherwise derive for Google JWT
      let plan: string | null = null;
      if ((req as any)._ownerPlan) plan = (req as any)._ownerPlan;
      if (!plan && isGoogleJwt(apiKey)) {
        try {
          // fetch workspace owner plan if available
          const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { ownerId: true } });
          if (ws && ws.ownerId) {
            const owner = await prisma.user.findUnique({ where: { id: ws.ownerId } });
            plan = owner ? owner.plan : null;
          }
        } catch (ignore) {}
      }

      const rateKey = isGoogleJwt(apiKey) ? `workspace:${workspaceId}` : `apikey:${apiKey}`;

      const rlRes = await checkPerKeyRateLimit(rateKey, plan);
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
      console.warn("Per-key rate limiting check failed:", e);
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

    const whereClause: any = { workspaceId };

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

    // Filter by specific accounts if provided
    if (accountIdParams.length > 0) {
      whereClause.accountId = { in: accountIdParams };
    }

    // Apply cursor-based pagination if provided. Cursor format: encoded "YYYY-MM-DD|<id>" or raw.
    if (cursorParam) {
      try {
        const decoded = decodeURIComponent(cursorParam);
        const parts = decoded.split("|");
        if (parts.length === 2) {
          const lastDate = new Date(parts[0] + "T00:00:00Z");
          const lastId = parts[1];
          whereClause.AND = [
            whereClause,
            {
              OR: [
                { date: { lt: lastDate } },
                { AND: [{ date: lastDate }, { id: { lt: lastId } }] },
              ],
            },
          ];
        }
      } catch (e) {
        // ignore malformed cursor — fall back to start
      }
    }

    const take = Math.min(limit || 10000, MAX_ROWS_PER_REQUEST);

    const metrics = await prisma.campaignMetric.findMany({
      where: whereClause,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: take + 1, // fetch one extra to detect nextCursor
    });

    let nextCursor: string | null = null;
    if (metrics.length > take) {
      const last = metrics[metrics.length - 1];
      nextCursor = encodeURIComponent(last.date.toISOString().split("T")[0] + "|" + last.id);
      metrics.pop();
    }

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

    const resObj: any = { data: formattedData };
    if (nextCursor) resObj.nextCursor = nextCursor;

    if (includeCount) {
      try {
        const countWhere = { ...whereClause };
        // remove pagination AND when counting
        if (countWhere.AND) delete countWhere.AND;
        const totalRows = await prisma.campaignMetric.count({ where: countWhere });
        resObj.totalRows = totalRows;
      } catch (e) {
        // counting failed — omit totalRows
      }
    }

    // Optionally cache the page for a short TTL (only if Upstash configured)
    if (redis) {
      try {
        const cacheKey = `looker:page:${workspaceId}:${req.nextUrl.search}`;
        await redis.set(cacheKey, JSON.stringify(resObj), { ex: 60 });
      } catch (e) {
        // ignore cache failures
      }
    }

    return NextResponse.json(resObj);
  } catch (error: unknown) {
    console.error("Looker Studio API Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
