import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth-session';
import { metaReportClient } from '@/lib/meta-ads';
import {
  buildMetaReportCacheKey,
  MetaProviderOutputError,
  MetaReportValidationError,
  normalizeMetaReportRequest,
  validateMetaReportHistoricalAvailability,
} from '@/lib/meta-ads-contract';
import { getValidOAuthToken } from '@/lib/oauth-framework/token-refresh';
import {
  clampMetaDatePresetForPlan,
  getPlanLimits,
} from '@/lib/plan-config';
import prisma from '@/lib/prisma';
import { logger } from "@/lib/logger";
import { runWithConnectorContext } from '@/lib/observability/connector-telemetry';

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

export function clearMetaReportCacheForTest(): void {
  reportCache.clear();
}

export async function POST(req: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let request;
  try {
    request = normalizeMetaReportRequest(await req.json());
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Request body must be valid JSON' },
        { status: 400 },
      );
    }
    if (err instanceof MetaReportValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  try {
    const { connectionId, adAccountId, mode } = request;

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

    const params = request.params;
    if (params.datePreset) {
      params.datePreset = clampMetaDatePresetForPlan(plan, params.datePreset) ?? params.datePreset;
    }
    // "Free rewind": do not clamp user-provided timeRange, but reject combinations
    // for which Meta no longer retains the requested history.
    validateMetaReportHistoricalAvailability(params);

    // Check plan-gated cooldown cache
    const cacheKey = buildMetaReportCacheKey({
      workspaceId: conn.workspaceId,
      connectionId: conn.id,
      provider: 'meta_ads',
      adAccountId,
    }, params, mode);
    const cached = reportCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < limits.metaReportCooldownMs) {
      const remainingSec = Math.ceil((limits.metaReportCooldownMs - (Date.now() - cached.cachedAt)) / 1000);
      return NextResponse.json({ ...cached.result, cached: true, cache_expires_in_seconds: remainingSec });
    }

    const responsePayload = await runWithConnectorContext({
      workspaceId: conn.workspaceId,
      connectionId: conn.id,
      provider: 'meta_ads',
      accountId: adAccountId,
    }, async () => {
      const accessToken = await getValidOAuthToken(conn);
      if (mode === 'async') {
        // Large dataset — create async report job
        const reportRunId = await metaReportClient.createAsyncReport(accessToken, params);
        return { mode: 'async', report_run_id: reportRunId };
      } else {
        // Synchronous — good for up to ~14-day ranges
        const rows = await metaReportClient.getInsights(accessToken, params);
        if (!Array.isArray(rows) || rows.length === 0) {
          throw new MetaProviderOutputError(
            'Meta returned no report rows; the requested fields or breakdowns may be unsupported',
          );
        }
        return { mode: 'sync', rows };
      }
    });

    // Cache result
    reportCache.set(cacheKey, { result: responsePayload as Record<string, unknown>, cachedAt: Date.now() });

    // Evict stale entries
    const now = Date.now();
    for (const [key, entry] of reportCache.entries()) {
      if (now - entry.cachedAt > 60 * 60 * 1000) reportCache.delete(key);
    }

    return NextResponse.json(responsePayload);
  } catch (err: unknown) {
    if (err instanceof MetaReportValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof MetaProviderOutputError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    logger.error('[META_ADS_REPORT]', err);
    const message = err instanceof Error ? err.message : 'Failed to run Meta Ads report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
