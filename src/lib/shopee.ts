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

function partnerId(): number {
  const id = (process.env.SHOPEE_PARTNER_ID || "").trim();
  if (!id) throw new Error("SHOPEE_PARTNER_ID is not configured");
  return Number(id);
}

function partnerKey(): string {
  const key = (process.env.SHOPEE_PARTNER_KEY || "").trim();
  if (!key) throw new Error("SHOPEE_PARTNER_KEY is not configured");
  return key;
}

function getHost(sandbox = false): string {
  return sandbox
    ? "https://partner.test-stable.shopeemobile.com"
    : "https://partner.shopeemobile.com";
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/** HMAC-SHA256 hex signature for auth APIs (no access_token). */
function signAuth(path: string, timestamp: number): string {
  const base = `${partnerId()}${path}${timestamp}`;
  return crypto.createHmac("sha256", partnerKey()).update(base).digest("hex");
}

/** HMAC-SHA256 hex signature for shop-level APIs. */
function signShop(
  path: string,
  timestamp: number,
  accessToken: string,
  shopId: number
): string {
  const base = `${partnerId()}${path}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac("sha256", partnerKey()).update(base).digest("hex");
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
    const path = "/api/v2/shop/auth_partner";
    const ts = nowUnix();
    const sign = signAuth(path, ts);
    const host = getHost(sandbox);

    const url = new URL(`${host}${path}`);
    url.searchParams.set("partner_id", String(partnerId()));
    url.searchParams.set("redirect", redirectUri);
    url.searchParams.set("sign", sign);
    url.searchParams.set("timestamp", String(ts));

    if (state) {
      const sep = url.search ? "&" : "?";
      return `${url.toString()}${sep}state=${encodeURIComponent(state)}`;
    }
    return url.toString();
  }

  /**
   * Step 2 — Exchange the auth `code` + `shop_id` for tokens.
   */
  async exchangeCode(
    code: string,
    shopId: number,
    sandbox = false
  ): Promise<ShopeeTokenResponse> {
    const path = "/api/v2/auth/token/get";
    const ts = nowUnix();
    const sign = signAuth(path, ts);
    const host = getHost(sandbox);

    const url = new URL(`${host}${path}`);
    url.searchParams.set("partner_id", String(partnerId()));
    url.searchParams.set("timestamp", String(ts));
    url.searchParams.set("sign", sign);

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        shop_id: shopId,
        partner_id: partnerId(),
      }),
    });

    const json = await res.json();
    if (json.error || json.message) {
      throw new Error(
        `Shopee token error: ${json.error ?? json.message ?? JSON.stringify(json)}`
      );
    }
    return json as ShopeeTokenResponse;
  }

  /**
   * Refresh an expired access token.
   */
  async refreshAccessToken(
    refreshToken: string,
    shopId: number,
    sandbox = false
  ): Promise<ShopeeTokenResponse> {
    const path = "/api/v2/auth/access_token/get";
    const ts = nowUnix();
    const sign = signAuth(path, ts);
    const host = getHost(sandbox);

    const url = new URL(`${host}${path}`);
    url.searchParams.set("partner_id", String(partnerId()));
    url.searchParams.set("timestamp", String(ts));
    url.searchParams.set("sign", sign);

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refresh_token: refreshToken,
        shop_id: shopId,
        partner_id: partnerId(),
      }),
    });

    const json = await res.json();
    if (json.error || json.message) {
      throw new Error(
        `Shopee refresh error: ${json.error ?? json.message ?? JSON.stringify(json)}`
      );
    }
    return json as ShopeeTokenResponse;
  }
}

export const shopeeClient = new ShopeeClient();

// ── Shop-level API helpers ────────────────────────────────────────────────────

interface ShopeeApiOptions {
  accessToken: string;
  shopId: number;
  sandbox?: boolean;
}

async function shopeeGet(
  path: string,
  params: Record<string, string>,
  opts: ShopeeApiOptions
): Promise<any> {
  const ts = nowUnix();
  const sign = signShop(path, ts, opts.accessToken, opts.shopId);
  const host = getHost(opts.sandbox);

  const url = new URL(`${host}${path}`);
  url.searchParams.set("partner_id", String(partnerId()));
  url.searchParams.set("timestamp", String(ts));
  url.searchParams.set("access_token", opts.accessToken);
  url.searchParams.set("shop_id", String(opts.shopId));
  url.searchParams.set("sign", sign);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString());
  const json = await res.json();
  if (json.error && json.error !== "") {
    throw new Error(`Shopee API ${path} error: ${json.error} — ${json.message ?? ""}`);
  }
  return json;
}

// ── Data methods ──────────────────────────────────────────────────────────────

export class ShopeeDataClient {
  /** Get basic shop information. */
  async getShopInfo(opts: ShopeeApiOptions) {
    return shopeeGet("/api/v2/shop/get_shop_info", {}, opts);
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
    const params: Record<string, string> = {
      time_range_field: "create_time",
      time_from: String(timeFrom),
      time_to: String(timeTo),
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
