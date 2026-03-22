import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { XenditClient } from '@/lib/xendit';

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { plan, billingCycle } = body;

    const origin = req.headers.get('origin') || 'http://localhost:3000';
    
    // Determine price based on plan and cycle
    // Starter: $49/mo or $39/mo (annual)
    // Pro: $149/mo or $119/mo (annual)
    const monthlyAmountUsd = plan === 'professional' ? 149 : 49;
    let amountUsd = monthlyAmountUsd;

    if (billingCycle === 'annual') {
      amountUsd = Math.round(monthlyAmountUsd * 0.8 * 12); // 20% discount * 12 months
    }

    const currency = (process.env.XENDIT_DEFAULT_CURRENCY || 'USD').toUpperCase();
    // Xendit external_id only allows certain characters — never put raw emails here (no @ / .).
    const externalId = `mc-${plan}-${randomUUID()}`;

    let amount =
      currency === 'IDR'
        ? Math.round(amountUsd * Number(process.env.XENDIT_IDR_PER_USD || '16500'))
        : amountUsd;

    const description = `Monstera Cloud ${plan === 'professional' ? 'Professional' : 'Starter'} Plan (${billingCycle})`;

    console.log(
      `Creating Xendit invoice ${externalId}: ${plan} ${billingCycle}, amount=${amount} ${currency}, payer=${session.user.email}`
    );

    const invoiceData = {
      external_id: externalId,
      amount,
      description: description,
      payer_email: session.user.email,
      success_redirect_url: `${origin}/dashboard?payment=success`,
      failure_redirect_url: `${origin}/pricing?payment=failed`,
      customer: {
        given_names: session.user.name || 'Customer',
        email: session.user.email,
      },
      currency,
      metadata: {
        plan: String(plan),
        billingCycle: String(billingCycle),
        amount_usd: String(amountUsd),
        user_id: session.user.id ? String(session.user.id) : '',
      },
    };

    console.log('Sending to Xendit:', JSON.stringify(invoiceData, null, 2));

    const invoice = await XenditClient.createInvoice(invoiceData);

    // Return the Xendit checkout URL to the frontend
    return NextResponse.json({ url: invoice.invoice_url });
  } catch (err: any) {
    console.error('Error creating Xendit Invoice:', err);
    return NextResponse.json(
      { error: { message: err.message } },
      { status: 500 }
    );
  }
}
