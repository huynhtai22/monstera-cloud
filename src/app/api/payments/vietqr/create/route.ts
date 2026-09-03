import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { createVietQrOrder } from "@/lib/vietqr-gateway";
import { type PlanName } from "@/lib/plan-config";
import { authOptions } from "@/lib/auth";
import { confirmPayOSWebhook, getPayOSReadiness } from "@/lib/payos";
import { getRedis } from "@/lib/redis";
import { PaymentWorkspaceError, resolveBillableWorkspaceId } from "@/lib/payment-workspace";

async function ensurePayOSWebhook(webhookUrl: string): Promise<void> {
    const key = "payos_confirmed_webhook_url";
    try {
        const redis = getRedis();
        if (await redis.get(key) === webhookUrl) return;
        await confirmPayOSWebhook(webhookUrl);
        await redis.set(key, webhookUrl, { ex: 60 * 60 * 24 * 30 });
    } catch (error) {
        // Confirmation is deliberately required before checkout. If Redis is
        // unavailable, retry confirmation rather than assuming PayOS is wired.
        if (error instanceof Error && error.message.startsWith("PayOS")) throw error;
        await confirmPayOSWebhook(webhookUrl);
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id || !session.user.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const body = await req.json();
        const { plan, billingCycle = "monthly", workspaceId } = body;

        if (!plan || !["starter", "professional", "enterprise"].includes(plan)) {
            return NextResponse.json({ error: "Invalid plan specified" }, { status: 400 });
        }

        const readiness = getPayOSReadiness();
        if (!readiness.ready) {
            return NextResponse.json({ error: "Domestic payments are not ready yet. Please contact support." }, { status: 503 });
        }

        const billableWorkspaceId = await resolveBillableWorkspaceId({
            userId: session.user.id,
            requestedWorkspaceId: typeof workspaceId === "string" ? workspaceId : undefined,
        });

        const origin = (process.env.NEXTAUTH_URL?.replace(/\/$/, "") || new URL(req.url).origin).replace(/\/$/, "");
        // PayOS's embedded checkout requires its return URL to be the same
        // Monstera page that hosts the secure payment panel. Bind the workspace
        // in the URL only after it has passed the owner check above.
        const checkoutPath = `/pricing${workspaceId ? `?workspaceId=${encodeURIComponent(billableWorkspaceId)}` : ""}`;
        await ensurePayOSWebhook(`${origin}/api/webhooks/payos`);
        const order = await createVietQrOrder({
            plan: plan as PlanName,
            billingCycle: billingCycle === "annual" ? "annual" : "monthly",
            userEmail: session.user.email,
            userId: session.user.id,
            workspaceId: billableWorkspaceId,
            returnUrl: `${origin}${checkoutPath}`,
            cancelUrl: `${origin}${checkoutPath}`,
        });

        return NextResponse.json({
            success: true,
            order,
        });
    } catch (err) {
        if (err instanceof PaymentWorkspaceError) {
            return NextResponse.json({ error: err.message }, { status: err.statusCode });
        }
        console.error("[PAYOS] Failed to create checkout", err);
        return NextResponse.json({ error: "Unable to start payment checkout" }, { status: 503 });
    }
}
