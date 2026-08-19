/**
 * Meta Marketing API v23.0 client
 * Docs: https://developers.facebook.com/docs/marketing-api
 * Insights: https://developers.facebook.com/docs/marketing-api/insights
 *
 * Auth flow:
 *   OAuth 2.0 → short-lived token → exchange for long-lived token (60 days)
 *   For SaaS production: upgrade to System User Token (never expires) via Business Manager
 *
 * Rate limits:
 *   Rolling 1hr window: 60 + (400 × active_ads) calls per ad account.
 *   Check x-fb-ads-insights-throttle header — back off at >80% utilization.
 */

import { logger } from '@/lib/logger';

const META_API_VERSION = 'v23.0';
const META_GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;
const META_AUTH_BASE = 'https://www.facebook.com/dialog/oauth';
const META_TOKEN_URL = `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`;

function appId(): string {
  return (process.env.META_ADS_APP_ID || '').trim();
}

function appSecret(): string {
  return (process.env.META_ADS_APP_SECRET || '').trim();
}

// ── OAuth types ──────────────────────────────────────────────────────────────

export interface MetaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number; // seconds — present on short-lived tokens
}

export interface MetaLongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // ~5183944 seconds (~60 days)
}

export interface MetaTokenDebug {
  app_id: string;
  is_valid: boolean;
  expires_at?: number; // unix timestamp
  scopes: string[];
}

// ── Insights types ───────────────────────────────────────────────────────────

export type MetaInsightsLevel = 'account' | 'campaign' | 'adset' | 'ad';

export interface MetaInsightsParams {
  adAccountId: string;
  fields: string[];
  level: MetaInsightsLevel;
  datePreset?: string;           // last_7d, last_30d, last_month, etc.
  timeRange?: { since: string; until: string }; // YYYY-MM-DD
  timeIncrement?: number;        // 1 = daily, 7 = weekly
  breakdowns?: string[];         // age, gender, country, placement, device
  actionAttributionWindows?: string[];
  limit?: number;
  filtering?: Array<{ field: string; operator: string; value: unknown }>;
}

export interface MetaInsightsRow {
  [key: string]: string | number | MetaAction[] | undefined;
  date_start?: string;
  date_stop?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  cpm?: string;
  cpc?: string;
  ctr?: string;
  purchase_roas?: MetaAction[];
  actions?: MetaAction[];
  action_values?: MetaAction[];
}

export interface MetaAction {
  action_type: string;
  value: string;
  '7d_click'?: string;
  '1d_view'?: string;
}

export interface MetaAsyncReportStatus {
  id: string;
  account_id: string;
  async_status: 'Job Not Started' | 'Job Started' | 'Job Running' | 'Job Completed' | 'Job Failed' | 'Job Skipped';
  async_percent_completion: number;
  date_start?: string;
  date_stop?: string;
}

// ── Meta Ads OAuth client ────────────────────────────────────────────────────

export class MetaAdsClient {
  /**
   * Step 1 — Build the Facebook OAuth URL.
   * Scopes: ads_read (Standard Access, no review), business_management (needs Advanced Access).
   */
  getAuthorizeUrl(state: string, redirectUri: string): string {
    const id = appId();
    if (!id) throw new Error('META_ADS_APP_ID is not configured');

    const url = new URL(META_AUTH_BASE);
    url.searchParams.set('client_id', id);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', 'ads_read,business_management');
    url.searchParams.set('response_type', 'code');

    return url.toString();
  }

  /**
   * Step 2 — Exchange the authorization code for a short-lived token,
   * then immediately upgrade it to a long-lived token (~60 days).
   */
  async exchangeCode(code: string, redirectUri: string): Promise<MetaLongLivedTokenResponse> {
    const id = appId();
    const secret = appSecret();
    if (!id || !secret) throw new Error('META_ADS_APP_ID or META_ADS_APP_SECRET not configured');

    // Exchange for short-lived token
    const shortUrl = new URL(META_TOKEN_URL);
    shortUrl.searchParams.set('client_id', id);
    shortUrl.searchParams.set('client_secret', secret);
    shortUrl.searchParams.set('redirect_uri', redirectUri);
    shortUrl.searchParams.set('code', code);

    const shortRes = await fetch(shortUrl.toString());
    const shortJson = await shortRes.json() as MetaTokenResponse & { error?: { message: string } };
    if (shortJson.error) throw new Error(`Meta OAuth error: ${shortJson.error.message}`);

    // Upgrade to long-lived token
    return this.exchangeForLongLived(shortJson.access_token);
  }

  /**
   * Upgrade a short-lived token to a long-lived token (~60 days).
   */
  async exchangeForLongLived(shortToken: string): Promise<MetaLongLivedTokenResponse> {
    const id = appId();
    const secret = appSecret();
    if (!id || !secret) throw new Error('META_ADS_APP_ID or META_ADS_APP_SECRET not configured');

    const url = new URL(META_TOKEN_URL);
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', id);
    url.searchParams.set('client_secret', secret);
    url.searchParams.set('fb_exchange_token', shortToken);

    const res = await fetch(url.toString());
    const json = await res.json() as MetaLongLivedTokenResponse & { error?: { message: string } };
    if (json.error) throw new Error(`Meta token exchange error: ${(json as any).error.message}`);

    return json;
  }

  /**
   * Debug a token to get expiry and scopes.
   */
  async debugToken(accessToken: string): Promise<MetaTokenDebug> {
    const id = appId();
    const secret = appSecret();
    const url = new URL(`${META_GRAPH_BASE}/debug_token`);
    url.searchParams.set('input_token', accessToken);
    url.searchParams.set('access_token', `${id}|${secret}`);

    const res = await fetch(url.toString());
    const json = await res.json() as { data: MetaTokenDebug; error?: { message: string } };
    if (json.error) throw new Error(`Meta debug_token error: ${(json as any).error.message}`);
    return json.data;
  }

  /**
   * Fetch the list of ad accounts the token has access to.
   */
  async getAdAccounts(accessToken: string): Promise<Array<{ id: string; name: string; currency: string; account_status: number }>> {
    const url = new URL(`${META_GRAPH_BASE}/me/adaccounts`);
    url.searchParams.set('fields', 'id,name,currency,account_status');
    url.searchParams.set('access_token', accessToken);

    const res = await fetch(url.toString());
    const json = await res.json() as { data: Array<{ id: string; name: string; currency: string; account_status: number }>; error?: { message: string } };
    if (json.error) throw new Error(`Meta adaccounts error: ${(json as any).error.message}`);
    return json.data ?? [];
  }
}

export const metaAdsClient = new MetaAdsClient();

// ── Rate-limit utilities ────────────────────────────────────────────────────

/** Parsed utilization from x-business-use-case-usage or x-fb-ads-insights-throttle */
export interface MetaThrottleState {
  callCount: number;
  totalCalls: number;
  pct: number; // 0-100
  estimatedTimeToRegainAccess?: number; // ms
}

/**
 * Parse Meta's x-business-use-case-usage header.
 * Format: { "<adAccountId>": [{ call_count, total_cputime, total_time, type, estimated_time_to_regain_access }] }
 */
function parseThrottleHeader(res: Response): MetaThrottleState | null {
  const raw =
    res.headers.get('x-business-use-case-usage') ??
    res.headers.get('x-fb-ads-insights-throttle');
  if (!raw) return null;
  try {
    const parsed: Record<string, Array<{ call_count?: number; total_cputime?: number; total_time?: number; estimated_time_to_regain_access?: number }>> = JSON.parse(raw);
    const entries = Object.values(parsed).flat();
    if (!entries.length) return null;
    const callCount = entries[0]?.call_count ?? 0;
    const totalTime = entries[0]?.total_time ?? 0;
    const regain = entries[0]?.estimated_time_to_regain_access;
    return {
      callCount,
      totalCalls: 100,
      pct: Math.max(callCount, totalTime),
      estimatedTimeToRegainAccess: regain ? regain * 1000 : undefined,
    };
  } catch {
    return null;
  }
}

/** Jittered exponential backoff: base * 2^attempt + random(0..jitter) ms */
async function backoff(attempt: number, baseMs = 1000, jitterMs = 500): Promise<void> {
  const delay = Math.min(baseMs * Math.pow(2, attempt) + Math.random() * jitterMs, 60_000);
  logger.warn(`[META_RATE_LIMIT] Backing off ${Math.round(delay)}ms (attempt ${attempt + 1})`);
  await new Promise((r) => setTimeout(r, delay));
}

/**
 * Throttle-aware fetch wrapper.
 * - Retries on 429 / error code 17 (rate limit) with jittered backoff.
 * - Pauses automatically if utilization > 85%.
 */
async function metaFetch(
  url: URL,
  options?: RequestInit,
  maxRetries = 4,
): Promise<{ res: Response; throttle: MetaThrottleState | null }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url.toString(), options);
    const throttle = parseThrottleHeader(res);

    // Proactive throttle: if usage > 85%, wait before returning
    if (throttle && throttle.pct >= 85) {
      const pauseMs = throttle.estimatedTimeToRegainAccess ?? 15_000;
      logger.warn(`[META_RATE_LIMIT] Usage at ${throttle.pct}%, pausing ${pauseMs}ms before continuing`);
      await new Promise((r) => setTimeout(r, pauseMs));
    }

    // 429 or Meta error code 17/32/613 → back off and retry
    if (res.status === 429) {
      if (attempt < maxRetries - 1) { await backoff(attempt); continue; }
    }

    // Peek at body only if it's a potential rate-limit JSON error (keep body readable)
    if (!res.ok) {
      const clone = res.clone();
      try {
        const errJson = await clone.json() as { error?: { code?: number; message?: string } };
        const code = errJson?.error?.code;
        if ((code === 17 || code === 32 || code === 613 || code === 80004) && attempt < maxRetries - 1) {
          await backoff(attempt);
          continue;
        }
      } catch { /* non-JSON error body, fall through */ }
    }

    return { res, throttle };
  }
  throw new Error('Meta API: max retries exceeded after rate-limit backoff');
}

export class MetaOAuthRevokedError extends Error {
  code: number;
  constructor(message: string, code = 190) {
    super(`Meta OAuth Revoked (Error ${code}): ${message}`);
    this.name = "MetaOAuthRevokedError";
    this.code = code;
  }
}

export function filterFieldsForLevel(fields: string[], level: MetaInsightsLevel): string[] {
  return fields.filter((field) => {
    if (level === 'account') {
      if (['campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name'].includes(field)) {
        return false;
      }
    } else if (level === 'campaign') {
      if (['adset_id', 'adset_name', 'ad_id', 'ad_name'].includes(field)) {
        return false;
      }
    } else if (level === 'adset') {
      if (['ad_id', 'ad_name'].includes(field)) {
        return false;
      }
    }
    return true;
  });
}

export class MetaReportClient {
  /**
   * Synchronous insights call — works well for short date ranges.
   * For large date ranges use createAsyncReport instead.
   */
  async getInsights(
    accessToken: string,
    params: MetaInsightsParams,
  ): Promise<MetaInsightsRow[]> {
    const allRows: MetaInsightsRow[] = [];
    let afterCursor: string | null = null;

    const cleanAdAccountId = String(params.adAccountId).replace(/^act_/, "");
    const validFields = filterFieldsForLevel(params.fields, params.level);
    do {
      const url = new URL(`${META_GRAPH_BASE}/act_${cleanAdAccountId}/insights`);
      url.searchParams.set('access_token', accessToken);
      url.searchParams.set('fields', validFields.join(','));
      url.searchParams.set('level', params.level);
      url.searchParams.set('limit', String(params.limit ?? 500));

      if (params.datePreset) url.searchParams.set('date_preset', params.datePreset);
      if (params.timeRange) url.searchParams.set('time_range', JSON.stringify(params.timeRange));
      if (params.timeIncrement) url.searchParams.set('time_increment', String(params.timeIncrement));
      if (params.breakdowns?.length) url.searchParams.set('breakdowns', params.breakdowns.join(','));
      if (params.actionAttributionWindows?.length) {
        url.searchParams.set('action_attribution_windows', JSON.stringify(params.actionAttributionWindows));
      }
      if (params.filtering?.length) url.searchParams.set('filtering', JSON.stringify(params.filtering));
      if (afterCursor) url.searchParams.set('after', afterCursor);

      const { res } = await metaFetch(url);
      const json = await res.json() as {
        data: MetaInsightsRow[];
        paging?: { cursors?: { after?: string }; next?: string };
        error?: { message: string; code: number };
      };

      if (json.error) {
        if (json.error.code === 190) {
          throw new MetaOAuthRevokedError(json.error.message, json.error.code);
        }
        throw new Error(`Meta Insights error ${json.error.code}: ${json.error.message}`);
      }

      allRows.push(...(json.data ?? []));
      afterCursor = json.paging?.next ? (json.paging.cursors?.after ?? null) : null;
    } while (afterCursor && allRows.length < 500_000);

    return allRows;
  }

  /**
   * Create an async report job for large datasets or wide date ranges.
   * Returns a report_run_id to poll with checkAsyncReport.
   */
  async createAsyncReport(
    accessToken: string,
    params: MetaInsightsParams,
  ): Promise<string> {
    const cleanAdAccountId = String(params.adAccountId).replace(/^act_/, "");
    const validFields = filterFieldsForLevel(params.fields, params.level);
    const url = new URL(`${META_GRAPH_BASE}/act_${cleanAdAccountId}/insights`);

    const body = new URLSearchParams();
    body.set('access_token', accessToken);
    body.set('fields', validFields.join(','));
    body.set('level', params.level);
    body.set('limit', String(params.limit ?? 500));

    if (params.datePreset) body.set('date_preset', params.datePreset);
    if (params.timeRange) body.set('time_range', JSON.stringify(params.timeRange));
    if (params.timeIncrement) body.set('time_increment', String(params.timeIncrement));
    if (params.breakdowns?.length) body.set('breakdowns', params.breakdowns.join(','));
    if (params.actionAttributionWindows?.length) {
      body.set('action_attribution_windows', JSON.stringify(params.actionAttributionWindows));
    }
    if (params.filtering?.length) body.set('filtering', JSON.stringify(params.filtering));

    const { res } = await metaFetch(url, { method: 'POST', body });
    const json = await res.json() as { report_run_id?: string; error?: { message: string; code: number } };
    if (json.error) throw new Error(`Meta async report error ${json.error.code}: ${json.error.message}`);
    if (!json.report_run_id) throw new Error('Meta async report did not return a report_run_id');

    return json.report_run_id;
  }

  /**
   * Poll the status of an async report job.
   */
  async checkAsyncReport(accessToken: string, reportRunId: string): Promise<MetaAsyncReportStatus> {
    const url = new URL(`${META_GRAPH_BASE}/${reportRunId}`);
    url.searchParams.set('access_token', accessToken);

    const { res } = await metaFetch(url);
    const json = await res.json() as MetaAsyncReportStatus & { error?: { message: string; code: number } };
    if ((json as any).error) throw new Error(`Meta async status error ${(json as any).error.code}: ${(json as any).error.message}`);

    return json;
  }

  /**
   * Fetch results of a completed async report job.
   * Handles cursor pagination automatically.
   */
  async fetchAsyncResults(accessToken: string, reportRunId: string): Promise<MetaInsightsRow[]> {
    const allRows: MetaInsightsRow[] = [];
    let afterCursor: string | null = null;

    do {
      const url = new URL(`${META_GRAPH_BASE}/${reportRunId}/insights`);
      url.searchParams.set('access_token', accessToken);
      url.searchParams.set('limit', '500');
      if (afterCursor) url.searchParams.set('after', afterCursor);

      const { res } = await metaFetch(url);
      const json = await res.json() as {
        data: MetaInsightsRow[];
        paging?: { cursors?: { after?: string }; next?: string };
        error?: { message: string; code: number };
      };

      if (json.error) throw new Error(`Meta fetch results error ${json.error.code}: ${json.error.message}`);

      allRows.push(...(json.data ?? []));
      afterCursor = json.paging?.next ? (json.paging.cursors?.after ?? null) : null;
    } while (afterCursor && allRows.length < 500_000);

    return allRows;
  }
}

export const metaReportClient = new MetaReportClient();

// ── Default metrics and breakdowns ──────────────────────────────────────────

export const META_DEFAULT_FIELDS = [
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'ad_id',
  'ad_name',
  'account_id',
  'spend',
  'impressions',
  'reach',
  'clicks',
  'cpm',
  'cpc',
  'ctr',
  'frequency',
  'purchase_roas',
  'actions',
  'action_values',
  'cost_per_action_type',
  'date_start',
  'date_stop',
];

export const META_BREAKDOWN_OPTIONS = [
  { value: 'age', label: 'Age' },
  { value: 'gender', label: 'Gender' },
  { value: 'country', label: 'Country' },
  { value: 'region', label: 'Region' },
  { value: 'device_platform', label: 'Device Platform' },
  { value: 'publisher_platform', label: 'Publisher Platform' },
  { value: 'platform_position', label: 'Placement' },
];

export const META_LEVEL_OPTIONS: Array<{ value: MetaInsightsLevel; label: string }> = [
  { value: 'campaign', label: 'Campaign' },
  { value: 'adset', label: 'Ad Set' },
  { value: 'ad', label: 'Ad' },
  { value: 'account', label: 'Account' },
];
