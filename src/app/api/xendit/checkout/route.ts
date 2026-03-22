import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { XenditClient } from '@/lib/xendit';

/** Supported invoice currencies. VND + USD first; IDR only if you set it explicitly. */
const ALLOWED_CURRENCIES = ['VND', 'USD', 'IDR'] as const;
type AllowedCurrency = (typeof ALLOWED_CURRENCIES)[number];

function resolveCurrency(bodyCurrency: unknown, envDefault: string | undefined): AllowedCurrency | null {
  const raw = String(bodyCurrency || envDefault || 'VND')
    .trim()
    .toUpperCase();
  if (!ALLOWED_CURRENCIES.includes(raw as AllowedCurrency)) {
    return null;
  }
  return raw as AllowedCurrency;
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { plan, billingCycle } = body;

    const currency = resolveCurrency(body.currency, process.env.XENDIT_DEFAULT_CURRENCY);
    if (!currency) {
      return NextResponse.json(
        {
          error: {
            message: `Invalid currency. Use one of: ${ALLOWED_CURRENCIES.join(', ')}`,
          },
        },
        { status: 400 }
      );
    }

    const origin = req.headers.get('origin') || 'http://localhost:3000';

    // List prices are in USD; convert for VND / IDR using env rates.
    const monthlyAmountUsd = plan === 'professional' ? 149 : 49;
    let amountUsd = monthlyAmountUsd;

    if (billingCycle === 'annual') {
      amountUsd = Math.round(monthlyAmountUsd * 0.8 * 12); // 20% discount * 12 months
    }

    const externalId = `mc-${plan}-${randomUUID()}`;

    let amount: number;
    if (currency === 'VND') {
      amount = Math.round(amountUsd * Number(process.env.XENDIT_VND_PER_USD || '25000'));
    } else if (currency === 'IDR') {
      amount = Math.round(amountUsd * Number(process.env.XENDIT_IDR_PER_USD || '16500'));
    } else {
      amount = amountUsd;
    }

    amount = Math.round(amount);
    if (currency === 'VND' && amount < 50_000) {
      amount = 50_000;
    }
    if (currency === 'IDR' && amount < 10_000) {
      amount = 10_000;
    }

    const description = `Monstera Cloud ${plan === 'professional' ? 'Professional' : 'Starter'} Plan (${billingCycle})`;

    console.log(
      `Creating Xendit invoice ${externalId}: ${plan} ${billingCycle}, amount=${amount} ${currency}, payer=${session.user.email}`
    );

    const metadata: Record<string, string> = {
      plan: String(plan),
      billingCycle: String(billingCycle),
      amount_usd: String(amountUsd),
      invoice_currency: currency,
    };
    if (session.user.id) metadata.user_id = String(session.user.id);

    const invoiceData = {
      external_id: externalId,
      amount,
      description: description,
      payer_email: session.user.email,
      success_redirect_url: `${origin}/dashboard?payment=success`,
      failure_redirect_url: `${origin}/pricing?payment=failed`,
      currency,
      metadata,
    };

    console.log('Sending to Xendit:', JSON.stringify(invoiceData, null, 2));

    const invoice = await XenditClient.createInvoice(invoiceData);

    return NextResponse.json({ url: invoice.invoice_url });
  } catch (err: any) {
    console.error('Error creating Xendit Invoice:', err);
    let message = err.message || 'Failed to create invoice';
    if (typeof message === 'string' && message.includes('SERVER_ERROR')) {
      message +=
        ' — In Xendit Dashboard, enable the invoice currency you use (VNĐ or USD). You can switch currency on the pricing page or set XENDIT_DEFAULT_CURRENCY.';
    }
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}
