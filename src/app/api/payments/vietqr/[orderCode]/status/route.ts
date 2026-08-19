import { NextRequest, NextResponse } from "next/server";
import { getVietQrOrder } from "@/lib/vietqr-gateway";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ orderCode: string }> }
) {
    try {
        const { orderCode } = await params;
        const codeNum = parseInt(orderCode, 10);
        if (isNaN(codeNum)) {
            return NextResponse.json({ error: "Invalid order code" }, { status: 400 });
        }

        const order = await getVietQrOrder(codeNum);
        if (!order) {
            return NextResponse.json({ error: "Order not found" }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            status: order.status,
            orderCode: order.orderCode,
            plan: order.plan,
            amount: order.amount,
            paidAt: order.paidAt,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to check status" }, { status: 500 });
    }
}
