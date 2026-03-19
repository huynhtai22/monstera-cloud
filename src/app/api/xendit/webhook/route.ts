import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

const webhookToken = process.env.XENDIT_WEBHOOK_TOKEN as string;

export async function POST(req: Request) {
  try {
    const headersList = await headers();
    const callbackToken = headersList.get('x-callback-token');

    if (callbackToken !== webhookToken) {
      console.error('Invalid Xendit Webhook Token');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const event = await req.json();

    // Handle Invoice Paid Event
    if (event.status === 'PAID') {
      console.log('Xendit Invoice Paid:', event.id, event.external_id);
      
      const externalId = event.external_id as string; // e.g. "invoice-starter-12345"
      const payerEmail = event.payer_email;
      
      // Parse the plan from external_id if needed
      let plan = 'starter';
      if (externalId.includes('professional')) plan = 'professional';
      
      // TODO: Update your database here to mark the user as subscribed
      // Example: await db.user.update({ where: { email: payerEmail }, data: { plan: plan } });
    } else {
      console.log(`Unhandled Xendit Invoice Status: ${event.status}`);
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error(`Xendit Webhook Error: ${err.message}`);
    return NextResponse.json(
      { error: { message: err.message } },
      { status: 500 }
    );
  }
}
