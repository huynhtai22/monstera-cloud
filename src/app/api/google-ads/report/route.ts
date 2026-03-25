import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { googleAdsReportClient, GOOGLE_REPORT_TYPES } from '@/lib/google-ads';
import { getValidGoogleAdsToken } from '@/lib/google-ads-refresh';
import { getPlanLimits } from '@/lib/plan-config';
import prisma from '@/lib/prisma';

/**
 * POST /api/google-ads/report
 *
 * Runs a Google Ads SearchStream report.
 *
 * Body: {
 *   connectionId: string
 *   customerId: string      — Google Ads account ID (without dashes)
 *   reportType: 'campaign' | 'adgroup' | 'shopping'
 *   datePeriod: string      — GAQL date literal: LAST_30_DAYS, LAST_7_DAYS, etc.
 * }
 */

const reportCache = new Map<string, { result: Record<string, unknown>; cachedAt: number }>();

function buildCacheKey(connectionId: string, customerId: string, reportType: string, datePeriod: string): string {
  return [connectionId, customerId, reportType, datePeriod].join(':');
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json() as {
      connectionId: string;
      customerId: string;
      reportType?: string;
      datePeriod?: string;
    };

    const { connectionId, customerId } = body;
    const reportType = body.reportType ?? 'campaign';
    const datePeriod = body.datePeriod ?? 'LAST_30_DAYS';

    if (!connectionId || !customerId) {
      return NextResponse.json({ error: 'connectionId and customerId are required' }, { status: 400 });
    }

    // IDOR-safe: scope to the user's workspaces
    const conn = await (prisma.connection as any).findFirst({
      where: {
        id: connectionId,
        provider: 'google_ads',
        status: 'connected',
        workspace: { members: { some: { userId: session.user.id } } },
      },
    });
    if (!conn) {
      return NextResponse.json({ error: 'Google Ads connection not found' }, { status: 404 });
    }

    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { plan: true } });
    const limits = getPlanLimits(user?.plan ?? 'free');

    // Check plan-gated cooldown cache
    const cacheKey = buildCacheKey(connectionId, customerId, reportType, datePeriod);
    const cached = reportCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < limits.googleReportCooldownMs) {
      const remainingSec = Math.ceil((limits.googleReportCooldownMs - (Date.now() - cached.cachedAt)) / 1000);
      return NextResponse.json({ ...cached.result, cached: true, cache_expires_in_seconds: remainingSec });
    }

    const accessToken = await getValidGoogleAdsToken(conn);
    const creds = JSON.parse(conn.credentials) as { mccId?: string };

    let rows: unknown[];
    switch (reportType) {
      case 'adgroup':
        rows = await googleAdsReportClient.getAdGroupPerformance(accessToken, customerId, datePeriod, creds.mccId);
        break;
      case 'shopping':
        rows = await googleAdsReportClient.getShoppingPerformance(accessToken, customerId, datePeriod, creds.mccId);
        break;
      default:
        rows = await googleAdsReportClient.getCampaignPerformance(accessToken, customerId, datePeriod, creds.mccId);
    }

    const responsePayload: Record<string, unknown> = { rows, reportType, datePeriod, rowCount: rows.length };

    reportCache.set(cacheKey, { result: responsePayload, cachedAt: Date.now() });

    // Evict stale entries
    const now = Date.now();
    for (const [key, entry] of reportCache.entries()) {
      if (now - entry.cachedAt > 60 * 60 * 1000) reportCache.delete(key);
    }

    return NextResponse.json(responsePayload);
  } catch (err: any) {
    console.error('[GOOGLE_ADS_REPORT]', err);
    return NextResponse.json({ error: err.message || 'Failed to run Google Ads report' }, { status: 500 });
  }
}
