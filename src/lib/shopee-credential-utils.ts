/**
 * Shared Shopee connection credential parsing and access-token expiry.
 * Access tokens are ~4h; refresh tokens ~30d.
 */

export const SHOPEE_DEFAULT_EXPIRE_IN_SEC = 14400;
/** Refresh proactively when less than this remains (ms). */
export const SHOPEE_ACCESS_REFRESH_BUFFER_MS = 30 * 60 * 1000;
/** Cron fleet refresh when less than this remains (ms). */
export const SHOPEE_CRON_REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

export type NormalizedShopeeStoredCreds = {
  access_token: string;
  refresh_token: string;
  expire_in: number;
  shop_id: number;
  sandbox?: boolean;
  /** ISO-8601 — when the current access_token was issued (preferred over connection.updatedAt). */
  access_token_obtained_at?: string;
};

export function normalizeStoredShopeeCreds(
  raw: Record<string, unknown>
): NormalizedShopeeStoredCreds {
  const expireIn = Number(
    raw.expire_in ?? raw.expireIn ?? SHOPEE_DEFAULT_EXPIRE_IN_SEC
  );
  const shopId = Number(raw.shop_id ?? raw.shopId);
  let obtainedAt =
    typeof raw.access_token_obtained_at === "string"
      ? raw.access_token_obtained_at
      : typeof raw.accessTokenObtainedAt === "string"
        ? raw.accessTokenObtainedAt
        : undefined;

  const expiresAtRaw = raw.expiresAt ?? raw.expires_at;
  if (!obtainedAt && expiresAtRaw) {
    const expiresMs = new Date(String(expiresAtRaw)).getTime();
    if (!Number.isNaN(expiresMs)) {
      obtainedAt = new Date(expiresMs - expireIn * 1000).toISOString();
    }
  }

  return {
    access_token: String(raw.access_token ?? raw.accessToken ?? ""),
    refresh_token: String(raw.refresh_token ?? raw.refreshToken ?? ""),
    expire_in: Number.isFinite(expireIn) ? expireIn : SHOPEE_DEFAULT_EXPIRE_IN_SEC,
    shop_id: shopId,
    sandbox: raw.sandbox === true,
    access_token_obtained_at: obtainedAt,
  };
}

export function getAccessTokenExpiresAtMs(
  creds: NormalizedShopeeStoredCreds,
  connectionUpdatedAt: Date
): number {
  if (creds.access_token_obtained_at) {
    const obtainedMs = new Date(creds.access_token_obtained_at).getTime();
    if (!Number.isNaN(obtainedMs)) {
      return obtainedMs + creds.expire_in * 1000;
    }
  }
  return connectionUpdatedAt.getTime() + creds.expire_in * 1000;
}

/** Persisted JSON shape (snake_case) written after OAuth exchange or refresh. */
export function serializeShopeeStoredCreds(
  creds: NormalizedShopeeStoredCreds,
  opts?: { markTokenFresh?: boolean }
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    access_token: creds.access_token,
    refresh_token: creds.refresh_token,
    expire_in: creds.expire_in ?? SHOPEE_DEFAULT_EXPIRE_IN_SEC,
    shop_id: creds.shop_id,
    sandbox: creds.sandbox === true,
    access_token_obtained_at: opts?.markTokenFresh
      ? now
      : creds.access_token_obtained_at ?? now,
    expiresAt: new Date(
      Date.now() +
        (creds.expire_in ?? SHOPEE_DEFAULT_EXPIRE_IN_SEC) * 1000
    ).toISOString(),
  };
}

export function accessTokenNeedsRefresh(
  creds: NormalizedShopeeStoredCreds,
  connectionUpdatedAt: Date,
  bufferMs = SHOPEE_ACCESS_REFRESH_BUFFER_MS
): boolean {
  const expiresAtMs = getAccessTokenExpiresAtMs(creds, connectionUpdatedAt);
  return expiresAtMs - Date.now() < bufferMs;
}
