import { NextRequest, NextResponse } from "next/server";
import { fulfillVietQrPayment, verifyPayOSWebhook } from "@/lib/vietqr-gateway";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
        }

        const { code, success, data, signature } = body as Record<string, unknown>;
        if (!data || typeof data !== "object" || !verifyPayOSWebhook(data as Record<string, unknown>, String(signature ?? ""))) {
            logger.warn("[PAYOS WEBHOOK] Rejected event with missing or invalid signature");
            return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
        }

        const payment = data as Record<string, unknown>;
        logger.info("[PAYOS WEBHOOK] Received verified event", { code, success, orderCode: payment.orderCode });

        if (code === "00" && success === true && payment.orderCode) {
            const orderCode = Number(payment.orderCode);
            const result = await fulfillVietQrPayment(orderCode, payment);

            if (result.success) {
                logger.info(`[PAYOS WEBHOOK] Successfully processed payment for order ${orderCode}`);
                return NextResponse.json({ success: true, message: result.message });
            } else {
                logger.warn(`[PAYOS WEBHOOK] Payment fulfillment failed: ${result.message}`);
                return NextResponse.json({ error: result.message }, { status: 500 });
            }
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        logger.error("[PAYOS WEBHOOK] Handler error", err);
        return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
    }
}
