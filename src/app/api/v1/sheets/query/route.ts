import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { effectiveSheetsPlan } from '@/lib/sheets-reviewer';
import { tiktokReportClient } from '@/lib/tiktok-business';
import { metaReportClient, META_DEFAULT_FIELDS } from '@/lib/meta-ads';
import { getValidMetaToken } from '@/lib/meta-refresh';
import { googleAdsReportClient } from '@/lib/google-ads';
import { getValidGoogleAdsToken } from '@/lib/google-ads-refresh';
import { PRODUCT_SITE_URL } from '@/lib/site-url';

/**
 * POST /api/v1/sheets/query
 * Body: {
 *   googleToken,
 *   source: "tiktok_ads",
 *   connectionId,
 *   advertiser_id,
 *   data_level,
 *   dimensions: string[],
 *   metrics: string[],
 *   start_date, end_date
 * }
 *
 * Called by the Google Sheets Add-on.
 * Verifies identity via Google token, checks subscription, fetches data.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { googleToken, source, connectionId, advertiser_id, data_level,
            dimensions, metrics, start_date, end_date } = body;

    // ── 1. Verify Google token → get email ──────────────────────────────────
    if (!googleToken) {
      return NextResponse.json({ error: 'Missing Google token' }, { status: 400 });
    }

    const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${googleToken}` },
    });
    if (!googleRes.ok) {
      return NextResponse.json({ error: 'invalid_token', message: 'Google token expired. Reopen the add-on.' }, { status: 401 });
    }
    const googleUser = (await googleRes.json()) as { email?: string };
    if (!googleUser.email) {
      return NextResponse.json({ error: 'No email from Google' }, { status: 401 });
    }

    // ── 2. Find user + check subscription ───────────────────────────────────
    const user = await (prisma.user as any).findUnique({
      where: { email: googleUser.email },
      select: { id: true, plan: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'no_account', message: 'No Monstera Cloud account for this email.' }, { status: 404 });
    }

    const plan = effectiveSheetsPlan(user.plan, googleUser.email);
    if (plan !== 'starter' && plan !== 'professional') {
      return NextResponse.json({
        error: 'upgrade_required',
        message: `This feature requires a paid plan. Upgrade at ${PRODUCT_SITE_URL.replace('https://', '')}/pricing`,
        upgradeUrl: `${PRODUCT_SITE_URL}/pricing`,
      }, { status: 403 });
    }

    // ── 3. Validate params ──────────────────────────────────────────────────
    const supportedSources = ['tiktok_ads', 'meta_ads', 'google_ads'];
    if (!supportedSources.includes(source)) {
      return NextResponse.json({ error: `Unsupported source: ${source}. Supported: ${supportedSources.join(', ')}` }, { status: 400 });
    }
    if (!connectionId) {
      return NextResponse.json({ error: 'Missing connectionId' }, { status: 400 });
    }

    // ── 4. Route to the correct data source ─────────────────────────────────
    let rows: any[] = [];
    let headers: string[] = [];

    if (source === 'tiktok_ads') {
      if (!advertiser_id || !dimensions?.length || !metrics?.length || !start_date || !end_date) {
        return NextResponse.json({ error: 'TikTok Ads requires: advertiser_id, dimensions, metrics, start_date, end_date' }, { status: 400 });
      }

      const conn = await (prisma.connection as any).findFirst({
        where: { id: connectionId, provider: 'tiktok_business', status: 'connected', workspace: { members: { some: { userId: user.id } } } },
      });
      if (!conn) return NextResponse.json({ error: 'TikTok connection not found' }, { status: 404 });

      const creds = JSON.parse(conn.credentials) as { accessToken: string; sandbox?: boolean };
      const reportParams = { advertiser_id, report_type: 'BASIC' as const, data_level, dimensions, metrics, start_date, end_date };

      if (creds.sandbox) {
        rows = await tiktokReportClient.getSyncReport(creds.accessToken, reportParams);
      } else {
        const base = 'https://business-api.tiktok.com/open_api/v1.3';
        const url = new URL(`${base}/report/integrated/get/`);
        url.searchParams.set('advertiser_id', advertiser_id);
        url.searchParams.set('report_type', 'BASIC');
        url.searchParams.set('data_level', data_level);
        url.searchParams.set('dimensions', JSON.stringify(dimensions));
        url.searchParams.set('metrics', JSON.stringify(metrics));
        url.searchParams.set('start_date', start_date);
        url.searchParams.set('end_date', end_date);
        url.searchParams.set('page_size', '1000');
        const res = await fetch(url.toString(), { headers: { 'Access-Token': creds.accessToken } });
        const json = (await res.json()) as Record<string, unknown>;
        if ((json.code as number) !== 0) return NextResponse.json({ error: `TikTok error ${json.code}: ${json.message}` }, { status: 502 });
        rows = ((json.data as Record<string, unknown>).list as any[]) ?? [];
      }

      const dimKeys = Object.keys(rows[0]?.dimensions ?? rows[0] ?? {});
      const metricKeys = Object.keys(rows[0]?.metrics ?? {});
      headers = [...dimKeys, ...metricKeys];
      rows = rows.map((r: any) => headers.map((h) => (r.dimensions ?? r)[h] ?? (r.metrics ?? {})[h] ?? ''));

    } else if (source === 'meta_ads') {
      const { adAccountId, fields, level, datePreset, timeRange, timeIncrement, breakdowns } = body;
      if (!adAccountId) return NextResponse.json({ error: 'meta_ads requires: adAccountId' }, { status: 400 });

      const conn = await (prisma.connection as any).findFirst({
        where: { id: connectionId, provider: 'meta_ads', status: 'connected', workspace: { members: { some: { userId: user.id } } } },
      });
      if (!conn) return NextResponse.json({ error: 'Meta Ads connection not found' }, { status: 404 });

      const accessToken = await getValidMetaToken(conn);
      const metaRows = await metaReportClient.getInsights(accessToken, {
        adAccountId,
        fields: fields ?? META_DEFAULT_FIELDS,
        level: level ?? 'campaign',
        datePreset: datePreset ?? 'last_30d',
        timeRange,
        timeIncrement: timeIncrement ?? 1,
        breakdowns: breakdowns ?? [],
      });

      if (metaRows.length === 0) {
        headers = fields ?? META_DEFAULT_FIELDS;
        rows = [];
      } else {
        headers = Object.keys(metaRows[0]);
        rows = metaRows.map((r) => headers.map((h) => {
          const v = r[h];
          return Array.isArray(v) ? JSON.stringify(v) : String(v ?? '');
        }));
      }

    } else if (source === 'google_ads') {
      const { customerId, reportType, datePeriod } = body;
      if (!customerId) return NextResponse.json({ error: 'google_ads requires: customerId' }, { status: 400 });

      const conn = await (prisma.connection as any).findFirst({
        where: { id: connectionId, provider: 'google_ads', status: 'connected', workspace: { members: { some: { userId: user.id } } } },
      });
      if (!conn) return NextResponse.json({ error: 'Google Ads connection not found' }, { status: 404 });

      const accessToken = await getValidGoogleAdsToken(conn);
      const creds = JSON.parse(conn.credentials) as { mccId?: string };

      let googleRows;
      switch (reportType ?? 'campaign') {
        case 'adgroup': googleRows = await googleAdsReportClient.getAdGroupPerformance(accessToken, customerId, datePeriod ?? 'LAST_30_DAYS', creds.mccId); break;
        case 'shopping': googleRows = await googleAdsReportClient.getShoppingPerformance(accessToken, customerId, datePeriod ?? 'LAST_30_DAYS', creds.mccId); break;
        default: googleRows = await googleAdsReportClient.getCampaignPerformance(accessToken, customerId, datePeriod ?? 'LAST_30_DAYS', creds.mccId);
      }

      if (googleRows.length === 0) {
        headers = ['campaign_name', 'impressions', 'clicks', 'cost', 'conversions', 'ctr'];
        rows = [];
      } else {
        headers = Object.keys(googleRows[0]);
        rows = googleRows.map((r) => headers.map((h) => String(r[h] ?? '')));
      }
    }

    // ── 5. Row limit based on plan ────────────────────────────────────────────
    const flatRows = rows; // already flattened above per source

    // Row limit based on plan
    const maxRows = plan === 'professional' ? 100_000 : 10_000;

    const limited = flatRows.slice(0, maxRows);

    return NextResponse.json({
      headers,
      rows: limited,
      totalRows: flatRows.length,
      truncated: flatRows.length > maxRows,
    });
  } catch (err: any) {
    console.error('[SHEETS_QUERY]', err);
    return NextResponse.json({ error: err.message || 'Query failed' }, { status: 500 });
  }
}
