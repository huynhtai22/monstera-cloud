import { NextRequest, NextResponse } from "next/server";
import { fulfillVietQrPayment } from "@/lib/vietqr-gateway";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        logger.info("[SEPAY WEBHOOK] Received transaction event", body);

        // SePay payload: { id: 1234, gateway: "Techcombank", transactionDate: "...", accountNo: "...", content: "MC184920 ...", transferAmount: 1190000, ... }
        const { content, transferAmount } = body;

        if (content && typeof content === "string") {
            // Regex to extract MC<6-digit order code>
            const match = content.match(/MC(\d{6})/i);
            if (match && match[1]) {
                const orderCode = Number(match[1]);
                const result = await fulfillVietQrPayment(orderCode, { transferAmount, rawContent: content });

                if (result.success) {
                    logger.info(`[SEPAY WEBHOOK] Upgraded workspace for order ${orderCode}`);
                    return NextResponse.json({ success: true, message: result.message });
                }
            }
        }

        return NextResponse.json({ success: true, message: "Ignored or processed" });
    } catch (err: any) {
        logger.error("[SEPAY WEBHOOK] Handler error", err);
        return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
    }
}
