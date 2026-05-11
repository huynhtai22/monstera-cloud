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

/** Decimal digits only — used in the HMAC base string and in query params (avoids Number precision edge cases). */
function partnerIdString(): string {
  const id = normalizePartnerEnvValue(process.env.SHOPEE_PARTNER_ID || "");
  if (!id) throw new Error("SHOPEE_PARTNER_ID is not configured");
  if (!/^\d+$/.test(id)) {
    throw new Error("SHOPEE_PARTNER_ID must be a decimal integer string");
  }
  return id;
}

function partnerId(): number {
  const id = partnerIdString();
  const n = Number(id);
  if (!Number.isSafeInteger(n)) {
    throw new Error("SHOPEE_PARTNER_ID is outside safe integer range; contact support");
  }
  return n;
}

function partnerKey(): string {
  const key = normalizePartnerEnvValue(process.env.SHOPEE_PARTNER_KEY || "");
  if (!key) throw new Error("SHOPEE_PARTNER_KEY is not configured");
  // Shopee expects the raw partner_key string as the HMAC secret.
  // Do NOT strip `shpk` prefixes or hex-decode; treat it as opaque bytes.
  return key;
}

/** Same UTF-8 secret as API signing; used by `POST /api/webhooks/shopee` body HMAC. */
export function shopeePartnerKeySecretForWebhook(): string {
  return partnerKey();
}

function getHost(sandbox = false): string {
  return sandbox ? SHOPEE_SANDBOX_OPEN_API_HOST : "https://partner.shopeemobile.com";
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/** HMAC-SHA256 hex signature for auth APIs (no access_token). */
function signAuth(path: string, timestamp: number): string {
  const base = `${partnerIdString()}${path}${timestamp}`;
  return crypto.createHmac("sha256", partnerKey()).update(base).digest("hex");
}

/** HMAC-SHA256 hex signature for shop-level APIs. */
function signShop(
  path: string,
  timestamp: number,
  accessToken: string,
  shopId: number
): string {
  const base = `${partnerIdString()}${path}${timestamp}${accessToken}${shopId}`;
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

    // Parameter order matches common Shopee examples (partner_id → timestamp → sign → redirect).
    const q = new URLSearchParams();
    q.set("partner_id", partnerIdString());
    q.set("timestamp", String(ts));
    q.set("sign", sign);
    q.set("redirect", redirectUri);
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
    const path = "/api/v2/auth/token/get";
    const ts = nowUnix();
    const sign = signAuth(path, ts);
    const host = getHost(sandbox);

    const q = new URLSearchParams();
    q.set("partner_id", partnerIdString());
    q.set("timestamp", String(ts));
    q.set("sign", sign);

    const res = await fetch(`${host}${path}?${q.toString()}`, {
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

    const q = new URLSearchParams();
    q.set("partner_id", partnerIdString());
    q.set("timestamp", String(ts));
    q.set("sign", sign);

    const res = await fetch(`${host}${path}?${q.toString()}`, {
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

  const q = new URLSearchParams();
  q.set("partner_id", partnerIdString());
  q.set("timestamp", String(ts));
  q.set("access_token", opts.accessToken);
  q.set("shop_id", String(opts.shopId));
  q.set("sign", sign);
  for (const [k, v] of Object.entries(params)) {
    q.set(k, v);
  }

  const res = await fetch(`${host}${path}?${q.toString()}`);
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

  const raw = JSON.parse(safeDecrypt(conn.credentials)) as Record<string, any>;

  // Normalise: support both camelCase (legacy) and snake_case
  const creds: ShopeeCreds = {
    access_token:  raw.access_token  ?? raw.accessToken,
    refresh_token: raw.refresh_token ?? raw.refreshToken,
    expire_in:     raw.expire_in     ?? raw.expireIn ?? 14400,
    shop_id:       raw.shop_id       ?? raw.shopId,
    sandbox:       raw.sandbox === true,
  };

  const tokenCreatedMs = new Date(conn.updatedAt).getTime();
  const expiresAtMs    = tokenCreatedMs + creds.expire_in * 1000;
  const thirtyMinMs    = 30 * 60 * 1000;
  const needsRefresh   = expiresAtMs - Date.now() < thirtyMinMs;

  if (!needsRefresh) return creds;

  // ── Token is about to expire — refresh it now ──────────────────────────────
  logger.info(`[Shopee] Access token for connection ${connectionId} expiring soon — refreshing`);

  const client = new ShopeeClient();
  const fresh  = await client.refreshAccessToken(
    creds.refresh_token,
    creds.shop_id,
    creds.sandbox
  );

  const updated: ShopeeCreds = {
    access_token:  fresh.access_token,
    refresh_token: fresh.refresh_token,
    expire_in:     fresh.expire_in ?? 14400,
    shop_id:       creds.shop_id,
    sandbox:       creds.sandbox,
  };

  await prisma.connection.update({
    where: { id: connectionId },
    data:  { credentials: encrypt(JSON.stringify(updated)) },
  });

  logger.info(`[Shopee] Token refreshed and saved for connection ${connectionId}`);
  return updated;
}
