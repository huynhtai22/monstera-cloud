import { NextRequest, NextResponse } from "next/server";
import { fulfillVietQrPayment, listRecentVietQrOrders } from "@/lib/vietqr-gateway";

export async function GET() {
    try {
        const orders = await listRecentVietQrOrders(30);
        return NextResponse.json({ orders });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to list orders" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
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
