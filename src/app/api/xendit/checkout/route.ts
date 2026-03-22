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
    let monthlyAmount = plan === 'professional' ? 149 : 49;
    let amount = monthlyAmount;
    
    if (billingCycle === 'annual') {
      amount = Math.round(monthlyAmount * 0.8 * 12); // 20% discount * 12 months
    }
    
    const description = `Monstera Cloud ${plan === 'professional' ? 'Professional' : 'Starter'} Plan (${billingCycle})`;
    
    console.log(`Creating Xendit invoice for ${plan} ${billingCycle} plan at $${amount} for ${session.user.email}`);

    const invoiceData = {
      external_id: `invoice-${plan}-${session.user.email}-${Date.now()}`,
      amount: amount,
      description: description,
      payer_email: session.user.email,
      success_redirect_url: `${origin}/dashboard?payment=success`,
      failure_redirect_url: `${origin}/pricing?payment=failed`,
      customer: {
          given_names: session.user.name || 'Customer',
          email: session.user.email,
      },
      currency: process.env.XENDIT_DEFAULT_CURRENCY || 'USD',
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
