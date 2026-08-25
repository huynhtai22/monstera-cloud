/**
 * TikTok for Business — Marketing API OAuth
 * Portal: https://business-api.tiktok.com/portal
 *
 * This is DIFFERENT from Login Kit (developers.tiktok.com).
 * Auth URL  : https://ads.tiktok.com/marketing_api/auth
 * Token URL : https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/
 * No PKCE, no scopes in the auth URL — scopes are pre-configured in the portal.
 * The callback receives `auth_code` (not `code`).
 *
 * @see https://business-api.tiktok.com/portal/docs?id=1738373164380162
 */

import { logger } from "@/lib/logger";

/** app_id from business-api.tiktok.com/portal */
function appId(): string {
  return (process.env.TIKTOK_BUSINESS_APP_ID || process.env.TIKTOK_BUSINESS_CLIENT_KEY || '').trim();
}

/** secret from business-api.tiktok.com/portal */
function appSecret(): string {
  return (process.env.TIKTOK_BUSINESS_APP_SECRET || process.env.TIKTOK_BUSINESS_CLIENT_SECRET || '').trim();
}

export interface TikTokBusinessTokenResponse {
  access_token: string;
  /**
   * Advertiser-authorized Marketing API tokens are long-lived and omit both
   * refresh_token and expires_in. TikTok account-holder OAuth is a different
   * flow and returns the short-lived, refreshable form.
   */
  refresh_token?: string;
  /** Access token TTL in seconds */
  expires_in?: number;
  /** Refresh token TTL in seconds */
  refresh_token_expires_in?: number;
  /** Advertiser accounts this token has access to */
  advertiser_ids: string[];
  scope: string;
  token_type: string;
}

export class TikTokBusinessClient {
  /**
   * Step 1 — Redirect the user here to grant access.
   * No PKCE, no scopes param — TikTok reads scopes from your portal configuration.
   */
  getAuthorizeUrl(state: string, redirectUri: string): { url: string } {
    const id = appId();
    if (!id) throw new Error('TIKTOK_BUSINESS_APP_ID is not configured');

    const url = new URL('https://ads.tiktok.com/marketing_api/auth');
    url.searchParams.set('app_id', id);
    url.searchParams.set('state', state);
    url.searchParams.set('redirect_uri', redirectUri);

    return { url: url.toString() };
  }

  /**
   * Step 2 — Exchange the `auth_code` (NOT `code`) returned by TikTok.
   * Uses JSON body, endpoint on business-api.tiktok.com.
   */
  async exchangeCode(authCode: string): Promise<TikTokBusinessTokenResponse> {
    const id = appId();
    const secret = appSecret();
    if (!id || !secret) {
      throw new Error('TIKTOK_BUSINESS_APP_ID or TIKTOK_BUSINESS_APP_SECRET not configured');
    }

    const res = await fetch(
      'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: id, secret, auth_code: authCode }),
      }
    );

    const json = (await res.json()) as Record<string, unknown>;
    if ((json.code as number) !== 0 || !json.data) {
      const msg = (json.message as string) || JSON.stringify(json);
      throw new Error(`TikTok Marketing API token error ${json.code}: ${msg}`);
    }

    // The advertiser authorization flow returns a long-lived token. It normally
    // omits refresh_token and expires_in; TikTok account-holder OAuth is a
    // separate flow that returns the refreshable variant. Log only field
    // presence if a malformed hybrid response arrives—never token values,
    // authorization codes, headers, or the response body.
    const tokenData = json.data as Record<string, unknown>;
    const hasAccessToken =
      typeof tokenData.access_token === "string" && tokenData.access_token.length > 0;
    const hasRefreshToken =
      typeof tokenData.refresh_token === "string" && tokenData.refresh_token.length > 0;
    const expiresIn = Number(tokenData.expires_in);
    const hasExpiresIn = Number.isFinite(expiresIn) && expiresIn > 0;

    const isLongLivedAdvertiserToken = !hasRefreshToken && !hasExpiresIn;
    const isRefreshableToken = hasRefreshToken && hasExpiresIn;

    if (!hasAccessToken || (!isLongLivedAdvertiserToken && !isRefreshableToken)) {
      logger.warn("[TikTok OAuth] Invalid token response shape", {
        hasAccessToken,
        hasRefreshToken,
        hasExpiresIn,
      });
      throw new Error(
        "TikTok authorization returned an invalid token response. The source was not connected; reconnect TikTok Ads."
      );
    }

    return tokenData as unknown as TikTokBusinessTokenResponse;
  }

  /** Refresh an expired access token. */
  async refreshAccessToken(refreshToken: string): Promise<TikTokBusinessTokenResponse> {
    const id = appId();
    const secret = appSecret();
    if (!id || !secret) {
      throw new Error('TIKTOK_BUSINESS_APP_ID or TIKTOK_BUSINESS_APP_SECRET not configured');
    }

    const res = await fetch(
      'https://business-api.tiktok.com/open_api/v1.3/oauth2/refresh_token/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: id, secret, refresh_token: refreshToken }),
      }
    );

    const json = (await res.json()) as Record<string, unknown>;
    if ((json.code as number) !== 0 || !json.data) {
      const msg = (json.message as string) || JSON.stringify(json);
      throw new Error(`TikTok Marketing API refresh error ${json.code}: ${msg}`);
    }

    return json.data as unknown as TikTokBusinessTokenResponse;
  }
}

export const tiktokBusinessClient = new TikTokBusinessClient();

// ── Async Report types ───────────────────────────────────────────────────────

export type ReportType = 'BASIC' | 'AUDIENCE' | 'PLAYABLE_MATERIAL' | 'CATALOG';
export type DataLevel = 'AUCTION_ADVERTISER' | 'AUCTION_CAMPAIGN' | 'AUCTION_ADGROUP' | 'AUCTION_AD';
export type ReportTaskStatus = 'INIT' | 'QUEUING' | 'PROCESSING' | 'RUNNING' | 'SUCCESS' | 'COMPLETED' | 'FAILED' | 'CANCELED';

export class TikTokProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TikTokProviderError";
  }
}

/** TikTok quotas are endpoint/app-specific; never assume one global QPS value. */
export function isTikTokRetryableFailure(status: number, code: unknown, message: unknown): boolean {
  return status === 429 || status >= 500 || /rate[ _-]?limit|quota|throttl|too many|temporar|timeout/i.test(`${code ?? ""} ${message ?? ""}`);
}

function retryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/**
 * Retry non-JSON report assets (the async report download URL) with the same
 * bounded quota/server policy used by the JSON task endpoints.
 */
async function fetchTikTokResponse(url: string, init: RequestInit = {}): Promise<Response> {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
        continue;
      }
      throw new TikTokProviderError(error instanceof Error ? error.message : "TikTok request failed", true);
    }

    if (response.ok) return response;

    const body = await response.clone().json().catch(() => ({})) as Record<string, unknown>;
    const message = String(body.message ?? `TikTok request failed with HTTP ${response.status}`);
    const retryable = isTikTokRetryableFailure(response.status, body.code, message);
    if (!retryable || attempt === maxAttempts - 1) {
      throw new TikTokProviderError(`TikTok API error ${body.code ?? response.status}: ${message}`, retryable, response.status);
    }

    const delay = retryAfterMs(response.headers.get("retry-after")) ?? (500 * 2 ** attempt + Math.floor(Math.random() * 200));
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new TikTokProviderError("TikTok request failed", true);
}

async function fetchTikTokJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
        continue;
      }
      throw new TikTokProviderError(error instanceof Error ? error.message : "TikTok request failed", true);
    }

    const json = await response.json().catch(() => ({})) as Record<string, unknown>;
    const failed = !response.ok || json.code !== 0;
    if (!failed) return json;

    const message = String(json.message ?? `TikTok request failed with HTTP ${response.status}`);
    const retryable = isTikTokRetryableFailure(response.status, json.code, message);
    if (!retryable || attempt === maxAttempts - 1) {
      throw new TikTokProviderError(`TikTok API error ${json.code ?? response.status}: ${message}`, retryable, response.status);
    }

    const delay = retryAfterMs(response.headers.get("retry-after")) ?? (500 * 2 ** attempt + Math.floor(Math.random() * 200));
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new TikTokProviderError("TikTok request failed", true);
}

export interface CreateReportTaskParams {
  advertiser_id: string;
  report_type: ReportType;
  data_level: DataLevel;
  dimensions: string[];
  metrics: string[];
  start_date: string;  // YYYY-MM-DD
  end_date: string;    // YYYY-MM-DD
  page_size?: number;
}

/**
 * TikTok accepts at most four dimensions per report request. Keep warehouse
 * imports at campaign granularity: ad-group dimensions are invalid alongside
 * the campaign dimensions and make the API reject the whole request.
 */
export const TIKTOK_CAMPAIGN_REPORT_DIMENSIONS = [
  "campaign_id",
  "campaign_name",
  "stat_time_day",
] as const;

export interface ReportTaskStatus_Response {
  task_id: string;
  status: ReportTaskStatus;
  create_time?: string;
  complete_time?: string;
  url?: string;          // download URL when COMPLETED
}

export interface ReportRow {
  dimensions: Record<string, string | number>;
  metrics: Record<string, string | number>;
}

// ── Async Report methods (Marketing API v1.3) ────────────────────────────────
// Production : https://business-api.tiktok.com/open_api/v1.3
// Sandbox    : https://sandbox-ads.tiktok.com/open_api/v1.3
export class TikTokReportClient {
  private getBase(sandbox = false): string {
    return sandbox
      ? 'https://sandbox-ads.tiktok.com/open_api/v1.3'
      : 'https://business-api.tiktok.com/open_api/v1.3';
  }

  /**
   * Step 1 — Create an async report task. Returns task_id.
   */
  async createTask(accessToken: string, params: CreateReportTaskParams, sandbox = false): Promise<string> {
    const base = this.getBase(sandbox);
    const json = await fetchTikTokJson(`${base}/report/task/create/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': accessToken,
      },
      body: JSON.stringify({
        advertiser_id: params.advertiser_id,
        report_type: params.report_type,
        data_level: params.data_level,
        dimensions: params.dimensions,
        metrics: params.metrics,
        start_date: params.start_date,
        end_date: params.end_date,
        page_size: params.page_size ?? 1000,
        lifetime: false,
        query_lifetime: false,
      }),
    });

    const data = json.data as Record<string, unknown>;
    return data.task_id as string;
  }

  /**
   * Step 2 — Poll task status. Returns status + download URL when COMPLETED.
   */
  async checkTask(accessToken: string, advertiser_id: string, task_id: string, sandbox = false): Promise<ReportTaskStatus_Response> {
    const base = this.getBase(sandbox);
    const url = new URL(`${base}/report/task/check/`);
    url.searchParams.set('advertiser_id', advertiser_id);
    url.searchParams.set('task_id', task_id);

    const json = await fetchTikTokJson(url.toString(), {
      headers: { 'Access-Token': accessToken },
    });

    const data = json.data as Record<string, unknown>;
    return data as unknown as ReportTaskStatus_Response;
  }

  /**
   * Parse NDJSON (one JSON object per line) or CSV report text.
   */
  parseReportText(text: string): ReportRow[] {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return [];

    const rows: ReportRow[] = [];

    // Format 1: NDJSON or JSON lines
    if (lines[0].startsWith('{')) {
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.dimensions || parsed.metrics) {
            rows.push(parsed as ReportRow);
          } else {
            rows.push({
              dimensions: {
                campaign_id: String(parsed.campaign_id ?? ''),
                campaign_name: String(parsed.campaign_name ?? ''),
                adgroup_id: String(parsed.adgroup_id ?? ''),
                adgroup_name: String(parsed.adgroup_name ?? ''),
                stat_time_day: String(parsed.stat_time_day ?? parsed.date ?? ''),
              },
              metrics: {
                impression: parsed.impression ?? parsed.impressions ?? 0,
                click: parsed.click ?? parsed.clicks ?? 0,
                spend: parsed.spend ?? parsed.cost ?? 0,
                cpc: parsed.cpc ?? 0,
                ctr: parsed.ctr ?? 0,
                conversion: parsed.conversion ?? parsed.conversions ?? 0,
                revenue: parsed.revenue ?? parsed.conversion_value ?? 0,
                roas: parsed.roas ?? 0,
              },
            });
          }
        } catch {
          // ignore corrupted line
        }
      }
    } else {
      // Format 2: CSV format
      const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        const rowObj: Record<string, string> = {};
        header.forEach((h, idx) => {
          rowObj[h] = parts[idx]?.trim() ?? '';
        });
        rows.push({
          dimensions: {
            campaign_id: rowObj.campaign_id || parts[0] || '',
            campaign_name: rowObj.campaign_name || parts[1] || '',
            adgroup_id: rowObj.adgroup_id || parts[2] || '',
            adgroup_name: rowObj.adgroup_name || parts[3] || '',
            stat_time_day: rowObj.stat_time_day || rowObj.date || parts[4] || '',
          },
          metrics: {
            impression: rowObj.impression || rowObj.impressions || parts[5] || '0',
            click: rowObj.click || rowObj.clicks || parts[6] || '0',
            spend: rowObj.spend || rowObj.cost || parts[7] || '0',
            cpc: rowObj.cpc || parts[8] || '0',
            ctr: rowObj.ctr || parts[9] || '0',
            conversion: rowObj.conversion || rowObj.conversions || parts[10] || '0',
            revenue: rowObj.revenue || rowObj.conversion_value || parts[11] || '0',
            roas: rowObj.roas || parts[12] || '0',
          },
        });
      }
    }

    return rows;
  }

  /**
   * Step 3 — Once SUCCESS, download rows from the returned URL.
   * TikTok returns NDJSON (one JSON object per line) or CSV depending on export type.
   */
  async downloadRows(downloadUrl: string): Promise<ReportRow[]> {
    const res = await fetchTikTokResponse(downloadUrl);
    const text = await res.text();
    return this.parseReportText(text);
  }

  /**
   * Sandbox-only: synchronous report via /report/integrated/get/.
   * Async tasks (createTask) are not supported in the sandbox environment (error 40009).
   * Fetches all pages and returns a flat array of rows.
   */
  async getSyncReport(
    accessToken: string,
    params: CreateReportTaskParams,
  ): Promise<ReportRow[]> {
    const base = this.getBase(true); // always sandbox URL
    const allRows: ReportRow[] = [];
    let page = 1;
    const pageSize = Math.min(params.page_size ?? 100, 1000);

    while (true) {
      const url = new URL(`${base}/report/integrated/get/`);
      url.searchParams.set('advertiser_id', params.advertiser_id);
      url.searchParams.set('report_type', params.report_type);
      url.searchParams.set('data_level', params.data_level);
      url.searchParams.set('dimensions', JSON.stringify(params.dimensions));
      url.searchParams.set('metrics', JSON.stringify(params.metrics));
      url.searchParams.set('start_date', params.start_date);
      url.searchParams.set('end_date', params.end_date);
      url.searchParams.set('page', String(page));
      url.searchParams.set('page_size', String(pageSize));

      const json = await fetchTikTokJson(url.toString(), {
        headers: { 'Access-Token': accessToken },
      });

      const data = json.data as Record<string, unknown>;
      const list = (data.list as ReportRow[]) ?? [];
      allRows.push(...list);

      const pageInfo = data.page_info as Record<string, number> | undefined;
      const totalPage = pageInfo?.total_page ?? 1;
      if (page >= totalPage) break;
      page++;
    }

    return allRows;
  }
}

export const tiktokReportClient = new TikTokReportClient();
