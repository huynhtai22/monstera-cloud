import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { metaReportClient, MetaInsightsParams, META_DEFAULT_FIELDS } from '@/lib/meta-ads';
import { getValidOAuthToken } from '@/lib/oauth-framework/token-refresh';
import {
  clampMetaDatePresetForPlan,
  getPlanLimits,
} from '@/lib/plan-config';
import prisma from '@/lib/prisma';
import { logger } from "@/lib/logger";

/**
 * POST /api/meta-ads/report
 *
 * Runs a Meta Insights query. Uses synchronous /insights for small date ranges
 * and async mode for large datasets (datePreset: last_30d+ or custom ranges > 14 days).
 *
 * Body: {
 *   connectionId: string
 *   adAccountId: string
 *   fields?: string[]
 *   level: 'campaign' | 'adset' | 'ad' | 'account'
 *   datePreset?: string
 *   timeRange?: { since: string; until: string }
 *   timeIncrement?: number
 *   breakdowns?: string[]
 *   actionAttributionWindows?: string[]
 *   async?: boolean
 * }
 */

const reportCache = new Map<string, { result: Record<string, unknown>; cachedAt: number }>();

function buildCacheKey(connectionId: string, adAccountId: string, params: MetaInsightsParams): string {
  const fields = [...(params.fields ?? [])].sort().join(',');
  const breakdowns = [...(params.breakdowns ?? [])].sort().join(',');
  return [
    connectionId,
    adAccountId,
    params.level,
    fields,
    breakdowns,
    params.datePreset ?? '',
    params.timeRange ? `${params.timeRange.since}:${params.timeRange.until}` : '',
    String(params.timeIncrement ?? ''),
  ].join(':');
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json() as {
      connectionId: string;
      adAccountId: string;
      fields?: string[];
      level?: string;
      datePreset?: string;
      timeRange?: { since: string; until: string };
      timeIncrement?: number;
      breakdowns?: string[];
      actionAttributionWindows?: string[];
      async?: boolean;
    };

    const { connectionId, adAccountId } = body;

    if (!connectionId || !adAccountId) {
      return NextResponse.json({ error: 'connectionId and adAccountId are required' }, { status: 400 });
    }

    // IDOR-safe: scope to the user's workspaces
    const conn = await (prisma.connection as any).findFirst({
      where: {
        id: connectionId,
        provider: 'meta_ads',
        status: 'connected',
        workspace: { members: { some: { userId: session.user.id } } },
      },
      include: { workspace: { select: { plan: true } } },
    });
    if (!conn) {
      return NextResponse.json({ error: 'Meta Ads connection not found' }, { status: 404 });
    }

    const plan = conn.workspace.plan ?? 'pilot';
    const limits = getPlanLimits(plan);

    let datePreset = body.datePreset ?? 'last_30d';
    datePreset = clampMetaDatePresetForPlan(plan, datePreset) ?? datePreset;
    // \"Free rewind\": do not clamp user-provided timeRange.
    const timeRange = body.timeRange;

    const params: MetaInsightsParams = {
      adAccountId,
      fields: body.fields ?? META_DEFAULT_FIELDS,
      level: (body.level as MetaInsightsParams['level']) ?? 'campaign',
      datePreset,
      timeRange,
      timeIncrement: body.timeIncrement ?? 1,
      breakdowns: body.breakdowns ?? [],
      actionAttributionWindows: body.actionAttributionWindows ?? ['7d_click', '1d_view'],
    };

    // Check plan-gated cooldown cache
    const cacheKey = buildCacheKey(connectionId, adAccountId, params);
    const cached = reportCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < limits.metaReportCooldownMs) {
      const remainingSec = Math.ceil((limits.metaReportCooldownMs - (Date.now() - cached.cachedAt)) / 1000);
      return NextResponse.json({ ...cached.result, cached: true, cache_expires_in_seconds: remainingSec });
    }

    const accessToken = await getValidOAuthToken(conn);

    let responsePayload: Record<string, unknown>;

    if (body.async) {
      // Large dataset — create async report job
      const reportRunId = await metaReportClient.createAsyncReport(accessToken, params);
      responsePayload = { mode: 'async', report_run_id: reportRunId };
    } else {
      // Synchronous — good for up to ~14-day ranges
      const rows = await metaReportClient.getInsights(accessToken, params);
      responsePayload = { mode: 'sync', rows };
    }

    // Cache result
    reportCache.set(cacheKey, { result: responsePayload as Record<string, unknown>, cachedAt: Date.now() });

    // Evict stale entries
    const now = Date.now();
    for (const [key, entry] of reportCache.entries()) {
      if (now - entry.cachedAt > 60 * 60 * 1000) reportCache.delete(key);
    }

    return NextResponse.json(responsePayload);
  } catch (err: any) {
    logger.error('[META_ADS_REPORT]', err);
    return NextResponse.json({ error: err.message || 'Failed to run Meta Ads report' }, { status: 500 });
  }
}
