/**
 * Lazada Open Platform — OAuth 2.0 + REST signing (Lazop-style).
 * @see https://open.lazada.com/apps/doc/api?path=/auth/token/create
 *
 * Env:
 *   LAZADA_APP_KEY, LAZADA_APP_SECRET (from Lazada Developer Console)
 *   LAZADA_REDIRECT_URI (optional; default {origin}/api/auth/lazada/callback)
 *   LAZADA_API_BASE (optional; default https://api.lazada.sg/rest)
 *   LAZADA_OAUTH_AUTHORIZE_URL (optional; default https://auth.lazada.com/oauth/authorize)
 *   LAZADA_PARTNER_ID (optional; sent as partner_id on API calls)
 */

import crypto from "crypto";

const DEFAULT_API_BASE = "https://api.lazada.sg/rest";
const DEFAULT_AUTH_URL = "https://auth.lazada.com/oauth/authorize";
const DEFAULT_PARTNER_ID = "monstera-cloud-lazop-1";

const TOKEN_CREATE_PATH = "/auth/token/create";

function appKey(): string {
  const k = (process.env.LAZADA_APP_KEY || "").trim();
  if (!k) throw new Error("LAZADA_APP_KEY is not configured");
  return k;
}

function appSecret(): string {
  const s = (process.env.LAZADA_APP_SECRET || "").trim();
  if (!s) throw new Error("LAZADA_APP_SECRET is not configured");
  return s;
}

export function lazadaApiBase(): string {
  return (process.env.LAZADA_API_BASE || DEFAULT_API_BASE).replace(/\/$/, "");
}

function lazadaOAuthAuthorizeRoot(): string {
  const raw = (process.env.LAZADA_OAUTH_AUTHORIZE_URL || DEFAULT_AUTH_URL).trim();
  const base = raw.replace(/\/$/, "");
  return base.endsWith("/oauth/authorize") ? base : `${base}/oauth/authorize`;
}

function partnerId(): string {
  return (process.env.LAZADA_PARTNER_ID || DEFAULT_PARTNER_ID).trim();
}

/** Lazop signature: HMAC-SHA256( apiPath + key1val1key2val2... sorted keys, excluding sign ). */
export function lazadaSign(apiPath: string, params: Record<string, string>): string {
  const keys = Object.keys(params)
    .filter((k) => k !== "sign")
    .sort();
  const concatenated = keys.map((k) => `${k}${params[k]}`).join("");
  const stringToSign = `${apiPath}${concatenated}`;
  return crypto
    .createHmac("sha256", appSecret())
    .update(stringToSign, "utf8")
    .digest("hex")
    .toUpperCase();
}

export function isLazadaOAuthEnvConfigured(): boolean {
  return Boolean(
    (process.env.LAZADA_APP_KEY || "").trim() && (process.env.LAZADA_APP_SECRET || "").trim()
  );
}

export function getLazadaAuthorizeUrl(params: {
  redirectUri: string;
  state: string;
}): string {
  const u = new URL(lazadaOAuthAuthorizeRoot());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("force_auth", "true");
  u.searchParams.set("redirect_uri", params.redirectUri);
  u.searchParams.set("client_id", appKey());
  u.searchParams.set("state", params.state);
  return u.toString();
}

export interface LazadaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  /** Lazada country/site code when present */
  country?: string;
  account_id?: string;
  seller_id?: string;
  raw: Record<string, unknown>;
}

function parseTokenJson(json: Record<string, unknown>): LazadaTokenResponse {
  const access = (json.access_token as string) || "";
  const refresh = (json.refresh_token as string) || "";
  if (!access || !refresh) {
    const msg = (json.message as string) || JSON.stringify(json).slice(0, 300);
    throw new Error(`Lazada token response missing tokens: ${msg}`);
  }
  const expires = Number(json.expires_in ?? 604800);
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: Number.isFinite(expires) ? expires : 604800,
    country: json.country as string | undefined,
    account_id: json.account_id as string | undefined,
    seller_id: (json.seller_id as string) || (json.user_id as string) || undefined,
    raw: json,
  };
}

/** Exchange OAuth `code` for seller tokens (POST form, Lazop-signed). */
export async function exchangeLazadaAuthorizationCode(
  code: string
): Promise<LazadaTokenResponse> {
  const timestamp = String(Date.now());
  const signParams: Record<string, string> = {
    app_key: appKey(),
    sign_method: "sha256",
    timestamp,
    partner_id: partnerId(),
    code,
  };
  const sign = lazadaSign(TOKEN_CREATE_PATH, signParams);
  const body = new URLSearchParams({ ...signParams, sign });

  const url = `${lazadaApiBase()}${TOKEN_CREATE_PATH}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      (json.message as string) || `Lazada token HTTP ${res.status}`
    );
  }

  const merged =
    json.data && typeof json.data === "object" && !json.access_token
      ? ({ ...json, ...(json.data as Record<string, unknown>) } as Record<string, unknown>)
      : json;

  if (!merged.access_token) {
    const codeStr = merged.code;
    if (codeStr !== undefined && String(codeStr) !== "0") {
      throw new Error(
        (merged.message as string) || `Lazada token error code ${String(codeStr)}`
      );
    }
  }

  return parseTokenJson(merged);
}

/**
 * Lazada Open Platform — list orders in a creation-time window.
 * Uses Lazop signed POST (same signing model as token exchange).
 *
 * @see https://open.lazada.com/apps/doc/api?path=/orders/get
 */
export async function lazadaOrdersGet(
  accessToken: string,
  query: Record<string, string>,
): Promise<Record<string, unknown>> {
  const apiPath = "/orders/get";
  const timestamp = String(Date.now());
  const signParams: Record<string, string> = {
    app_key: appKey(),
    sign_method: "sha256",
    timestamp,
    partner_id: partnerId(),
    access_token: accessToken,
    ...query,
  };
  const sign = lazadaSign(apiPath, signParams);
  const body = new URLSearchParams({ ...signParams, sign });

  const url = `${lazadaApiBase()}${apiPath}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error((json.message as string) || `Lazada orders HTTP ${res.status}`);
  }
  const code = json.code;
  if (code !== undefined && String(code) !== "0") {
    throw new Error((json.message as string) || `Lazada orders error code ${String(code)}`);
  }
  return json;
}
