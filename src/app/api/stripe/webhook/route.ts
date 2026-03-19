import { headers } from "next/headers";
import { NextResponse } from "next/server";

const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;

export async function POST(req: Request) {
  try {
    const body = await req.text();
    const headersList = await headers();
    const signature = headersList.get("stripe-signature");

    if (!signature || !stripeWebhookSecret) {
      console.warn("⚠️ Stripe webhook signature or secret missing. Bypassing verification for local development.");
      // In a real environment, you must verify the signature with Stripe SDK
      // const event = stripe.webhooks.constructEvent(body, signature, stripeWebhookSecret);
    }
    
    // Parse the event body assuming we are bypassing signature verification for now
    const event = JSON.parse(body);

    switch (event.type) {
      case "checkout.session.completed":
        const session = event.data.object;
        console.log("💰 Checkout session completed!", session.id);
        break;
      case "invoice.payment_succeeded":
        const invoice = event.data.object;
        console.log("💵 Invoice payment succeeded!", invoice.id);
        break;
      case "customer.subscription.created":
        const subscription = event.data.object;
        console.log("📅 Subscription created!", subscription.id);
        break;
      default:
        console.log(`🤷‍♀️ Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error(`❌ Error message: ${err.message}`);
    return NextResponse.json(
      { error: `Webhook Error: ${err.message}` },
      { status: 400 }
    );
  }
}
