import crypto from 'crypto';

export const SHOPIFY_SCOPES = [
  'read_orders',
  'read_all_orders',
  'read_products',
  'read_inventory',
  'read_customers',
].join(',');

export interface ShopifyTokenData {
  access_token: string;
  scope: string;
}

export class ShopifyOAuthClient {
  private clientId: string;
  private clientSecret: string;

  constructor() {
    this.clientId = process.env.SHOPIFY_CLIENT_ID ?? '';
    this.clientSecret = process.env.SHOPIFY_CLIENT_SECRET ?? '';
  }

  getAuthorizeUrl(shop: string, redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      scope: SHOPIFY_SCOPES,
      redirect_uri: redirectUri,
      state,
    });
    return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(shop: string, code: string): Promise<ShopifyTokenData> {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify token exchange failed: ${text}`);
    }
    return res.json() as Promise<ShopifyTokenData>;
  }

  /** Verify the HMAC signature Shopify sends on the callback. */
  verifyCallback(params: URLSearchParams): boolean {
    const hmac = params.get('hmac');
    if (!hmac) return false;
    const filtered = new URLSearchParams();
    params.forEach((v, k) => { if (k !== 'hmac') filtered.set(k, v); });
    const sorted = [...filtered.entries()].sort(([a], [b]) => a.localeCompare(b));
    const msg = sorted.map(([k, v]) => `${k}=${v}`).join('&');
    const digest = crypto.createHmac('sha256', this.clientSecret).update(msg).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
  }
}

export class ShopifyDataClient {
  private shop: string;
  private accessToken: string;
  private apiVersion = '2024-10';

  constructor(shop: string, accessToken: string) {
    this.shop = shop;
    this.accessToken = accessToken;
  }

  private async get<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = new URL(`https://${this.shop}/admin/api/${this.apiVersion}${path}`);
    if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), {
      headers: {
        'X-Shopify-Access-Token': this.accessToken,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async getOrders(params: {
    limit?: number;
    created_at_min?: string;
    status?: string;
  } = {}): Promise<{ orders: any[] }> {
    const query: Record<string, string> = {
      limit: String(params.limit ?? 250),
      status: params.status ?? 'any',
    };
    if (params.created_at_min) query['created_at_min'] = params.created_at_min;
    return this.get<{ orders: any[] }>('/orders.json', query);
  }
}
