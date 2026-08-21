import { NextRequest, NextResponse } from "next/server";
import { fulfillVietQrPayment } from "@/lib/vietqr-gateway";
import { logger } from "@/lib/logger";
import { extractSepaySignature, verifySepaySignature } from "./verify-signature";

/**
 * SePay bank-transfer webhook → VietQR order fulfillment.
 *
 * Security: the RAW body is HMAC-SHA256-verified against SEPAY_WEBHOOK_SECRET
 * BEFORE any fulfillment runs (fail closed on missing secret/signature), and the
 * transferred amount must cover the order amount (validated inside
 * fulfillVietQrPayment). Non-matching events return 200 so SePay does not
 * retry unrelated transactions; invalid signatures return 401.
 */
export async function POST(req: NextRequest) {
    let rawBody: string;
    try {
        rawBody = await req.text();
    } catch {
        return NextResponse.json({ error: "Unreadable body" }, { status: 400 });
    }

    const signature = extractSepaySignature(req);
    if (!verifySepaySignature(rawBody, signature, process.env.SEPAY_WEBHOOK_SECRET)) {
        logger.warn("[SEPAY WEBHOOK] Rejected event with missing/invalid signature");
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    try {
        const body = JSON.parse(rawBody);
        logger.info("[SEPAY WEBHOOK] Received verified transaction event");

        // SePay payload: { id, gateway, transactionDate, accountNo, content: "MC184920 ...", transferAmount, ... }
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
                logger.warn(`[SEPAY WEBHOOK] Did not fulfill order ${orderCode}: ${result.message}`);
            }
        }

        return NextResponse.json({ success: true, message: "Ignored or processed" });
    } catch (err: any) {
        logger.error("[SEPAY WEBHOOK] Handler error", err);
        return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
    }
}
