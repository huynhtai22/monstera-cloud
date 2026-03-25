import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { tiktokReportClient, CreateReportTaskParams } from '@/lib/tiktok-business';
import { getValidTikTokToken } from '@/lib/tiktok-refresh';
import { getPlanLimits } from '@/lib/plan-config';
import prisma from '@/lib/prisma';

/**
 * POST /api/tiktok-business/report/create
 * Body: { connectionId, advertiser_id, report_type, data_level, dimensions, metrics, start_date, end_date }
 *
 * Sandbox connections use the synchronous /report/integrated/get/ endpoint
 * and return rows directly: { mode: "sync", rows: [...] }
 *
 * Production connections start an async task and return: { mode: "async", task_id }
 *
 * Results are cached per-params for the plan's tiktokReportCooldownMs window to
 * prevent rapid re-runs from consuming the shared 20 QPS app limit.
 */

// Module-level in-memory cache. Lives for the lifetime of the serverless function instance.
// Each entry: { result, cachedAt, mode }
const reportCache = new Map<string, { result: any; mode: string; cachedAt: number }>();

function buildCacheKey(
  connectionId: string,
  advertiser_id: string,
  params: CreateReportTaskParams,
): string {
  const dims = [...params.dimensions].sort().join(',');
  const mets = [...params.metrics].sort().join(',');
  return [
    connectionId,
    advertiser_id,
    params.report_type,
    params.data_level,
    dims,
    mets,
    params.start_date,
    params.end_date,
  ].join(':');
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { connectionId, advertiser_id, ...reportParams } = body as {
      connectionId: string;
    } & CreateReportTaskParams;

    if (!connectionId || !advertiser_id) {
      return NextResponse.json({ error: 'connectionId and advertiser_id are required' }, { status: 400 });
    }

    // Scope the lookup to workspaces the current user belongs to (prevents IDOR)
    const conn = await (prisma.connection as any).findFirst({
      where: {
        id: connectionId,
        provider: 'tiktok_business',
        status: 'connected',
        workspace: { members: { some: { userId: session.user.id } } },
      },
    });
    if (!conn) {
      return NextResponse.json({ error: 'TikTok Business connection not found' }, { status: 404 });
    }

    // Fetch user plan for cooldown enforcement
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { plan: true } });
    const limits = getPlanLimits(user?.plan ?? 'free');

    // Check report cache — return cached result if within cooldown window
    const cacheKey = buildCacheKey(connectionId, advertiser_id, reportParams as CreateReportTaskParams);
    const cached = reportCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < limits.tiktokReportCooldownMs) {
      const remainingSec = Math.ceil((limits.tiktokReportCooldownMs - (Date.now() - cached.cachedAt)) / 1000);
      console.log(`[TIKTOK_REPORT] Cache hit — serving cached result (${remainingSec}s remaining)`);
      return NextResponse.json({
        ...cached.result,
        cached: true,
        cache_expires_in_seconds: remainingSec,
      });
    }

    // Auto-refresh access token if it is close to expiry
    const accessToken = await getValidTikTokToken(conn);
    const creds = JSON.parse(conn.credentials) as { sandbox?: boolean };

    let responsePayload: any;

    // Sandbox: use synchronous report endpoint (async tasks not supported)
    if (creds.sandbox === true) {
      const rows = await tiktokReportClient.getSyncReport(accessToken, {
        advertiser_id,
        ...reportParams,
      });
      responsePayload = { mode: 'sync', rows };
    } else {
      // Production: create async task
      const taskId = await tiktokReportClient.createTask(
        accessToken,
        { advertiser_id, ...reportParams as CreateReportTaskParams },
        false,
      );
      responsePayload = { mode: 'async', task_id: taskId };
    }

    // Store result in cache
    reportCache.set(cacheKey, {
      result: responsePayload,
      mode: responsePayload.mode,
      cachedAt: Date.now(),
    });

    // Evict stale entries to prevent unbounded memory growth
    const now = Date.now();
    for (const [key, entry] of reportCache.entries()) {
      if (now - entry.cachedAt > 60 * 60 * 1000) reportCache.delete(key); // max 1h
    }

    return NextResponse.json(responsePayload);
  } catch (err: any) {
    console.error('[TIKTOK_REPORT_CREATE]', err);
    return NextResponse.json({ error: err.message || 'Failed to create report task' }, { status: 500 });
  }
}
