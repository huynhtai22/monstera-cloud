import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { safeDecrypt } from '@/lib/encryption';
import { productionRouteDisabled } from '@/lib/request-auth';

const SANDBOX_BASE = 'https://sandbox-ads.tiktok.com/open_api/v1.3';

async function tiktokPost(path: string, token: string, body: unknown) {
  const res = await fetch(`${SANDBOX_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Access-Token': token },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function tiktokGet(path: string, token: string, params: Record<string, string>) {
  const url = new URL(`${SANDBOX_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { 'Access-Token': token },
  });
  return res.json() as Promise<Record<string, unknown>>;
}

/**
 * POST /api/tiktok-business/sandbox-seed
 * Body: { connectionId }
 * 1. Fetches advertiser info to verify token
 * 2. Creates a test campaign → ad group → ad
 * Returns: { advertiser, campaign_id, adgroup_id, ad_id }
 */
export async function POST(req: Request) {
  if (productionRouteDisabled("ENABLE_PRODUCTION_SANDBOX_ROUTES")) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Session expired — please log in again.' }, { status: 401 });
  }

  const { connectionId } = await req.json();
  if (!connectionId) {
    return NextResponse.json({ error: 'connectionId is required' }, { status: 400 });
  }

  const conn = await (prisma.connection as any).findFirst({
    where: { id: connectionId, provider: 'tiktok_business', status: 'connected' },
  });
  if (!conn) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
  }

  const creds = JSON.parse(safeDecrypt(conn.credentials)) as { accessToken: string; advertiserIds: string[] };
  const token = creds.accessToken;
  const advertiserId = creds.advertiserIds?.[0];
  if (!advertiserId) {
    return NextResponse.json({ error: 'No advertiser ID on this connection' }, { status: 400 });
  }

  // ── Step 1: verify advertiser ────────────────────────────────────────────
  const infoRes = await tiktokGet('/advertiser/info/', token, {
    advertiser_ids: JSON.stringify([advertiserId]),
    fields: JSON.stringify(['name', 'currency', 'timezone', 'country']),
  });

  if ((infoRes.code as number) !== 0) {
    return NextResponse.json(
      { error: `Token invalid or expired: ${infoRes.message}` },
      { status: 400 }
    );
  }
  const advertiserList = (infoRes.data as Record<string, unknown>)?.list as unknown[];
  const advertiser = advertiserList?.[0] ?? null;

  // ── Step 2: create test campaign ─────────────────────────────────────────
  const campRes = await tiktokPost('/campaign/create/', token, {
    advertiser_id: advertiserId,
    campaign_name: `[Test] Monstera Cloud ${new Date().toISOString().slice(0, 10)}`,
    objective_type: 'TRAFFIC',
    budget_mode: 'BUDGET_MODE_INFINITE',
    budget: 0,
  });

  if ((campRes.code as number) !== 0) {
    // Campaign creation failed — return account info at least
    return NextResponse.json({
      advertiser,
      warning: `Account verified but could not create test campaign: ${campRes.message}`,
    });
  }
  const campaignId = (campRes.data as Record<string, unknown>)?.campaign_id as string;

  // ── Step 3: create test ad group ─────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const adgroupRes = await tiktokPost('/adgroup/create/', token, {
    advertiser_id: advertiserId,
    campaign_id: campaignId,
    adgroup_name: '[Test] Monstera AdGroup',
    placement_type: 'PLACEMENT_TYPE_AUTOMATIC',
    budget_mode: 'BUDGET_MODE_DAY',
    budget: 50,
    schedule_type: 'SCHEDULE_START_END',
    schedule_start_time: `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)} 00:00:00`,
    schedule_end_time: '2027-12-31 23:59:59',
    billing_event: 'CPC',
    bid_type: 'BID_TYPE_NO_BID',
    optimization_goal: 'CLICK',
    location_ids: [6252001],
    age_groups: ['AGE_13_17', 'AGE_18_24', 'AGE_25_34'],
    languages: ['en'],
    operation_status: 'ENABLE',
  });

  const adgroupId = (adgroupRes.data as Record<string, unknown>)?.adgroup_id as string | undefined;

  return NextResponse.json({
    advertiser,
    campaign_id: campaignId,
    adgroup_id: adgroupId ?? null,
    note: 'Test campaign created. Wait 1–2 minutes then run the report to see data.',
  });
}
