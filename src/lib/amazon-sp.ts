/**
 * Amazon Selling Partner API — Login with Amazon (LWA) OAuth (website authorization workflow).
 * @see https://developer-docs.amazon.com/sp-api/docs/website-authorization-workflow
 *
 * Env:
 *   AMAZON_LWA_CLIENT_ID / AMAZON_CLIENT_ID
 *   AMAZON_LWA_CLIENT_SECRET / AMAZON_CLIENT_SECRET
 *   AMAZON_REDIRECT_URI (optional; default {NEXTAUTH_URL}/api/auth/amazon/callback)
 *   AMAZON_SELLER_CENTRAL_CONSENT_BASE (optional; NA default)
 *   AMAZON_SPAPI_DRAFT_APP=true → append version=beta (required for draft LWA apps / sandbox testing)
 */

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

function clientId(): string {
  const id = (
    process.env.AMAZON_LWA_CLIENT_ID ||
    process.env.AMAZON_CLIENT_ID ||
    ""
  ).trim();
  if (!id) throw new Error("AMAZON_LWA_CLIENT_ID (or AMAZON_CLIENT_ID) is not configured");
  return id;
}

function clientSecret(): string {
  const s = (
    process.env.AMAZON_LWA_CLIENT_SECRET ||
    process.env.AMAZON_CLIENT_SECRET ||
    ""
  ).trim();
  if (!s) throw new Error("AMAZON_LWA_CLIENT_SECRET (or AMAZON_CLIENT_SECRET) is not configured");
  return s;
}

function consentBaseUrl(): string {
  const u = (process.env.AMAZON_SELLER_CENTRAL_CONSENT_BASE || "").trim();
  if (u) return u.replace(/\/$/, "");
  return "https://sellercentral.amazon.com/apps/authorize/consent";
}

export function isAmazonSpDraftApp(): boolean {
  return (process.env.AMAZON_SPAPI_DRAFT_APP || "false").toLowerCase() === "true";
}

/** Step 1 — Seller Central consent URL (returns seller to our redirect_uri with spapi_oauth_code). */
export function getAmazonSpConsentUrl(state: string): string {
  const url = new URL(consentBaseUrl());
  url.searchParams.set("application_id", clientId());
  url.searchParams.set("state", state);
  if (isAmazonSpDraftApp()) {
    url.searchParams.set("version", "beta");
  }
  return url.toString();
}

export function isAmazonOAuthEnvConfigured(): boolean {
  const id = (
    process.env.AMAZON_LWA_CLIENT_ID ||
    process.env.AMAZON_CLIENT_ID ||
    ""
  ).trim();
  const secret = (
    process.env.AMAZON_LWA_CLIENT_SECRET ||
    process.env.AMAZON_CLIENT_SECRET ||
    ""
  ).trim();
  return Boolean(id && secret);
}

export interface AmazonLwaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
}

/** Step 2 — Exchange spapi_oauth_code for LWA refresh_token + access_token. */
export async function exchangeAmazonSpAuthorizationCode(
  spapiOAuthCode: string,
  redirectUri: string
): Promise<AmazonLwaTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: spapiOAuthCode,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUri,
  });

  const res = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: body.toString(),
  });

  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Amazon token exchange failed (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const err =
      (json.error_description as string) ||
      (json.error as string) ||
      text.slice(0, 200);
    throw new Error(`Amazon token exchange failed: ${err}`);
  }

  const access_token = json.access_token as string | undefined;
  const refresh_token = json.refresh_token as string | undefined;
  const expires_in = Number(json.expires_in ?? 3600);
  const token_type = (json.token_type as string) || "bearer";

  if (!access_token || !refresh_token) {
    throw new Error("Amazon token response missing access_token or refresh_token");
  }

  return { access_token, refresh_token, expires_in, token_type };
}
