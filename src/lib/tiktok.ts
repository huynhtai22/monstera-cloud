import crypto from "crypto";

export interface TikTokTokenResponse {
  access_token: string;
  refresh_token: string;
  access_token_expire_in: number;
  refresh_token_expire_in: number;
  open_id: string;
  seller_name: string;
  seller_id: string;
}

export class TikTokClient {
  private appId: string;
  private appSecret: string;
  private baseUrl = "https://open-api.tiktokglobalshop.com";

  constructor() {
    this.appId = (process.env.TIKTOK_SHOP_APP_KEY || "").trim();
    this.appSecret = (process.env.TIKTOK_SHOP_APP_SECRET || "").trim();
  }

  private callbackRedirectUri(): string | undefined {
    const explicit = process.env.TIKTOK_SHOP_REDIRECT_URI?.trim();
    if (explicit) return explicit;
    const base = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
    if (base) return `${base}/api/auth/tiktok/callback`;
    return undefined;
  }

  /**
   * Generates the authorization URL for the seller to click
   */
  getAuthUrl(state: string): string {
    // Current TikTok Shop Auth V2 URL pattern
    return `https://services.tiktokglobalshop.com/open/authorize?app_key=${this.appId}&state=${state}`;
  }

  /**
   * Exchanges the authorization code for access and refresh tokens
   */
  async getAccessToken(code: string): Promise<TikTokTokenResponse> {
    if (!this.appId || !this.appSecret) {
      throw new Error("TikTok App Key or Secret not configured");
    }

    const body: Record<string, string> = {
      app_key: this.appId,
      app_secret: this.appSecret,
      auth_code: code,
      grant_type: "authorized_code",
    };
    const redirect = this.callbackRedirectUri();
    if (redirect) {
      body.redirect_uri = redirect;
    }

    const response = await fetch(`${this.baseUrl}/api/v2/auth/token/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (data.code !== 0) {
      throw new Error(`TikTok Token Error: ${data.message} (${data.code})`);
    }

    return data.data;
  }

  /**
   * Refreshes an expired access token
   */
  async refreshAccessToken(refreshToken: string): Promise<TikTokTokenResponse> {
    const response = await fetch(`${this.baseUrl}/api/v2/auth/token/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_key: this.appId,
        app_secret: this.appSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    const data = await response.json();

    if (data.code !== 0) {
      throw new Error(`TikTok Refresh Error: ${data.message} (${data.code})`);
    }

    return data.data;
  }
}

export const tiktokClient = new TikTokClient();
