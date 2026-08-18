import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
    verifyMetaWebhookChallenge,
    verifyMetaWebhookSignature,
    handleMetaWebhookPayload,
    type MetaWebhookPayload,
} from "@/lib/meta-webhooks";

export const dynamic = "force-dynamic";

/**
 * GET /api/webhooks/meta-ads
 * Handles Meta Webhook verification challenge during webhook subscription setup.
 */
export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const challenge = verifyMetaWebhookChallenge(searchParams);

    if (challenge !== null) {
        return new Response(challenge, {
            status: 200,
            headers: {
                "Content-Type": "text/plain",
            },
        });
    }

    return NextResponse.json(
        { error: "Forbidden: verification token mismatch" },
        { status: 403 }
    );
}

/**
 * POST /api/webhooks/meta-ads
 * Handles real-time Meta Ads events (Lead Gen submissions, ad disapprovals, campaign status changes).
 */
export async function POST(request: NextRequest) {
    try {
        const rawBody = await request.text();
        const signature = request.headers.get("x-hub-signature-256");

        // Verify cryptographic HMAC-SHA256 signature
        const isValidSignature = verifyMetaWebhookSignature(rawBody, signature);
        if (!isValidSignature) {
            logger.warn("[META WEBHOOK] Invalid or missing signature header", {
                hasSignature: !!signature,
            });
            return NextResponse.json(
                { error: "Invalid signature" },
                { status: 401 }
            );
        }

        const payload = JSON.parse(rawBody) as MetaWebhookPayload;
        logger.info("[META WEBHOOK] Received event payload", {
            object: payload.object,
            entriesCount: payload.entry?.length || 0,
        });

        // Process event asynchronously/promptly
        const summary = await handleMetaWebhookPayload(payload);

        // Always return 200 OK to Meta quickly to avoid retry storms
        return NextResponse.json({
            success: true,
            summary,
        });
    } catch (error) {
        logger.error("[META WEBHOOK] Error processing webhook event", error);
        // Even on error, return 200/500 depending on nature, but return quickly
        return NextResponse.json(
            { error: "Internal processing error" },
            { status: 500 }
        );
    }
}
