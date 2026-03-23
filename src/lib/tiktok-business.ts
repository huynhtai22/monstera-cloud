/**
 * TikTok "account holder" / Login Kit OAuth (open.tiktokapis.com).
 * For Business insights, ads-related scopes, etc. — separate from TikTok Shop seller API.
 * @see https://developers.tiktok.com/doc/oauth-user-access-token-management
 */

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

export class TikTokBusinessClient {
  getAuthorizeUrl(state: string, redirectUri: string): string {
    const key = clientKey();
    if (!key) throw new Error('TIKTOK_BUSINESS_CLIENT_KEY is not configured');
    const url = new URL('https://www.tiktok.com/v2/auth/authorize');
    url.searchParams.set('client_key', key);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', getTikTokBusinessScopes());
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(code: string, redirectUri: string): Promise<TikTokBusinessTokenResponse> {
    const key = clientKey();
    const secret = clientSecret();
    if (!key || !secret) {
      throw new Error('TIKTOK_BUSINESS_CLIENT_KEY or TIKTOK_BUSINESS_CLIENT_SECRET not configured');
    }

    const body = new URLSearchParams({
      client_key: key,
      client_secret: secret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
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
