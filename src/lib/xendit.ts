/**
 * Xendit Payment Client
 * Uses official xendit-node SDK + maps responses for the app.
 */

import Xendit, { XenditSdkError } from 'xendit-node';
import type { CreateInvoiceRequest } from 'xendit-node/invoice/models';

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

function getSecretKey(): string {
  return (process.env.XENDIT_SECRET_KEY || '').trim();
}

function toIsoString(value: string | Date | undefined): string {
  if (value == null) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

function formatXenditSdkError(err: XenditSdkError): string {
  const raw = err.rawResponse;
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const errors = r.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0] as Record<string, unknown>;
      const msg = [first.field, first.message].filter(Boolean).join(': ');
      if (msg) return msg;
    }
  }
  const code = err.errorCode ? String(err.errorCode) : '';
  const msg = err.errorMessage ? String(err.errorMessage) : '';
  if (code && msg) return `${code}: ${msg}`;
  if (msg) return msg;
  return err.message;
}

export class XenditClient {
  /**
   * Create a new invoice (Checkout Link).
   * Pass snake_case fields to match API / existing route code.
   */
  static async createInvoice(data: {
    external_id: string;
    amount: number;
    payer_email: string;
    description: string;
    success_redirect_url: string;
    failure_redirect_url: string;
    currency?: string;
    customer?: {
      given_names?: string;
      email?: string;
    };
    metadata?: Record<string, unknown>;
  }): Promise<XenditInvoiceResponse> {
    const secretKey = getSecretKey();
    if (!secretKey) {
      throw new Error('XENDIT_SECRET_KEY is not defined in environment variables.');
    }

    const payload: CreateInvoiceRequest = {
      externalId: data.external_id,
      amount: data.amount,
      payerEmail: data.payer_email,
      description: data.description,
      successRedirectUrl: data.success_redirect_url,
      failureRedirectUrl: data.failure_redirect_url,
      currency: (data.currency || process.env.XENDIT_DEFAULT_CURRENCY || 'USD').toUpperCase(),
      customer:
        data.customer?.given_names || data.customer?.email
          ? {
              givenNames: data.customer.given_names,
              email: data.customer.email,
            }
          : undefined,
      metadata: data.metadata,
    };

    console.log('[Xendit] createInvoice payload (no secrets):', JSON.stringify(payload, null, 2));

    const xendit = new Xendit({ secretKey });

    try {
      const inv = await xendit.Invoice.createInvoice({ data: payload });

      return {
        id: inv.id ?? '',
        external_id: inv.externalId,
        user_id: inv.userId ?? '',
        status: (inv.status as XenditInvoiceResponse['status']) ?? 'PENDING',
        merchant_name: inv.merchantName ?? '',
        merchant_profile_picture_url: inv.merchantProfilePictureUrl ?? '',
        amount: inv.amount ?? data.amount,
        payer_email: inv.payerEmail ?? data.payer_email,
        description: inv.description ?? data.description,
        expiry_date: toIsoString(inv.expiryDate),
        invoice_url: inv.invoiceUrl,
        should_exclude_credit_card: inv.shouldExcludeCreditCard ?? false,
        should_send_email: inv.shouldSendEmail ?? false,
        created: toIsoString(inv.created),
        updated: toIsoString(inv.updated),
        currency: inv.currency ?? payload.currency ?? 'USD',
      };
    } catch (e: unknown) {
      if (e instanceof XenditSdkError) {
        const message = formatXenditSdkError(e);
        console.error('[Xendit] Invoice creation failed:', e.status, message, e.rawResponse);
        throw new Error(message);
      }
      throw e;
    }
  }

  /**
   * Verify Webhook Signature (Token-based for Invoices)
   */
  static verifyWebhookToken(token: string | null): boolean {
    const webhookToken = (process.env.XENDIT_WEBHOOK_TOKEN || '').trim();
    if (!webhookToken) return true; // Bypass if not set (for initial dev)
    return token === webhookToken;
  }
}
