import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { plan, email } = body;

    const origin = req.headers.get('origin') || 'http://localhost:3000';
    
    // Determine price based on plan
    const amount = plan === 'professional' ? 149 : 49;
    const description = plan === 'professional' ? 'Monstera Cloud Professional Plan' : 'Monstera Cloud Starter Plan';
    
    // Xendit API requires base64 encoded secret key + ':'
    const secretKey = process.env.XENDIT_SECRET_KEY || '';
    const authHeader = `Basic ${Buffer.from(secretKey + ':').toString('base64')}`;

    console.log(`Creating Xendit invoice for ${plan} plan at $${amount}`);

    const response = await fetch('https://api.xendit.co/v2/invoices', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify({
        external_id: `invoice-${plan}-${Date.now()}`,
        amount: amount,
        currency: 'USD',
        description: description,
        payer_email: email || 'customer@example.com',
        success_redirect_url: `${origin}/success`,
        failure_redirect_url: `${origin}/pricing`,
      }),
    });

    const xenditData = await response.json();

    if (!response.ok) {
      console.error('Xendit Error:', xenditData);
      throw new Error(xenditData.message || 'Failed to create Xendit invoice');
    }

    // Return the Xendit checkout URL to the frontend
    return NextResponse.json({ url: xenditData.invoice_url });
  } catch (err: any) {
    console.error('Error creating Xendit Invoice:', err);
    return NextResponse.json(
      { error: { message: err.message } },
      { status: 500 }
    );
  }
}
