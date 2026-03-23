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
  refresh_token: string;
  /** Access token TTL in seconds */
  expires_in: number;
  /** Refresh token TTL in seconds */
  refresh_token_expires_in: number;
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

    return json.data as unknown as TikTokBusinessTokenResponse;
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
export type ReportTaskStatus = 'INIT' | 'RUNNING' | 'COMPLETED' | 'FAILED';

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
    const res = await fetch(`${base}/report/task/create/`, {
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

    const json = (await res.json()) as Record<string, unknown>;
    if ((json.code as number) !== 0) {
      throw new Error(`TikTok createTask error ${json.code}: ${json.message}`);
    }

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

    const res = await fetch(url.toString(), {
      headers: { 'Access-Token': accessToken },
    });

    const json = (await res.json()) as Record<string, unknown>;
    if ((json.code as number) !== 0) {
      throw new Error(`TikTok checkTask error ${json.code}: ${json.message}`);
    }

    const data = json.data as Record<string, unknown>;
    return data as unknown as ReportTaskStatus_Response;
  }

  /**
   * Step 3 — Once COMPLETED, download rows from the returned URL.
   * TikTok returns NDJSON (one JSON object per line).
   */
  async downloadRows(downloadUrl: string): Promise<ReportRow[]> {
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`TikTok report download failed: ${res.status}`);
    const text = await res.text();
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ReportRow);
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

      const res = await fetch(url.toString(), {
        headers: { 'Access-Token': accessToken },
      });

      const json = (await res.json()) as Record<string, unknown>;
      if ((json.code as number) !== 0) {
        throw new Error(`TikTok getSyncReport error ${json.code}: ${json.message}`);
      }

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
