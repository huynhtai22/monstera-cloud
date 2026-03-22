import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { XenditClient } from '@/lib/xendit';
import prisma from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    const headersList = await headers();
    const callbackToken = headersList.get('x-callback-token');

    if (!XenditClient.verifyWebhookToken(callbackToken)) {
      console.error('Invalid Xendit Webhook Token');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const event = await req.json();

    // Handle Invoice Paid Event
    if (event.status === 'PAID') {
      const externalId = event.external_id as string; // e.g. "invoice-starter-user@example.com-12345"
      const payerEmail = event.payer_email;
      const invoiceId = event.id;
      
      console.log(`Xendit Invoice Paid: ${invoiceId} for ${payerEmail} (${externalId})`);
      
      // Parse the plan from external_id
      let plan = 'free';
      if (externalId.includes('professional')) {
        plan = 'professional';
      } else if (externalId.includes('starter')) {
        plan = 'starter';
      }
      
      // Update the user's plan in the database
      if (payerEmail) {
        await (prisma.user as any).update({
          where: { email: payerEmail },
          data: { 
            plan: plan,
            subscriptionId: invoiceId // Use Xendit Invoice ID as subscription reference
          }
        });
        console.log(`User ${payerEmail} upgraded to ${plan} plan.`);
      }
    } else {
      console.log(`Unhandled Xendit Invoice Status: ${event.status} for ${event.id}`);
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
