/**
 * Google Ads API v23 client (REST / SearchStream)
 * Docs: https://developers.google.com/google-ads/api
 *
 * Auth requires THREE things:
 *   1. OAuth 2.0 access token (from user's Google account)
 *   2. Developer Token (from ads.google.com/aw/apicenter — review required for production)
 *   3. login-customer-id header = MCC (Manager Account) customer ID
 *
 * Query language: GAQL (SQL-like), sent as POST body to SearchStream.
 * Key gotcha: cost_micros must be divided by 1,000,000 to get real currency value.
 */

const GOOGLE_ADS_API_VERSION = 'v23';
const GOOGLE_ADS_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
const GOOGLE_OAUTH_BASE = 'https://accounts.google.com/o/oauth2';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export class GoogleAdsProviderError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number, readonly code?: string) {
    super(message);
    this.name = "GoogleAdsProviderError";
  }
}

/** Application-level developer-token blocker (structured, not a leaf-account failure). */
export const GOOGLE_ADS_DEVELOPER_TOKEN_NOT_APPROVED = "DEVELOPER_TOKEN_NOT_APPROVED";

export function isGoogleAdsDeveloperTokenBlocked(error: unknown): boolean {
  if (error instanceof GoogleAdsProviderError && error.code === GOOGLE_ADS_DEVELOPER_TOKEN_NOT_APPROVED) return true;
  // Fallback for legacy/wrapped errors carrying the provider constant.
  return /DEVELOPER_TOKEN_NOT_APPROVED/i.test(error instanceof Error ? error.message : String(error ?? ""));
}

export function isGoogleAdsRetryableFailure(status: number, message: string): boolean {
  return status === 429 || status >= 500 || /resource[_ ]exhausted|rate[_ ]exceeded|quota|temporar|timeout/i.test(message);
}

/**
 * Google returns this when a customer has not completed signup or was
 * deactivated. It is an account-state result, not an OAuth or developer-token
 * problem, so it must never fall through to the standalone-account fallback.
 */
export function isGoogleAdsCustomerUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /CUSTOMER_NOT_ENABLED|customer account can't be accessed because it is not yet enabled or has been deactivated/i.test(message);
}

/** Strip the developer-token value from any provider-echoed text (defense in depth). */
function scrubDevToken(text: string): string {
  const t = developerToken();
  return t ? text.split(t).join("[REDACTED_DEVELOPER_TOKEN]") : text;
}

async function fetchGoogleAds(url: string, init: RequestInit): Promise<Response> {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      const detail = scrubDevToken((await response.clone().text()).slice(0, 1000));
      const retryable = isGoogleAdsRetryableFailure(response.status, detail);
      if (!retryable || attempt === maxAttempts - 1) {
        const code = detail.includes(GOOGLE_ADS_DEVELOPER_TOKEN_NOT_APPROVED)
          ? GOOGLE_ADS_DEVELOPER_TOKEN_NOT_APPROVED
          : undefined;
        throw new GoogleAdsProviderError(`Google Ads request failed ${response.status}: ${detail}`, retryable, response.status, code);
      }
    } catch (error) {
      if (error instanceof GoogleAdsProviderError && !error.retryable) throw error;
      if (attempt === maxAttempts - 1) {
        if (error instanceof GoogleAdsProviderError) throw error;
        throw new GoogleAdsProviderError(error instanceof Error ? error.message : "Google Ads request failed", true);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt + Math.floor(Math.random() * 200)));
  }
  throw new GoogleAdsProviderError("Google Ads request failed", true);
}

function clientId(): string {
  return (process.env.GOOGLE_ADS_CLIENT_ID || '').trim();
}

function clientSecret(): string {
  return (process.env.GOOGLE_ADS_CLIENT_SECRET || '').trim();
}

function developerToken(): string {
  return (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim();
}

// ── OAuth types ──────────────────────────────────────────────────────────────

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // seconds (~3600)
  token_type: string;
  scope: string;
  id_token?: string;
}

export interface GoogleUserInfo {
  email?: string;
  name?: string;
  picture?: string;
}

// ── Report types ─────────────────────────────────────────────────────────────

export interface GoogleAdsRow {
  [key: string]: string | number | GoogleAdsNestedField | undefined;
}

export interface GoogleAdsNestedField {
  [key: string]: string | number | undefined;
}

export interface GoogleAdsSearchStreamResult {
  results: GoogleAdsRow[];
  fieldMask?: string;
  requestId?: string;
}

// ── Normalized row type ───────────────────────────────────────────────────────
// After normalization: cost_micros ÷ 1M, nested objects flattened.
export interface NormalizedGoogleAdsRow {
  [key: string]: string | number | undefined;
  campaign_name?: string;
  campaign_status?: string;
  ad_group_name?: string;
  impressions?: number;
  clicks?: number;
  cost?: number;       // cost_micros / 1_000_000
  conversions?: number;
  all_conversions?: number;
  conversion_value?: number;
  ctr?: number;
  average_cpc?: number;
  search_impression_share?: string;
  date?: string;
}

// ── Google Ads OAuth client ──────────────────────────────────────────────────

export class GoogleAdsOAuthClient {
  /**
   * Build the Google OAuth consent URL.
   * Scopes: Google Ads API + openid / email / profile to identify the authenticating Google Account.
   */
  getAuthorizeUrl(state: string, redirectUri: string): string {
    const id = clientId();
    if (!id) throw new Error('GOOGLE_ADS_CLIENT_ID is not configured');

    const url = new URL(`${GOOGLE_OAUTH_BASE}/auth`);
    url.searchParams.set('client_id', id);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'https://www.googleapis.com/auth/adwords openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('access_type', 'offline');   // get refresh_token
    url.searchParams.set('prompt', 'consent');         // force re-consent to always get refresh_token

    return url.toString();
  }

  /**
   * Exchange an authorization code for access + refresh tokens.
   */
  async exchangeCode(code: string, redirectUri: string): Promise<GoogleTokenResponse> {
    const id = clientId();
    const secret = clientSecret();
    if (!id || !secret) throw new Error('GOOGLE_ADS_CLIENT_ID or GOOGLE_ADS_CLIENT_SECRET not configured');

    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: id,
        client_secret: secret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const json = await res.json() as GoogleTokenResponse & { error?: string; error_description?: string };
    if (json.error) throw new Error(`Google OAuth error: ${json.error}: ${json.error_description}`);

    return json;
  }

  /**
   * Refresh an expired access token using the refresh token.
   * Google refresh tokens don't expire unless explicitly revoked.
   */
  async refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
    const id = clientId();
    const secret = clientSecret();
    if (!id || !secret) throw new Error('GOOGLE_ADS_CLIENT_ID or GOOGLE_ADS_CLIENT_SECRET not configured');

    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: id,
        client_secret: secret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    const json = await res.json() as GoogleTokenResponse & { error?: string; error_description?: string };
    if (json.error) throw new Error(`Google token refresh error: ${json.error}: ${json.error_description}`);

    return json;
  }

  /**
   * Fetch authenticated user profile (email and name) using the access token.
   */
  async getUserInfo(accessToken: string): Promise<GoogleUserInfo | null> {
    try {
      const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      return await res.json() as GoogleUserInfo;
    } catch {
      return null;
    }
  }

  /**
   * Fetch the list of accessible customer accounts (linked to the MCC or directly).
   */
  async listAccessibleCustomers(accessToken: string): Promise<string[]> {
    const devToken = developerToken();
    if (!devToken) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN not configured');

    const res = await fetchGoogleAds(
      `${GOOGLE_ADS_BASE}/customers:listAccessibleCustomers`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'developer-token': devToken,
        },
      }
    );

    const json = await res.json() as {
      resourceNames?: string[];
      error?: { message: string; code: number };
    };

    if (json.error) throw new Error(`Google Ads listAccessibleCustomers error: ${json.error.message}`);

    // Resource names are like "customers/1234567890" — extract the numeric ID
    return (json.resourceNames ?? []).map((r) => r.replace('customers/', ''));
  }
}

export const googleAdsOAuthClient = new GoogleAdsOAuthClient();

// ── Google Ads report client ─────────────────────────────────────────────────

export class GoogleAdsReportClient {
  /**
   * Execute a GAQL query via SearchStream endpoint.
   * SearchStream is preferred over Search for reporting — single streaming response,
   * no pagination needed for most datasets.
   *
   * @param customerId  - The Google Ads account (customer) ID to query, WITHOUT dashes
   * @param mccId       - The MCC (Manager Account) ID — used as login-customer-id header
   * @param gaql        - GAQL query string
   */
  async searchStream(
    accessToken: string,
    customerId: string,
    gaql: string,
    mccId?: string,
  ): Promise<NormalizedGoogleAdsRow[]> {
    const devToken = developerToken();
    if (!devToken) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN not configured');

    const cleanCustomerId = customerId.replace(/-/g, '');

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': devToken,
      'Content-Type': 'application/json',
    };

    if (mccId) {
      headers['login-customer-id'] = mccId.replace(/-/g, '');
    }

    const res = await fetchGoogleAds(
      `${GOOGLE_ADS_BASE}/customers/${cleanCustomerId}/googleAds:searchStream`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: gaql }),
      }
    );

    const text = await res.text();

    // SearchStream returns a JSON array of batches
    let batches: GoogleAdsSearchStreamResult[];
    try {
      batches = JSON.parse(text);
      if (!Array.isArray(batches)) batches = [batches];
    } catch {
      throw new Error(`Google Ads SearchStream returned unexpected format: ${text.slice(0, 200)}`);
    }

    const allRows: GoogleAdsRow[] = [];
    for (const batch of batches) {
      if (batch.results) allRows.push(...batch.results);
    }

    return allRows.map(normalizeGoogleAdsRow);
  }

  /**
   * List all leaf (non-manager) customer accounts under an MCC or standalone customer.
   * Returns array of { customerId, mccId } pairs where mccId is the login-customer-id to use.
   *
   * Uses the customer_client GAQL resource which returns all child accounts.
   * For a standalone (non-MCC) account, returns just that account with itself as mccId.
   */
  async listCustomerClients(
    accessToken: string,
    rootCustomerId: string,
    options: { includeManagers?: boolean } = {},
  ): Promise<Array<{ customerId: string; mccId: string; isManager: boolean; descriptiveName: string }>> {
    const devToken = developerToken();
    if (!devToken) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN not configured');

    const cleanId = rootCustomerId.replace(/-/g, '');

    // Query customer_client to get all accounts accessible under this root
    const gaql = `
      SELECT
        customer_client.client_customer,
        customer_client.descriptive_name,
        customer_client.manager,
        customer_client.status,
        customer_client.id
      FROM customer_client
      WHERE customer_client.status = 'ENABLED'
    `;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': devToken,
      'Content-Type': 'application/json',
      'login-customer-id': cleanId,
    };

    let res: Response;
    try {
      res = await fetchGoogleAds(
      `${GOOGLE_ADS_BASE}/customers/${cleanId}/googleAds:searchStream`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: gaql }),
      }
      );
    } catch (error) {
      // A disabled customer also rejects customer_client with a 4xx. Do not
      // fabricate a standalone leaf for it: reporting would fail later with
      // CUSTOMER_NOT_ENABLED and leave the customer with a confusing error.
      if (isGoogleAdsCustomerUnavailable(error)) return [];

      // Non-manager (standalone) accounts reject customer_client; preserve the
      // intentional leaf fallback for those account shapes.
      if (error instanceof GoogleAdsProviderError && error.status && error.status < 500 && !error.retryable) {
        return [{ customerId: cleanId, mccId: cleanId, isManager: false, descriptiveName: `Customer ${cleanId}` }];
      }
      throw error;
    }

    const text = await res.text();
    let batches: any[];
    try {
      batches = JSON.parse(text);
      if (!Array.isArray(batches)) batches = [batches];
    } catch {
      // Unparseable 200 from a manager-shaped root: skip it (querying metrics
      // on a manager is guaranteed to fail with REQUESTED_METRICS_FOR_MANAGER).
      return [];
    }

    const clients: Array<{ customerId: string; mccId: string; isManager: boolean; descriptiveName: string }> = [];
    for (const batch of batches) {
      for (const row of (batch.results ?? [])) {
        const cc = row.customerClient ?? row.customer_client ?? {};
        const clientId = String(cc.id ?? cc.client_customer?.replace('customers/', '') ?? '').replace(/-/g, '');
        const isManager = cc.manager === true || cc.manager === 'true';
        const name = cc.descriptiveName ?? cc.descriptive_name ?? `Customer ${clientId}`;
        const status = String(cc.status ?? "").toUpperCase();
        if (clientId && status === "ENABLED" && (!isManager || options.includeManagers)) {
          // Leaf accounts use the root MCC as login-customer-id. Discovery can
          // also request manager rows to eliminate nested MCCs covered by an
          // ancestor manager; sync callers retain the leaf-only default.
          clients.push({ customerId: clientId, mccId: cleanId, isManager, descriptiveName: name });
        }
      }
    }

    // The customer_client query SUCCEEDS only for manager accounts. Zero leaf
    // children therefore means "manager with nothing syncable beneath it"
    // (childless MCC, or children that are all managers/disabled) — return an
    // empty set so callers skip it. Requesting metrics directly on a manager
    // fails with REQUESTED_METRICS_FOR_MANAGER.
    return clients;
  }

  /**
   * Validate and classify the IDs returned by listAccessibleCustomers before a
   * connection is persisted.
   *
   * Google returns a mixed list: manager accounts and their child customers.
   * Persisting that raw list as one connection makes the first arbitrary ID
   * look like an MCC and can collapse a separately authorised manager. Keep a
   * real manager as a root, suppress children already covered by that manager,
   * and retain standalone customers that are not covered by any manager.
   */
  async resolveEligibleCustomerRoots(
    accessToken: string,
    customerIds: string[],
  ): Promise<{
    eligibleCustomerIds: string[];
    excludedCustomerIds: string[];
    roots: Array<{
      rootCustomerId: string;
      isManager: boolean;
      customerIds: string[];
    }>;
  }> {
    const excludedCustomerIds: string[] = [];
    const inspected: Array<{
      rootCustomerId: string;
      isManager: boolean;
      customerIds: string[];
      managerCustomerIds: string[];
    }> = [];

    for (const customerId of customerIds) {
      const rootCustomerId = customerId.replace(/\D/g, "");
      if (!rootCustomerId) continue;

      const clients = await this.listCustomerClients(accessToken, rootCustomerId, { includeManagers: true });
      const leafIds = [...new Set(
        clients
          .filter((client) => !client.isManager)
          .map((client) => client.customerId.replace(/\D/g, ""))
          .filter(Boolean),
      )];
      if (leafIds.length === 0) {
        excludedCustomerIds.push(rootCustomerId);
        continue;
      }

      // listCustomerClients uses a self-leaf only for a direct, non-manager
      // customer. A successful manager query produces one or more different
      // child account IDs.
      const isManager = clients.some((client) => client.isManager) || leafIds.some((leafId) => leafId !== rootCustomerId);
      const managerCustomerIds = clients
        .filter((client) => client.isManager)
        .map((client) => client.customerId.replace(/\D/g, ""))
        // Google includes the queried manager itself at hierarchy level 0.
        // Only descendant managers cover another candidate root; treating the
        // self-row as a child suppresses every real MCC from discovery.
        .filter((managerId) => Boolean(managerId) && managerId !== rootCustomerId);
      inspected.push({ rootCustomerId, isManager, customerIds: leafIds, managerCustomerIds });
    }

    const coveredChildIds = new Set(
      inspected
        .filter((root) => root.isManager)
        .flatMap((root) => [...root.customerIds, ...root.managerCustomerIds]),
    );

    const roots = inspected.filter(
      (root) => !coveredChildIds.has(root.rootCustomerId),
    );

    return {
      eligibleCustomerIds: roots.map((root) => root.rootCustomerId),
      excludedCustomerIds,
      roots: roots.map(({ rootCustomerId, isManager, customerIds }) => ({ rootCustomerId, isManager, customerIds })),
    };
  }

  /**
   * Get campaign performance summary.
   * @param dateDuringOrBetween GAQL `DURING` preset (e.g. LAST_30_DAYS) OR `BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'`
   * @param mccId The MCC (Manager Account) ID to use as login-customer-id header.
   *              Must be the PARENT manager account if customerId is a sub-account.
   *              Leave undefined only for standalone accounts.
   */
  async getCampaignPerformance(
    accessToken: string,
    customerId: string,
    dateDuringOrBetween: string,
    mccId?: string,
  ): Promise<NormalizedGoogleAdsRow[]> {
    const dateClause = dateDuringOrBetween.trim().startsWith("BETWEEN")
      ? `segments.date ${dateDuringOrBetween.trim()}`
      : `segments.date DURING ${dateDuringOrBetween.trim()}`;
    const gaql = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        customer.currency_code,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.all_conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc,
        metrics.search_impression_share,
        segments.date
      FROM campaign
      WHERE ${dateClause}
        AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
    `;

    return this.searchStream(accessToken, customerId, gaql, mccId);
  }

  /**
   * Get ad group performance.
   */
  async getAdGroupPerformance(
    accessToken: string,
    customerId: string,
    datePeriod: string,
    mccId?: string,
  ): Promise<NormalizedGoogleAdsRow[]> {
    const gaql = `
      SELECT
        campaign.name,
        ad_group.name,
        ad_group.status,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc,
        segments.date
      FROM ad_group
      WHERE segments.date DURING ${datePeriod}
        AND ad_group.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
    `;

    return this.searchStream(accessToken, customerId, gaql, mccId);
  }

  /**
   * Get Shopping product-level performance.
   */
  async getShoppingPerformance(
    accessToken: string,
    customerId: string,
    datePeriod: string,
    mccId?: string,
  ): Promise<NormalizedGoogleAdsRow[]> {
    const gaql = `
      SELECT
        segments.product_item_id,
        segments.product_title,
        segments.product_brand,
        metrics.clicks,
        metrics.cost_micros,
        metrics.impressions,
        metrics.conversions,
        metrics.all_conversions,
        metrics.conversions_value,
        segments.date
      FROM shopping_performance_view
      WHERE segments.date DURING ${datePeriod}
        AND metrics.clicks > 0
      ORDER BY metrics.all_conversions DESC
    `;

    return this.searchStream(accessToken, customerId, gaql, mccId);
  }
}

export const googleAdsReportClient = new GoogleAdsReportClient();

// ── Normalization ─────────────────────────────────────────────────────────────

/**
 * Flatten a Google Ads row and convert cost_micros to real currency.
 * Input example: { campaign: { name: "..." }, metrics: { cost_micros: "1500000", impressions: "1000" } }
 * Output: { campaign_name: "...", cost: 1.5, impressions: 1000 }
 */
export function normalizeGoogleAdsRow(row: GoogleAdsRow): NormalizedGoogleAdsRow {
  const out: NormalizedGoogleAdsRow = {};

  for (const [section, value] of Object.entries(row)) {
    if (value === null || value === undefined) continue;

    if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [field, fieldVal] of Object.entries(value as Record<string, unknown>)) {
        // Convert camelCase to snake_case (e.g., costMicros -> cost_micros)
        const snakeField = field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        const key = `${section}_${snakeField}`.replace(/\./g, '_');

        if (snakeField === 'cost_micros' || snakeField.endsWith('_micros')) {
          // Convert micros to real currency — dividing by 1,000,000
          out[key.replace('_micros', '')] = Number(fieldVal) / 1_000_000;
        } else if (snakeField === 'average_cpc' || snakeField === 'average_cost') {
          // GAQL returns these in micros too (no _micros suffix) — convert once here.
          out[key] = Number(fieldVal) / 1_000_000;
        } else if (typeof fieldVal === 'string' && /^\d+$/.test(fieldVal)) {
          out[key] = Number(fieldVal);
        } else {
          out[key] = fieldVal as string | number;
        }
      }
    } else if (typeof value === 'string' && /^\d+$/.test(value)) {
      out[section] = Number(value);
    } else {
      out[section] = value as string | number;
    }
  }

  return out;
}

// ── GAQL date period constants ────────────────────────────────────────────────

export const GOOGLE_DATE_PERIODS = [
  { value: 'LAST_7_DAYS', label: 'Last 7 days' },
  { value: 'LAST_14_DAYS', label: 'Last 14 days' },
  { value: 'LAST_30_DAYS', label: 'Last 30 days' },
  { value: 'LAST_MONTH', label: 'Last month' },
  { value: 'THIS_MONTH', label: 'This month' },
  { value: 'LAST_BUSINESS_WEEK', label: 'Last business week' },
  { value: 'LAST_WEEK_SUN_SAT', label: 'Last week' },
];

export const GOOGLE_REPORT_TYPES = [
  { value: 'campaign', label: 'Campaign Performance' },
  { value: 'adgroup', label: 'Ad Group Performance' },
  { value: 'shopping', label: 'Shopping Products' },
];
