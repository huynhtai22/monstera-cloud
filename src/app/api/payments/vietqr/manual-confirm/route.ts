import { NextResponse } from "next/server";
import { listRecentVietQrOrders } from "@/lib/vietqr-gateway";
import { requirePlatformAdmin } from "@/lib/admin-auth";

/**
 * Order visibility for platform admins. Activation is deliberately webhook-only.
 */
export async function GET() {
    const auth = await requirePlatformAdmin();
    if (auth.error) return auth.error;
    try {
        const orders = await listRecentVietQrOrders(30);
        return NextResponse.json({ orders });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to list orders" }, { status: 500 });
    }
}

export async function POST() {
    const auth = await requirePlatformAdmin();
    if (auth.error) return auth.error;
    return NextResponse.json({ error: "Manual activation is disabled. PayOS webhooks are the only activation source." }, { status: 410 });
}
