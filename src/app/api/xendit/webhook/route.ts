import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { XenditClient } from '@/lib/xendit';
import prisma from '@/lib/prisma';
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  try {
    const headersList = await headers();
    const callbackToken = headersList.get('x-callback-token');

    if (!XenditClient.verifyWebhookToken(callbackToken)) {
      logger.error('Invalid Xendit Webhook Token');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const event = await req.json();

    // Handle Invoice Paid Event
    if (event.status === 'PAID') {
      const externalId = event.external_id as string;
      const payerEmail = event.payer_email as string | undefined;
      const invoiceId = event.id;
      const meta = event.metadata as Record<string, string> | undefined;

      logger.info(`Xendit Invoice Paid: ${invoiceId} for ${payerEmail} (${externalId})`);

      // Prefer metadata.plan (new invoices); fall back to external_id (legacy)
      let plan = "free";
      const metaPlan = meta?.plan;
      if (metaPlan === "professional" || metaPlan === "starter") {
        plan = metaPlan;
      } else if (externalId.includes("professional")) {
        plan = "professional";
      } else if (externalId.includes("starter")) {
        plan = "starter";
      }

      const userIdFromInvoice = meta?.user_id?.trim();

      // Prefer user_id from invoice metadata (set only when an authenticated user created checkout in our API)
      if (userIdFromInvoice) {
        const user = await prisma.user.findUnique({
          where: { id: userIdFromInvoice },
          select: { id: true },
        });
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              plan,
              subscriptionId: String(invoiceId),
            },
          });
          logger.info(`User ${user.id} upgraded to ${plan} (Xendit, user_id metadata).`);
        } else {
          logger.warn("[XENDIT_WEBHOOK] Unknown user_id in metadata", userIdFromInvoice);
        }
      } else if (payerEmail) {
        await prisma.user.updateMany({
          where: { email: { equals: payerEmail, mode: "insensitive" } },
          data: {
            plan,
            subscriptionId: String(invoiceId),
          },
        });
        logger.info(`User ${payerEmail} upgraded to ${plan} plan (email fallback).`);
      }
    } else {
      logger.info(`Unhandled Xendit Invoice Status: ${event.status} for ${event.id}`);
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    logger.error(`Xendit Webhook Error: ${err.message}`);
    return NextResponse.json(
      { error: { message: err.message } },
      { status: 500 }
    );
  }
}
