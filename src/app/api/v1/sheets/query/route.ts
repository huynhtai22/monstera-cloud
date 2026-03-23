import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { tiktokReportClient } from '@/lib/tiktok-business';

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
    if (user.plan !== 'starter' && user.plan !== 'professional') {
      return NextResponse.json({
        error: 'upgrade_required',
        message: 'This feature requires a paid plan. Upgrade at monstera-cloud.com/pricing',
        upgradeUrl: 'https://monstera-cloud.vercel.app/pricing',
      }, { status: 403 });
    }

    // ── 3. Validate params ──────────────────────────────────────────────────
    if (source !== 'tiktok_ads') {
      return NextResponse.json({ error: `Unsupported source: ${source}` }, { status: 400 });
    }
    if (!connectionId || !advertiser_id || !dimensions?.length || !metrics?.length || !start_date || !end_date) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // ── 4. Verify connection belongs to user's workspace ────────────────────
    const conn = await (prisma.connection as any).findFirst({
      where: {
        id: connectionId,
        provider: 'tiktok_business',
        status: 'connected',
        workspace: { members: { some: { userId: user.id } } },
      },
    });
    if (!conn) {
      return NextResponse.json({ error: 'TikTok connection not found or not authorized' }, { status: 404 });
    }

    const creds = JSON.parse(conn.credentials) as { accessToken: string; sandbox?: boolean };
    const isSandbox = creds.sandbox === true;

    // ── 5. Fetch data ───────────────────────────────────────────────────────
    const reportParams = {
      advertiser_id,
      report_type: 'BASIC' as const,
      data_level,
      dimensions,
      metrics,
      start_date,
      end_date,
    };

    let rows;
    if (isSandbox) {
      rows = await tiktokReportClient.getSyncReport(creds.accessToken, reportParams);
    } else {
      // Production: use sync endpoint too for Sheets (simpler, no polling needed)
      // For large date ranges we'd use async, but sync is fine for typical queries
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

      const res = await fetch(url.toString(), {
        headers: { 'Access-Token': creds.accessToken },
      });
      const json = (await res.json()) as Record<string, unknown>;
      if ((json.code as number) !== 0) {
        return NextResponse.json({ error: `TikTok error ${json.code}: ${json.message}` }, { status: 502 });
      }
      const data = json.data as Record<string, unknown>;
      rows = (data.list as any[]) ?? [];
    }

    // ── 6. Flatten rows for Sheets (2D array: headers + values) ─────────────
    if (!rows || rows.length === 0) {
      return NextResponse.json({ headers: [...dimensions, ...metrics], rows: [] });
    }

    // Discover all keys from the first row
    const dimKeys = Object.keys(rows[0].dimensions ?? rows[0] ?? {});
    const metricKeys = Object.keys(rows[0].metrics ?? {});
    const headers = [...dimKeys, ...metricKeys];

    const flatRows = rows.map((r: any) => {
      const dims = r.dimensions ?? r;
      const mets = r.metrics ?? {};
      return headers.map((h) => dims[h] ?? mets[h] ?? '');
    });

    // Row limit based on plan
    const maxRows = user.plan === 'professional' ? 100_000 : 10_000;
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
