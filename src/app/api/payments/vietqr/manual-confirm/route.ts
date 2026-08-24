import { NextRequest, NextResponse } from "next/server";
import { fulfillVietQrPayment, listRecentVietQrOrders } from "@/lib/vietqr-gateway";
import { requirePlatformAdmin } from "@/lib/admin-auth";

/**
 * Manual bank-transfer confirmation (BD admin) — this mutates workspace plans,
 * so both the order listing and the confirmation require platform-admin auth.
 * Previously both were unauthenticated, letting anyone with a 6-digit order
 * code upgrade any workspace for free.
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

export async function POST(req: NextRequest) {
    const auth = await requirePlatformAdmin();
    if (auth.error) return auth.error;
    try {
        const body = await req.json();
        const { orderCode } = body;

        if (!orderCode) {
            return NextResponse.json({ error: "Missing orderCode" }, { status: 400 });
        }

        const result = await fulfillVietQrPayment(Number(orderCode), { method: "manual_bd_admin" });
        if (!result.success) {
            return NextResponse.json({ error: result.message }, { status: 400 });
        }

        return NextResponse.json({ success: true, message: result.message });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to confirm payment" }, { status: 500 });
    }
}
