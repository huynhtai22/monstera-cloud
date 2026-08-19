import { NextRequest, NextResponse } from "next/server";
import { fulfillVietQrPayment, verifyPayOSWebhook } from "@/lib/vietqr-gateway";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        logger.info("[PAYOS WEBHOOK] Received event", body);

        // PayOS payload structure: { code: "00", desc: "success", data: { orderCode: 123456, amount: 1190000, description: "MC123456", ... }, signature: "..." }
        const { code, data, signature } = body;

        if (signature && data) {
            const isValid = verifyPayOSWebhook(data, signature);
            if (!isValid) {
                logger.warn("[PAYOS WEBHOOK] Invalid signature detected", { signature });
                return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
            }
        }

        if (code === "00" && data && data.orderCode) {
            const orderCode = Number(data.orderCode);
            const result = await fulfillVietQrPayment(orderCode, data);

            if (result.success) {
                logger.info(`[PAYOS WEBHOOK] Successfully processed payment for order ${orderCode}`);
                return NextResponse.json({ success: true, message: result.message });
            } else {
                logger.warn(`[PAYOS WEBHOOK] Payment fulfillment failed: ${result.message}`);
            }
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        logger.error("[PAYOS WEBHOOK] Handler error", err);
        return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
    }
}
