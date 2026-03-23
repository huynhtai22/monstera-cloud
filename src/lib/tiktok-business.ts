/**
 * TikTok "account holder" / Login Kit OAuth (open.tiktokapis.com).
 * For Business insights, ads-related scopes, etc. — separate from TikTok Shop seller API.
 * @see https://developers.tiktok.com/doc/oauth-user-access-token-management
 */

import crypto from 'crypto';

export interface TikTokBusinessTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  open_id: string;
  scope: string;
  token_type: string;
}

function clientKey(): string {
  return (process.env.TIKTOK_BUSINESS_CLIENT_KEY || process.env.TIKTOK_BUSINESS_APP_ID || '').trim();
}

function clientSecret(): string {
  return (process.env.TIKTOK_BUSINESS_CLIENT_SECRET || process.env.TIKTOK_BUSINESS_APP_SECRET || '').trim();
}

/** Space-separated scopes as required in the authorize URL (encodeURIComponent applied by URL API). */
export function getTikTokBusinessScopes(): string {
  const raw =
    process.env.TIKTOK_BUSINESS_OAUTH_SCOPES?.trim() ||
    'user.info.basic,video.list,video.insights';
  return raw.replace(/\s+/g, ',').replace(/,+/g, ',');
}

// ── PKCE helpers ────────────────────────────────────────────────────────
/** Generate a random code_verifier (43–128 chars, URL-safe). */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** SHA-256 hash → base64url = code_challenge (S256 method). */
export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export class TikTokBusinessClient {
  /**
   * Build the authorization URL. Returns both the URL and the code_verifier
   * that MUST be stored (e.g. in a cookie) and sent again in the token exchange.
   */
  getAuthorizeUrl(
    state: string,
    redirectUri: string,
  ): { url: string; codeVerifier: string } {
    const key = clientKey();
    if (!key) throw new Error('TIKTOK_BUSINESS_CLIENT_KEY is not configured');

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
    url.searchParams.set('client_key', key);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', getTikTokBusinessScopes());
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');

    return { url: url.toString(), codeVerifier };
  }

  async exchangeCode(code: string, redirectUri: string, codeVerifier?: string): Promise<TikTokBusinessTokenResponse> {
    const key = clientKey();
    const secret = clientSecret();
    if (!key || !secret) {
      throw new Error('TIKTOK_BUSINESS_CLIENT_KEY or TIKTOK_BUSINESS_CLIENT_SECRET not configured');
    }

    const params: Record<string, string> = {
      client_key: key,
      client_secret: secret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    };

    // Include code_verifier for PKCE
    if (codeVerifier) {
      params.code_verifier = codeVerifier;
    }

    const body = new URLSearchParams(params);

    const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: body.toString(),
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (data.error || !data.access_token) {
      const desc = (data.error_description as string) || (data.message as string) || JSON.stringify(data);
      throw new Error(`TikTok Business token error: ${data.error || res.status} — ${desc}`);
    }

    return data as unknown as TikTokBusinessTokenResponse;
  }

  async refreshAccessToken(refreshToken: string): Promise<TikTokBusinessTokenResponse> {
    const key = clientKey();
    const secret = clientSecret();
    if (!key || !secret) {
      throw new Error('TIKTOK_BUSINESS_CLIENT_KEY or TIKTOK_BUSINESS_CLIENT_SECRET not configured');
    }

    const body = new URLSearchParams({
      client_key: key,
      client_secret: secret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: body.toString(),
    });

    const data = (await res.json()) as Record<string, unknown>;
    if (data.error || !data.access_token) {
      const desc = (data.error_description as string) || JSON.stringify(data);
      throw new Error(`TikTok Business refresh error: ${data.error || res.status} — ${desc}`);
    }

    return data as unknown as TikTokBusinessTokenResponse;
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
// Base: https://business-api.tiktok.com/open_api/v1.3
export class TikTokReportClient {
  private base = 'https://business-api.tiktok.com/open_api/v1.3';

  /**
   * Step 1 — Create an async report task. Returns task_id.
   */
  async createTask(accessToken: string, params: CreateReportTaskParams): Promise<string> {
    const res = await fetch(`${this.base}/report/task/create/`, {
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
  async checkTask(accessToken: string, advertiser_id: string, task_id: string): Promise<ReportTaskStatus_Response> {
    const url = new URL(`${this.base}/report/task/check/`);
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
}

export const tiktokReportClient = new TikTokReportClient();
