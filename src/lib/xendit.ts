/**
 * Xendit Payment Client
 * Handles integration with Xendit Invoices API for subscription management.
 */

export const XENDIT_SECRET_KEY = process.env.XENDIT_SECRET_KEY || '';
export const XENDIT_WEBHOOK_TOKEN = process.env.XENDIT_WEBHOOK_TOKEN || '';

export interface XenditInvoiceResponse {
  id: string;
  external_id: string;
  user_id: string;
  status: 'PENDING' | 'PAID' | 'SETTLED' | 'EXPIRED';
  merchant_name: string;
  merchant_profile_picture_url: string;
  amount: number;
  payer_email: string;
  description: string;
  expiry_date: string;
  invoice_url: string;
  should_exclude_credit_card: boolean;
  should_send_email: boolean;
  created: string;
  updated: string;
  currency: string;
}

export class XenditClient {
  private static getAuthHeader() {
    const secretKey = process.env.XENDIT_SECRET_KEY || '';
    return `Basic ${Buffer.from(secretKey + ':').toString('base64')}`;
  }

  /**
   * Create a new invoice (Checkout Link)
   */
  static async createInvoice(data: {
    external_id: string;
    amount: number;
    payer_email: string;
    description: string;
    success_redirect_url: string;
    failure_redirect_url: string;
    customer?: {
        given_names?: string;
        email?: string;
    };
  }): Promise<XenditInvoiceResponse> {
    const secretKey = process.env.XENDIT_SECRET_KEY || '';
    if (!secretKey) {
      throw new Error('XENDIT_SECRET_KEY is not defined in environment variables.');
    }

    console.log('XENDIT_SECRET_KEY length:', secretKey.length);
    console.log('Sending Xendit invoice request payload:', JSON.stringify({
      currency: 'USD',
      ...data,
    }, null, 2));
    const response = await fetch('https://api.xendit.co/v2/invoices', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.getAuthHeader(),
      },
      body: JSON.stringify({
        currency: process.env.XENDIT_DEFAULT_CURRENCY || 'USD', // Configurable currency
        ...data,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Xendit Invoice Creation Failed:', result);
      throw new Error(result.message || 'Failed to create Xendit invoice');
    }

    return result as XenditInvoiceResponse;
  }

  /**
   * Verify Webhook Signature (Token-based for Invoices)
   */
  static verifyWebhookToken(token: string | null): boolean {
    const webhookToken = process.env.XENDIT_WEBHOOK_TOKEN || '';
    if (!webhookToken) return true; // Bypass if not set (for initial dev)
    return token === webhookToken;
  }
}
