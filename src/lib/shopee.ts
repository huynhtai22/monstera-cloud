/**
 * Shopee Open Platform v2 API Client
 * @see https://open.shopee.com/developer-guide/12
 *
 * Auth flow:
 *   1. Redirect seller to /api/v2/shop/auth_partner (with HMAC-SHA256 signature)
 *   2. Seller authorises → callback receives `code` + `shop_id`
 *   3. Exchange code for access_token + refresh_token
 *   4. Access token TTL: 4 hours / Refresh token TTL: 30 days
 *
 * Every API call requires HMAC-SHA256 signature:
 *   Auth APIs : sign( partner_id + api_path + timestamp )
 *   Shop APIs : sign( partner_id + api_path + timestamp + access_token + shop_id )
 */

import crypto from "crypto";
import prisma from "@/lib/prisma";
import { encrypt, safeDecrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { SHOPEE_SANDBOX_OPEN_API_HOST } from "@/lib/shopee-env";
import {
  accessTokenNeedsRefresh,
  normalizeStoredShopeeCreds,
  serializeShopeeStoredCreds,
  SHOPEE_DEFAULT_EXPIRE_IN_SEC,
} from "@/lib/shopee-credential-utils";

/**
 * Shopee returns successful fields either at the top level or nested under `response`.
 * Without unwrapping, `access_token` is missing and callers mis-handle the payload.
 */
function unwrapShopeePayload(json: unknown): Record<string, unknown> {
  if (!json || typeof json !== "object") return {};
  const o = json as Record<string, unknown>;
  const inner = o.response;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return { ...o, ...(inner as Record<string, unknown>) };
  }
  return o;
}

/** True when Shopee set a non-empty `error` code (empty string means success). */
function shopeeApiHasError(payload: Record<string, unknown>): boolean {
  const err = payload.error;
  if (err == null) return false;
  if (typeof err === "string") return err.length > 0;
  return Boolean(err);
}

function assertShopeeTokenPayload(
  payload: Record<string, unknown>,
  context: string,
  fallbackShopId?: number
): ShopeeTokenResponse {
  const access = payload.access_token;
  if (typeof access !== "string" || !access) {
    throw new Error(
      `${context}: missing access_token after unwrap (keys: ${Object.keys(payload).join(", ")})`
    );
  }

  const rawShopIdList = payload.shop_id_list;
  const listShopId = Array.isArray(rawShopIdList) && rawShopIdList.length > 0 ? Number(rawShopIdList[0]) : undefined;
  const directShopId = payload.shop_id != null ? Number(payload.shop_id) : undefined;
  const resolvedShopId = (Number.isFinite(directShopId) && directShopId! > 0)
    ? directShopId!
    : (Number.isFinite(listShopId) && listShopId! > 0)
      ? listShopId!
      : (fallbackShopId && Number.isFinite(fallbackShopId) && fallbackShopId > 0)
        ? fallbackShopId
        : 0;

  return {
    access_token: String(payload.access_token),
    refresh_token: String(payload.refresh_token || ""),
    expire_in: Number(payload.expire_in || 14400),
    shop_id: resolvedShopId,
    merchant_id_list: Array.isArray(payload.merchant_id_list) ? payload.merchant_id_list.map(Number) : undefined,
  };
}

/** Trim, strip BOM, and remove a single layer of wrapping quotes (common when pasting into host env UIs). */
function normalizePartnerEnvValue(raw: string): string {
  let v = raw.trim().replace(/^\uFEFF/, "");
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

import { getShopeeActiveConfig } from "@/lib/shopee-env";

/** Decimal digits only — used in the HMAC base string and in query params (avoids Number precision edge cases). */
function partnerIdString(sandbox = false): string {
  const cfg = getShopeeActiveConfig(sandbox);
  if (!cfg.partnerId) throw new Error("Shopee partner ID is not configured");
  if (!/^\d+$/.test(cfg.partnerId)) {
    throw new Error("Shopee partner ID must be a decimal integer string");
  }
  return cfg.partnerId;
}

function partnerId(sandbox = false): number {
  const id = partnerIdString(sandbox);
  const n = Number(id);
  if (!Number.isSafeInteger(n)) {
    throw new Error("Shopee partner ID is outside safe integer range; contact support");
  }
  return n;
}

function partnerKey(sandbox = false): string {
  const cfg = getShopeeActiveConfig(sandbox);
  if (!cfg.partnerKey) throw new Error("Shopee partner key is not configured");
  return cfg.partnerKey;
}

/** Same UTF-8 secret as API signing; used by `POST /api/webhooks/shopee` body HMAC. */
export function shopeePartnerKeySecretForWebhook(): string {
  return partnerKey(false);
}

function getHost(sandbox = false): string {
  return getShopeeActiveConfig(sandbox).apiBaseUrl;
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/** HMAC-SHA256 hex signature for auth APIs (no access_token). */
function signAuth(path: string, timestamp: number, sandbox = false): string {
  const base = `${partnerIdString(sandbox)}${path}${timestamp}`;
  return crypto.createHmac("sha256", partnerKey(sandbox)).update(base).digest("hex");
}

/** HMAC-SHA256 hex signature for shop-level APIs. */
function signShop(
  path: string,
  timestamp: number,
  accessToken: string,
  shopId: number,
  sandbox = false
): string {
  const base = `${partnerIdString(sandbox)}${path}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac("sha256", partnerKey(sandbox)).update(base).digest("hex");
}

// ── OAuth ─────────────────────────────────────────────────────────────────────

export interface ShopeeTokenResponse {
  access_token: string;
  refresh_token: string;
  expire_in: number; // seconds (typically 14400 = 4h)
  shop_id: number;
  /** Returned only on first token exchange, may be empty on refresh */
  merchant_id_list?: number[];
}

export class ShopeeClient {
  /**
   * Step 1 — Generate the auth URL that the seller will visit.
   * @param redirectUri Where Shopee sends the seller after granting access
   * @param state Opaque value passed through (workspace id)
   */
  getAuthorizeUrl(redirectUri: string, state: string, sandbox = false): string {
    const config = getShopeeActiveConfig(sandbox);
    const path = "/api/v2/shop/auth_partner";
    const ts = nowUnix();
    const sign = signAuth(path, ts, sandbox);
    const host = config.apiBaseUrl;
    const finalRedirect = redirectUri || config.redirectUrl;

    // Parameter order matches standard Shopee examples (partner_id → timestamp → sign → redirect).
    const q = new URLSearchParams();
    q.set("partner_id", config.partnerId);
    q.set("timestamp", String(ts));
    q.set("sign", sign);
    q.set("redirect", finalRedirect);
    if (state) {
      q.set("state", state);
    }
    return `${host}${path}?${q.toString()}`;
  }

  /**
   * Step 2 — Exchange the auth `code` + `shop_id` for tokens.
   */
  async exchangeCode(
    code: string,
    shopId: number,
    sandbox = false
  ): Promise<ShopeeTokenResponse> {
    const config = getShopeeActiveConfig(sandbox);
    const path = "/api/v2/auth/token/get";
    const ts = nowUnix();
    const sign = signAuth(path, ts, sandbox);
    const host = config.apiBaseUrl;

    const q = new URLSearchParams();
    q.set("partner_id", config.partnerId);
    q.set("timestamp", String(ts));
    q.set("sign", sign);

    const res = await fetch(`${host}${path}?${q.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        shop_id: shopId,
        partner_id: Number(config.partnerId),
      }),
    });

    const raw = await res.json();
    const json = unwrapShopeePayload(raw);
    if (shopeeApiHasError(json)) {
      throw new Error(
        `Shopee token error: ${String(json.error ?? "")} — ${String(json.message ?? "")}`
      );
    }
    return assertShopeeTokenPayload(json, "Shopee token/get", shopId);
  }

  /**
   * Refresh an expired access token.
   */
  async refreshAccessToken(
    refreshToken: string,
    shopId: number,
    sandbox = false
  ): Promise<ShopeeTokenResponse> {
    const config = getShopeeActiveConfig(sandbox);
    const path = "/api/v2/auth/access_token/get";
    const ts = nowUnix();
    const sign = signAuth(path, ts, sandbox);
    const host = config.apiBaseUrl;

    const q = new URLSearchParams();
    q.set("partner_id", config.partnerId);
    q.set("timestamp", String(ts));
    q.set("sign", sign);

    const res = await fetch(`${host}${path}?${q.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refresh_token: refreshToken,
        shop_id: shopId,
        partner_id: Number(config.partnerId),
      }),
    });

    const raw = await res.json();
    const json = unwrapShopeePayload(raw);
    if (shopeeApiHasError(json)) {
      throw new Error(
        `Shopee refresh error: ${String(json.error ?? "")} — ${String(json.message ?? "")}`
      );
    }
    return assertShopeeTokenPayload(json, "Shopee access_token/get", shopId);
  }
}

export const shopeeClient = new ShopeeClient();

// ── Shop-level API helpers ────────────────────────────────────────────────────

/** Options for shop-level signed GETs (orders, ads, etc.). */
export interface ShopeeApiOptions {
  accessToken: string;
  shopId: number;
  sandbox?: boolean;
}

/** Bounded transport retry for genuinely transient Shopee failures only. */
const SHOPEE_TRANSPORT_MAX_ATTEMPTS = 3;

function isShopeeTransientHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function shopeeGet(
  path: string,
  params: Record<string, string>,
  opts: ShopeeApiOptions
): Promise<any> {
  const isSb = Boolean(opts.sandbox);
  const host = getHost(isSb);

  // Each attempt signs with a fresh timestamp; auth/signature and business
  // errors are never retried (they throw past this loop).
  let lastNetworkError: unknown;
  for (let attempt = 0; attempt < SHOPEE_TRANSPORT_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200)));
    }
    const ts = nowUnix();
    const sign = signShop(path, ts, opts.accessToken, opts.shopId, isSb);
    const q = new URLSearchParams();
    q.set("partner_id", partnerIdString(isSb));
    q.set("timestamp", String(ts));
    q.set("access_token", opts.accessToken);
    q.set("shop_id", String(opts.shopId));
    q.set("sign", sign);
    for (const [k, v] of Object.entries(params)) {
      q.set(k, v);
    }

    let res: Response;
    try {
      res = await fetch(`${host}${path}?${q.toString()}`);
    } catch (networkError) {
      // Timeout/reset-style failures are retryable; a sign/auth problem throws
      // elsewhere and never reaches this loop's error branches.
      lastNetworkError = networkError;
      continue;
    }
    if (isShopeeTransientHttpStatus(res.status) && attempt < SHOPEE_TRANSPORT_MAX_ATTEMPTS - 1) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30_000)
        : 500 * 2 ** attempt + Math.floor(Math.random() * 200);
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }
    const rawJson = await res.json();
  const json = unwrapShopeePayload(rawJson);
  if (shopeeApiHasError(json)) {
    const errCode = String(json.error ?? "");
    const msg = String(json.message ?? "");
    const rid =
      json.request_id != null ? String(json.request_id) : "";
    logShopeeShopApiFailure(path, errCode, msg, rid);
    const ridHint = rid ? ` request_id=${rid}` : "";
    throw new Error(
      `Shopee API ${path} error: ${errCode} — ${msg}${ridHint}`
    );
  }
  return json;
  }
  throw new Error(
    `Shopee API ${path} error: network — ${lastNetworkError instanceof Error ? lastNetworkError.message : "transport failed"}`
  );
}

/** Extra context for Ads / sandbox support (IP allowlist, permission, Wrong sign). */
function logShopeeShopApiFailure(
  path: string,
  errorCode: string,
  message: string,
  requestId: string
): void {
  const code = errorCode.toLowerCase();
  const msg = message.toLowerCase();
  const adsPath = path.includes("/api/v2/ads/");
  const hintParts: string[] = [];
  if (
    code.includes("error_sign") ||
    msg.includes("wrong sign") ||
    msg.includes("error_sign")
  ) {
    hintParts.push(
      "Signature/env mismatch: confirm SHOPEE_PARTNER_ID/KEY match the environment, use sandbox host with sandbox keys, and api_path in sign matches the request path."
    );
  }
  if (
    code.includes("permission") ||
    msg.includes("permission") ||
    code.includes("error_auth")
  ) {
    hintParts.push(
      "Permission/auth: ensure the Open Platform app has Ads/Marketing API access and the shop token was issued after that permission; sellers may need to reconnect."
    );
  }
  if (code.includes("rate_limit") || msg.includes("rate_limit")) {
    hintParts.push("Rate limit: reduce sync frequency or chunk date ranges.");
  }
  if (adsPath && hintParts.length === 0) {
    hintParts.push(
      "Ads API: verify Partner Center ticket approval, app type (e.g. Marketing/Ads Service), and sandbox IP allowlist if using test environment."
    );
  }
  logger.warn(`[Shopee] ${path} failed`, {
    error: errorCode,
    message,
    requestId: requestId || undefined,
    hints: hintParts,
  });
}

// ── Data methods ──────────────────────────────────────────────────────────────

export class ShopeeDataClient {
  /** Get basic shop information. */
  async getShopInfo(opts: ShopeeApiOptions): Promise<ShopeeShopInfo> {
    const raw = await shopeeGet("/api/v2/shop/get_shop_info", {}, opts);
    const resp = (raw.response || raw) as Record<string, unknown>;
    return {
      shop_name: String(resp.shop_name || resp.shopName || `Shop ${opts.shopId}`),
      region: String(resp.region || "").toUpperCase().trim(),
      status: String(resp.status || "NORMAL"),
      auth_time: Number(resp.auth_time || 0),
      expire_time: Number(resp.expire_time || 0),
      merchant_id: resp.merchant_id != null ? Number(resp.merchant_id) : undefined,
      is_cb: Boolean(resp.is_cb),
      is_sip: resp.is_sip != null ? Boolean(resp.is_sip) : undefined,
      sip_affi_shops: Array.isArray(resp.sip_affi_shops) ? (resp.sip_affi_shops as any) : undefined,
      is_3pf: resp.is_3pf != null ? Boolean(resp.is_3pf) : undefined,
    };
  }

  /**
   * List products (paginated). Returns item_id list — use getItemBaseInfo for details.
   * @param offset 0-based pagination offset
   * @param pageSize max 100
   * @param itemStatus NORMAL | BANNED | UNLIST | etc.
   */
  async getItemList(
    opts: ShopeeApiOptions,
    offset = 0,
    pageSize = 50,
    itemStatus = "NORMAL"
  ) {
    return shopeeGet("/api/v2/product/get_item_list", {
      offset: String(offset),
      page_size: String(Math.min(pageSize, 100)),
      item_status: itemStatus,
    }, opts);
  }

  /**
   * Get detailed info for up to 50 items.
   */
  async getItemBaseInfo(opts: ShopeeApiOptions, itemIds: number[]) {
    return shopeeGet("/api/v2/product/get_item_base_info", {
      item_id_list: itemIds.join(","),
    }, opts);
  }

  /**
   * List orders (paginated by time range).
   * @param timeFrom Unix timestamp
   * @param timeTo Unix timestamp
   * @param cursor Empty string for first page, then use `response.next_cursor`
   */
  async getOrderList(
    opts: ShopeeApiOptions,
    timeFrom: number,
    timeTo: number,
    cursor = "",
    pageSize = 50,
    orderStatus = "ALL"
  ) {
    // Shopee strictly requires: time_to > time_from and time_to - time_from <= 15 days (15 * 86400)
    const safeTimeTo = timeTo > timeFrom ? Math.min(timeTo, timeFrom + 14 * 86400) : timeFrom + 86400;
    const params: Record<string, string> = {
      time_range_field: "create_time",
      time_from: String(timeFrom),
      time_to: String(safeTimeTo),
      page_size: String(Math.min(pageSize, 100)),
      order_status: orderStatus,
    };
    if (cursor) params.cursor = cursor;
    return shopeeGet("/api/v2/order/get_order_list", params, opts);
  }

  /**
   * Get full details for up to 50 orders.
   */
  async getOrderDetail(
    opts: ShopeeApiOptions,
    orderSnList: string[],
    responseFields?: string[]
  ) {
    const params: Record<string, string> = {
      order_sn_list: orderSnList.join(","),
    };
    if (responseFields) {
      params.response_optional_fields = responseFields.join(",");
    }
    return shopeeGet("/api/v2/order/get_order_detail", params, opts);
  }

  /**
   * Get shop performance (escrow detail for a single order).
   */
  async getEscrowDetail(opts: ShopeeApiOptions, orderSn: string) {
    return shopeeGet("/api/v2/payment/get_escrow_detail", {
      order_sn: orderSn,
    }, opts);
  }
}

export const shopeeDataClient = new ShopeeDataClient();

// ── Shopee Ads (v2.ads) — Product & Shop Performance ─────────────────────────
// Requires Open Platform app permission for Ads/Marketing APIs.
// Date strings for request params use DD-MM-YYYY per Shopee Ads API docs.

export const ADS_PATH_PRODUCT_CAMPAIGN_ID_LIST = "/api/v2/ads/get_product_level_campaign_id_list";
export const ADS_PATH_PRODUCT_CAMPAIGN_SETTING = "/api/v2/ads/get_product_level_campaign_setting_info";
export const ADS_PATH_PRODUCT_CAMPAIGN_PERFORMANCE = "/api/v2/ads/get_product_campaign_daily_performance";
export const ADS_PATH_CPC_DAILY = "/api/v2/ads/get_all_cpc_ads_daily_performance";
export const ADS_PATH_CPC_HOURLY = "/api/v2/ads/get_all_cpc_ads_hourly_performance";

/** Convert YYYY-MM-DD → DD-MM-YYYY for Shopee Ads query params. */
export function shopeeAdsDateParam(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) throw new Error(`Invalid Shopee ads date (expected YYYY-MM-DD): ${ymd}`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export interface ShopeeShopInfo {
  shop_name: string;
  region: string;
  status: string;
  auth_time: number;
  expire_time: number;
  merchant_id?: number;
  is_cb: boolean;
  is_sip?: boolean;
  sip_affi_shops?: Array<{ shop_id: number; region: string }>;
  is_3pf?: boolean;
}

export interface ShopeeKeywordSetting {
  keyword: string;
  match_type: "broad" | "exact" | string;
  status: string;
  bid_price: number;
}

export interface ShopeeProductCampaignSetting {
  campaign_id: number;
  campaign_name: string;
  campaign_status: string;
  ad_type: string;
  placement?: string;
  budget?: number;
  start_time?: number;
  end_time?: number;
  bidding_method?: string; // auto | manual
  roas_target?: number;
  item_id_list?: number[];
  item_id?: number;
  item_name?: string;
  keyword_list?: ShopeeKeywordSetting[];
  discovery_placement_settings?: Record<string, unknown>;
}

export interface ShopeeProductCampaignDailyMetric {
  date: string; // DD-MM-YYYY or YYYY-MM-DD
  campaign_id: number;
  campaign_name?: string;
  item_id?: number;
  item_name?: string;
  ad_type?: string;
  impression: number;
  clicks: number;
  ctr: number;
  expense: number;
  broad_order: number;
  broad_order_amount: number; // units sold
  broad_gmv: number;
  broad_roas: number;
  broad_cir: number; // ACOS
  broad_cr: number;
  broad_cost_per_conversion?: number;
  direct_order: number;
  direct_order_amount: number;
  direct_gmv: number;
  direct_roas: number;
  direct_cir: number;
  direct_cr: number;
  direct_cost_per_conversion?: number;
  raw?: Record<string, unknown>;
}

export interface ShopeeAdsDailyPerformanceResult {
  rows: unknown[];
  /** How rows were loaded — useful when debugging Shopee `error_param` / param names. */
  mode: "range" | "per_day";
  perDayErrors?: string[];
}

export function chunkDateRangeIntoMonths(
  sinceYmd: string,
  untilYmd: string,
  maxDays = 30
): Array<{ since: string; until: string }> {
  const chunks: Array<{ since: string; until: string }> = [];
  const start = parseYmdUtc(sinceYmd);
  const end = parseYmdUtc(untilYmd);

  if (start.getTime() > end.getTime()) {
    return [{ since: sinceYmd, until: untilYmd }];
  }

  let curr = new Date(start.getTime());
  while (curr.getTime() <= end.getTime()) {
    const chunkStart = curr.toISOString().slice(0, 10);
    const nextEndMs = Math.min(
      curr.getTime() + (maxDays - 1) * 86400000,
      end.getTime()
    );
    const chunkEnd = new Date(nextEndMs).toISOString().slice(0, 10);
    chunks.push({ since: chunkStart, until: chunkEnd });
    curr = new Date(nextEndMs + 86400000);
  }
  return chunks;
}

export class ShopeeAdsClient {
  /**
   * 1. Discover product advertising campaign IDs (paginated).
   * GET /api/v2/ads/get_product_level_campaign_id_list
   */
  async getProductLevelCampaignIdList(
    opts: ShopeeApiOptions,
    params?: { ad_type?: string; offset?: number; page_size?: number }
  ): Promise<{ campaign_id_list: number[]; total_count: number; has_more: boolean }> {
    const q: Record<string, string> = {
      offset: String(params?.offset ?? 0),
      page_size: String(Math.min(params?.page_size ?? 100, 100)),
    };
    if (params?.ad_type) {
      q.ad_type = params.ad_type;
    }
    const json = await shopeeGet(ADS_PATH_PRODUCT_CAMPAIGN_ID_LIST, q, opts);
    const resp = (json.response || json) as Record<string, unknown>;
    const listRaw = resp.campaign_id_list || resp.campaign_ids || resp.list || [];
    const campaign_id_list = Array.isArray(listRaw)
      ? listRaw.map((id) => (typeof id === "object" && id !== null ? Number((id as any).campaign_id || id) : Number(id))).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    const total_count = Number(resp.total_count || campaign_id_list.length);
    const has_more = Boolean(resp.has_more ?? (params?.offset ?? 0) + campaign_id_list.length < total_count);
    return { campaign_id_list, total_count, has_more };
  }

  /**
   * Helper to retrieve all product campaign IDs by traversing pagination.
   */
  async getAllProductLevelCampaignIds(
    opts: ShopeeApiOptions,
    adType = "ALL"
  ): Promise<number[]> {
    const allIds: number[] = [];
    let offset = 0;
    const pageSize = 100;

    for (let page = 0; page < 50; page++) {
      const res = await this.getProductLevelCampaignIdList(opts, {
        ad_type: adType,
        offset,
        page_size: pageSize,
      });
      if (!res.campaign_id_list.length) break;
      allIds.push(...res.campaign_id_list);
      if (!res.has_more || res.campaign_id_list.length < pageSize) break;
      offset += res.campaign_id_list.length;
    }
    return Array.from(new Set(allIds));
  }

  /**
   * 2. Fetch campaign settings in batches of <= 100 campaign IDs.
   * GET /api/v2/ads/get_product_level_campaign_setting_info
   */
  async getProductLevelCampaignSettingInfo(
    opts: ShopeeApiOptions,
    campaignIds: number[]
  ): Promise<ShopeeProductCampaignSetting[]> {
    if (!campaignIds.length) return [];

    const settings: ShopeeProductCampaignSetting[] = [];
    // Shopee batch limit is 100 campaign IDs per call
    for (let i = 0; i < campaignIds.length; i += 100) {
      const chunk = campaignIds.slice(i, i + 100);
      const json = await shopeeGet(
        ADS_PATH_PRODUCT_CAMPAIGN_SETTING,
        { campaign_id_list: chunk.join(",") },
        opts
      );
      const resp = (json.response || json) as Record<string, unknown>;
      const rawList = (resp.campaign_list || resp.campaign_setting_list || resp.list || (Array.isArray(resp) ? resp : [])) as unknown[];

      if (Array.isArray(rawList)) {
        for (const item of rawList) {
          if (!item || typeof item !== "object") continue;
          const c = item as Record<string, unknown>;
          const cid = Number(c.campaign_id ?? c.campaignId);
          if (!cid) continue;

          const rawKeywords = (c.keyword_list || c.keywords || []) as unknown[];
          const keyword_list: ShopeeKeywordSetting[] = Array.isArray(rawKeywords)
            ? rawKeywords.map((k: any) => ({
                keyword: String(k.keyword_text || k.keyword || ""),
                match_type: String(k.match_type || k.matchType || "broad"),
                status: String(k.status || "normal"),
                bid_price: Number(k.bid_price || k.bidPrice || k.bid || 0),
              }))
            : [];

          const rawItemIds = (c.item_id_list || c.item_ids || []) as unknown[];
          const item_id_list = Array.isArray(rawItemIds)
            ? rawItemIds.map(Number).filter((n) => Number.isFinite(n))
            : c.item_id ? [Number(c.item_id)] : [];

          settings.push({
            campaign_id: cid,
            campaign_name: String(c.campaign_name || c.campaignName || `Campaign ${cid}`),
            campaign_status: String(c.campaign_status || c.status || "ongoing"),
            ad_type: String(c.ad_type || c.adType || "product"),
            placement: c.placement ? String(c.placement) : undefined,
            budget: c.budget != null ? Number(c.budget) : undefined,
            start_time: c.start_time != null ? Number(c.start_time) : undefined,
            end_time: c.end_time != null ? Number(c.end_time) : undefined,
            bidding_method: c.bidding_method ? String(c.bidding_method) : undefined,
            roas_target: c.roas_target != null ? Number(c.roas_target) : undefined,
            item_id_list,
            item_id: item_id_list[0] ?? (c.item_id ? Number(c.item_id) : undefined),
            item_name: c.item_name ? String(c.item_name) : undefined,
            keyword_list,
            discovery_placement_settings: typeof c.discovery_placement_settings === "object" && c.discovery_placement_settings !== null
              ? (c.discovery_placement_settings as Record<string, unknown>)
              : undefined,
          });
        }
      }
    }
    return settings;
  }

  /**
   * 3. Fetch product campaign daily advertising performance.
   * GET /api/v2/ads/get_product_campaign_daily_performance
   * Batches by <= 100 campaign IDs and <= 30-day date windows (up to 6 months historical).
   */
  async getProductCampaignDailyPerformance(
    opts: ShopeeApiOptions,
    campaignIds: number[],
    sinceYmd: string,
    untilYmd: string
  ): Promise<ShopeeProductCampaignDailyMetric[]> {
    if (!campaignIds.length) return [];

    const dateChunks = chunkDateRangeIntoMonths(sinceYmd, untilYmd, 30);
    const results: ShopeeProductCampaignDailyMetric[] = [];

    for (const dateRange of dateChunks) {
      const start = shopeeAdsDateParam(dateRange.since);
      const end = shopeeAdsDateParam(dateRange.until);

      for (let i = 0; i < campaignIds.length; i += 100) {
        const idChunk = campaignIds.slice(i, i + 100);
        try {
          const json = await shopeeGet(
            ADS_PATH_PRODUCT_CAMPAIGN_PERFORMANCE,
            {
              campaign_id_list: idChunk.join(","),
              start_date: start,
              end_date: end,
            },
            opts
          );

          const resp = (json.response || json) as Record<string, unknown>;
          const rawList = (resp.performance_list || resp.list || resp.data || (Array.isArray(resp) ? resp : [])) as unknown[];

          if (Array.isArray(rawList)) {
            for (const item of rawList) {
              if (!item || typeof item !== "object") continue;
              const r = item as Record<string, unknown>;
              const cid = Number(r.campaign_id ?? r.campaignId);
              if (!cid) continue;

              const impression = Math.round(Number(r.impression ?? r.impressions ?? 0));
              const clicks = Math.round(Number(r.clicks ?? 0));
              const expense = Number(r.expense ?? r.ad_expense ?? r.cost ?? 0);
              const ctr = Number(r.ctr ?? (impression > 0 ? clicks / impression : 0));

              const broad_order = Number(r.broad_order ?? r.broad_orders ?? r.orders ?? 0);
              const broad_order_amount = Number(r.broad_order_amount ?? r.broad_units ?? r.units_sold ?? broad_order);
              const broad_gmv = Number(r.broad_gmv ?? r.broad_revenue ?? r.gmv ?? 0);
              const broad_roas = Number(r.broad_roas ?? r.broad_roi ?? (expense > 0 ? broad_gmv / expense : 0));
              const broad_cir = Number(r.broad_cir ?? r.broad_acos ?? (broad_gmv > 0 ? expense / broad_gmv : 0));
              const broad_cr = Number(r.broad_cr ?? (clicks > 0 ? broad_order / clicks : 0));
              const broad_cost_per_conversion = broad_order > 0 ? expense / broad_order : 0;

              const direct_order = Number(r.direct_order ?? r.direct_orders ?? 0);
              const direct_order_amount = Number(r.direct_order_amount ?? r.direct_units ?? direct_order);
              const direct_gmv = Number(r.direct_gmv ?? r.direct_revenue ?? 0);
              const direct_roas = Number(r.direct_roas ?? r.direct_roi ?? (expense > 0 ? direct_gmv / expense : 0));
              const direct_cir = Number(r.direct_cir ?? r.direct_acos ?? (direct_gmv > 0 ? expense / direct_gmv : 0));
              const direct_cr = Number(r.direct_cr ?? (clicks > 0 ? direct_order / clicks : 0));
              const direct_cost_per_conversion = direct_order > 0 ? expense / direct_order : 0;

              results.push({
                date: String(r.date || r.report_date || dateRange.since),
                campaign_id: cid,
                campaign_name: r.campaign_name ? String(r.campaign_name) : undefined,
                item_id: r.item_id ? Number(r.item_id) : undefined,
                item_name: r.item_name ? String(r.item_name) : undefined,
                ad_type: r.ad_type ? String(r.ad_type) : undefined,
                impression,
                clicks,
                ctr,
                expense,
                broad_order,
                broad_order_amount,
                broad_gmv,
                broad_roas,
                broad_cir,
                broad_cr,
                broad_cost_per_conversion,
                direct_order,
                direct_order_amount,
                direct_gmv,
                direct_roas,
                direct_cir,
                direct_cr,
                direct_cost_per_conversion,
                raw: r,
              });
            }
          }
        } catch (err) {
          logger.warn(`[Shopee Ads] Batch product performance query failed for chunk`, {
            campaignCount: idChunk.length,
            since: dateRange.since,
            until: dateRange.until,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    return results;
  }

  /**
   * Shop-level CPC ads — daily performance for a date range.
   * Tries `start_date` + `end_date` (DD-MM-YYYY); falls back to per-day `performance_date` if Shopee returns error_param.
   */
  async getAllCpcAdsDailyPerformance(
    opts: ShopeeApiOptions,
    sinceYmd: string,
    untilYmd: string
  ): Promise<ShopeeAdsDailyPerformanceResult> {
    const start = shopeeAdsDateParam(sinceYmd);
    const end = shopeeAdsDateParam(untilYmd);
    try {
      const json = await shopeeGet(
        ADS_PATH_CPC_DAILY,
        { start_date: start, end_date: end },
        opts
      );
      return {
        rows: extractShopeeAdsPerformanceRows(json),
        mode: "range",
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("error_param")) throw e;
      logger.info(
        "[Shopee Ads] Daily CPC: range params rejected; retrying per-day performance_date"
      );
      return this.getAllCpcAdsDailyPerformanceByDay(opts, sinceYmd, untilYmd);
    }
  }

  /** One GET per calendar day using `performance_date` (DD-MM-YYYY). */
  async getAllCpcAdsDailyPerformanceByDay(
    opts: ShopeeApiOptions,
    sinceYmd: string,
    untilYmd: string
  ): Promise<ShopeeAdsDailyPerformanceResult> {
    const rows: unknown[] = [];
    const perDayErrors: string[] = [];
    const start = parseYmdUtc(sinceYmd);
    const end = parseYmdUtc(untilYmd);
    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
      const ymd = new Date(t).toISOString().slice(0, 10);
      const perf = shopeeAdsDateParam(ymd);
      try {
        const json = await shopeeGet(
          ADS_PATH_CPC_DAILY,
          { performance_date: perf },
          opts
        );
        rows.push(...extractShopeeAdsPerformanceRows(json));
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        perDayErrors.push(`${ymd}: ${m}`);
      }
    }
    return { rows, mode: "per_day", perDayErrors };
  }

  /** Shop-level CPC ads — hourly rows for a single local calendar day (DD-MM-YYYY). */
  async getAllCpcAdsHourlyPerformance(
    opts: ShopeeApiOptions,
    ymd: string
  ): Promise<unknown> {
    return shopeeGet(
      ADS_PATH_CPC_HOURLY,
      { performance_date: shopeeAdsDateParam(ymd) },
      opts
    );
  }
}

function parseYmdUtc(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) throw new Error(`Invalid date: ${ymd}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Normalize list payloads: `response` may be an array or wrapped in an object. */
export function extractShopeeAdsPerformanceRows(payload: unknown): unknown[] {
  if (payload == null || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  const inner = o.response;
  if (Array.isArray(inner)) return inner;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const r = inner as Record<string, unknown>;
    for (const key of ["list", "performance_list", "data", "result"]) {
      const v = r[key];
      if (Array.isArray(v)) return v;
    }
  }
  for (const key of ["list", "performance_list", "data"]) {
    const v = o[key];
    if (Array.isArray(v)) return v;
  }
  return [];
}

export const shopeeAdsClient = new ShopeeAdsClient();

// ── Lazy token refresh ────────────────────────────────────────────────────────

/**
 * Shopee credentials as stored in the DB (both camelCase legacy + snake_case).
 * We normalise to snake_case on write; support both on read.
 */
export interface ShopeeCreds {
  access_token: string;
  refresh_token: string;
  expire_in: number;   // seconds — typically 14400 (4h)
  shop_id: number;
  sandbox?: boolean;
}

/**
 * Returns always-valid Shopee credentials for a connection.
 *
 * — If the access token is still fresh (>30 min remaining), returns as-is.
 * — If it's about to expire (≤30 min), refreshes it via the Shopee API,
 *   persists the new tokens to the DB, and returns the fresh set.
 *
 * Call this before EVERY Shopee API request instead of reading raw credentials.
 *
 * @param connectionId  Prisma Connection.id
 */
export async function getValidShopeeCreds(connectionId: string): Promise<ShopeeCreds> {
  const conn = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!conn) throw new Error(`Shopee connection ${connectionId} not found`);

  const raw = JSON.parse(safeDecrypt(conn.credentials)) as Record<string, unknown>;
  const creds = normalizeStoredShopeeCreds(raw);

  // Fallback: resolve shop_id from connection.remoteAccountId if missing or 0 in payload
  if ((!creds.shop_id || creds.shop_id === 0) && conn.remoteAccountId) {
    const remoteIdNum = Number(conn.remoteAccountId.trim());
    if (Number.isFinite(remoteIdNum) && remoteIdNum > 0) {
      creds.shop_id = remoteIdNum;
    }
  }

  if (!creds.access_token || !creds.refresh_token || !creds.shop_id) {
    throw new Error(`Shopee connection ${connectionId} has incomplete credentials`);
  }

  if (!accessTokenNeedsRefresh(creds, conn.updatedAt)) {
    return creds;
  }

  logger.info(`[Shopee] Access token for connection ${connectionId} expiring soon — refreshing`);

  const client = new ShopeeClient();
  const fresh = await client.refreshAccessToken(
    creds.refresh_token,
    creds.shop_id,
    creds.sandbox === true
  );

  const updated: ShopeeCreds = {
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token,
    expire_in: fresh.expire_in ?? SHOPEE_DEFAULT_EXPIRE_IN_SEC,
    shop_id: creds.shop_id,
    sandbox: creds.sandbox,
  };

  await prisma.connection.update({
    where: { id: connectionId },
    data: {
      credentials: encrypt(
        JSON.stringify(serializeShopeeStoredCreds(updated, { markTokenFresh: true }))
      ),
    },
  });

  logger.info(`[Shopee] Token refreshed and saved for connection ${connectionId}`);
  return updated;
}
