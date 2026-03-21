import crypto from 'crypto';

export class ShopeeClient {
    private partnerId: string;
    private partnerKey: string;
    private env: string;
    private host: string;

    constructor() {
        this.partnerId = process.env.SHOPEE_PARTNER_ID || '';
        this.partnerKey = process.env.SHOPEE_PARTNER_KEY || '';
        this.env = process.env.SHOPEE_ENV || 'test';
        this.host = this.env === 'live' 
            ? 'https://partner.shopeemobile.com' 
            : 'https://partner.test-stable.shopeemobile.com';
    }

    /**
     * Generates a common signature for Shopee API V2
     * Standard Flow: PartnerID + APIPath + Timestamp + AccessToken + ShopID
     * Auth Flow: PartnerID + APIPath + Timestamp
     */
    public generateSignature(path: string, accessToken?: string, shopId?: string): { timestamp: number, sign: string } {
        const timestamp = Math.floor(Date.now() / 1000);
        
        let baseString = `${this.partnerId}${path}${timestamp}`;
        if (accessToken) baseString += accessToken;
        if (shopId) baseString += shopId;

        const sign = crypto
            .createHmac('sha256', this.partnerKey)
            .update(baseString)
            .digest('hex');

        return { timestamp, sign };
    }

    /**
     * Constructs the authorization URL to redirect users to Shopee for consent.
     */
    public getAuthUrl(redirectUrl: string): string {
        const path = '/api/v2/shop/auth_partner';
        const { timestamp, sign } = this.generateSignature(path);

        return `${this.host}${path}?partner_id=${this.partnerId}&timestamp=${timestamp}&sign=${sign}&redirect=${encodeURIComponent(redirectUrl)}`;
    }

    /**
     * Exchanges the authorization code for an access token.
     */
    public async getAccessToken(code: string, shopId: string): Promise<any> {
        const path = '/api/v2/auth/token/get';
        const { timestamp, sign } = this.generateSignature(path);
        
        const url = `${this.host}${path}?partner_id=${this.partnerId}&timestamp=${timestamp}&sign=${sign}`;

        const body = {
            code,
            shop_id: parseInt(shopId, 10),
            partner_id: parseInt(this.partnerId, 10)
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            throw new Error(`Shopee Token Exchange Failed: ${res.status}`);
        }

        return await res.json();
    }

    /**
     * Utility method to build an authenticated request URL.
     */
    public buildRequestUrl(path: string, accessToken: string, shopId: string, additionalParams: Record<string, any> = {}): string {
        const { timestamp, sign } = this.generateSignature(path, accessToken, shopId);
        
        const url = new URL(`${this.host}${path}`);
        url.searchParams.append('partner_id', this.partnerId);
        url.searchParams.append('timestamp', timestamp.toString());
        url.searchParams.append('access_token', accessToken);
        url.searchParams.append('shop_id', shopId);
        url.searchParams.append('sign', sign);

        // Append any additional query parameters
        Object.entries(additionalParams).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                url.searchParams.append(key, value.toString());
            }
        });

        return url.toString();
    }

    /**
     * Exchanges a refresh token for a new access token via Shopee V2 API.
     */
    public async refreshAccessToken(refreshToken: string, shopId: string): Promise<any> {
        const path = '/api/v2/auth/access_token/get';
        const { timestamp, sign } = this.generateSignature(path);
        
        const url = `${this.host}${path}?partner_id=${this.partnerId}&timestamp=${timestamp}&sign=${sign}`;

        const body = {
            refresh_token: refreshToken,
            shop_id: parseInt(shopId, 10),
            partner_id: parseInt(this.partnerId, 10)
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            throw new Error(`Shopee Token Refresh Failed: ${res.status}`);
        }

        return await res.json();
    }

    /**
     * Validates an incoming Shopee V2 Push webhook signature.
     * Shopee Webhook Signature = HMAC-SHA256(partnerKey, webhook_url + request_body)
     */
    public validateWebhookSignature(authorizationHeader: string, webhookUrl: string, rawBody: string): boolean {
        if (!authorizationHeader) return false;
        
        const baseString = `${webhookUrl}|${rawBody}`;
        const computedSignature = crypto
            .createHmac('sha256', this.partnerKey)
            .update(baseString)
            .digest('hex');

        return computedSignature === authorizationHeader;
    }
}
