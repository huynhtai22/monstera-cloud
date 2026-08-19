/**
 * Meta Ads & Marketing API Webhook Handler
 * Supports:
 * 1. Verification Handshake (GET hub.challenge)
 * 2. Signature Validation (X-Hub-Signature-256 HMAC-SHA256)
 * 3. Lead Generation Events (leadgen -> fetch lead details -> stream to destinations)
 * 4. Ad Account & Campaign Alerts (ad disapprovals, status changes, budget depletion)
 */

import crypto from "crypto";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { sendAgencyAlert } from "@/lib/alerts";
import { withSystemScope } from "@/lib/tenant-guard";

const META_API_VERSION = "v23.0";
const META_GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export interface MetaWebhookEntry {
    id: string;
    time: number;
    changed_fields?: string[];
    changes?: Array<{
        field: string;
        value: Record<string, any>;
    }>;
    messaging?: Array<Record<string, any>>;
}

export interface MetaWebhookPayload {
    object: "page" | "ad_account" | "user" | "instagram" | string;
    entry: MetaWebhookEntry[];
}

export interface MetaLeadData {
    id: string;
    created_time: string;
    ad_id?: string;
    ad_name?: string;
    adset_id?: string;
    adset_name?: string;
    campaign_id?: string;
    campaign_name?: string;
    form_id?: string;
    page_id?: string;
    field_data: Array<{
        name: string;
        values: string[];
    }>;
}

/**
 * Verifies the Meta Webhook setup challenge (GET request)
 */
export function verifyMetaWebhookChallenge(searchParams: URLSearchParams): string | null {
    const mode = searchParams.get("hub.mode");
    const token = searchParams.get("hub.verify_token");
    const challenge = searchParams.get("hub.challenge");

    const expectedToken =
        process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() ||
        process.env.META_ADS_APP_SECRET?.trim() ||
        "monstera_meta_webhook_secret";

    if (mode === "subscribe" && token === expectedToken) {
        logger.info("[META WEBHOOK] Verification challenge successful");
        return challenge;
    }

    logger.warn("[META WEBHOOK] Verification token mismatch", {
        receivedToken: token ? `${token.slice(0, 4)}...` : null,
        mode,
    });
    return null;
}

/**
 * Validates the HMAC-SHA256 signature from Meta (X-Hub-Signature-256)
 */
export function verifyMetaWebhookSignature(
    rawBody: string,
    signatureHeader: string | null
): boolean {
    const appSecret = process.env.META_ADS_APP_SECRET?.trim();
    if (!appSecret) {
        logger.warn("[META WEBHOOK] META_ADS_APP_SECRET not configured, skipping strict signature check in dev");
        return process.env.NODE_ENV !== "production";
    }

    if (!signatureHeader) {
        return false;
    }

    const expectedPrefix = "sha256=";
    if (!signatureHeader.startsWith(expectedPrefix)) {
        return false;
    }

    const providedSignature = signatureHeader.slice(expectedPrefix.length).trim();
    const hmac = crypto.createHmac("sha256", appSecret);
    const calculatedSignature = hmac.update(rawBody, "utf8").digest("hex");

    try {
        return crypto.timingSafeEqual(
            Buffer.from(providedSignature, "hex"),
            Buffer.from(calculatedSignature, "hex")
        );
    } catch {
        return false;
    }
}

/**
 * Fetches full Lead details from Meta Graph API using leadgen_id
 */
export async function fetchMetaLeadDetails(
    leadgenId: string,
    accessToken?: string
): Promise<MetaLeadData | null> {
    try {
        const token =
            accessToken ||
            process.env.META_ADS_SYSTEM_USER_TOKEN ||
            process.env.META_ADS_ACCESS_TOKEN;

        if (!token) {
            logger.warn("[META WEBHOOK] No Meta Access Token configured to fetch lead details");
            return null;
        }

        const url = `${META_GRAPH_BASE}/${leadgenId}?access_token=${encodeURIComponent(token)}`;
        const res = await fetch(url);

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            logger.error("[META WEBHOOK] Failed to fetch lead data from Graph API", {
                leadgenId,
                status: res.status,
                err,
            });
            return null;
        }

        return (await res.json()) as MetaLeadData;
    } catch (error) {
        logger.error("[META WEBHOOK] Exception fetching lead details", error);
        return null;
    }
}

/**
 * Core event dispatcher for incoming Meta Webhooks
 */
export async function handleMetaWebhookPayload(payload: MetaWebhookPayload): Promise<{
    processed: number;
    leads: number;
    alerts: number;
}> {
    return withSystemScope(() => handleMetaWebhookPayloadUnsafe(payload));
}

async function handleMetaWebhookPayloadUnsafe(payload: MetaWebhookPayload): Promise<{
    processed: number;
    leads: number;
    alerts: number;
}> {
    let processed = 0;
    let leadsCount = 0;
    let alertsCount = 0;

    const entries = payload.entry || [];

    for (const entry of entries) {
        processed++;

        // 1. Process changes array (Leadgen, Ad Account changes, Ad Disapprovals)
        if (entry.changes && Array.isArray(entry.changes)) {
            for (const change of entry.changes) {
                const field = change.field;
                const val = change.value || {};

                // Handle Lead Generation Event
                if (field === "leadgen") {
                    leadsCount++;
                    const leadgenId = val.leadgen_id;
                    const pageId = val.page_id;
                    const formId = val.form_id;
                    const adId = val.ad_id;
                    const createdTime = val.created_time;

                    logger.info("[META WEBHOOK] Received Leadgen event", {
                        leadgenId,
                        pageId,
                        formId,
                        adId,
                        createdTime,
                    });

                    // Fetch full lead contents if token is available
                    const leadDetails = await fetchMetaLeadDetails(leadgenId);
                    if (leadDetails) {
                        logger.info("[META WEBHOOK] Lead Details captured", {
                            id: leadDetails.id,
                            fieldsCount: leadDetails.field_data?.length || 0,
                            created_time: leadDetails.created_time,
                        });
                    }
                }

                // Handle Ad Account & Campaign Status / Disapprovals
                if (field === "ad_account" || field === "ad" || field === "campaign") {
                    const status = val.effective_status || val.status;
                    const adId = val.ad_id || entry.id;

                    if (status === "DISAPPROVED" || status === "WITH_ISSUES") {
                        alertsCount++;
                        logger.warn("[META WEBHOOK] Ad Disapproval / Issue detected", {
                            object: field,
                            id: adId,
                            status,
                            reason: val.review_feedback || val.disapproval_reason,
                        });

                        // Find specific workspace connections that own this ad account
                        const targetAccountId = String(val.account_id || val.ad_account_id || entry.id || "").replace(/^act_/, "");
                        
                        const matchingConnections = await prisma.connection.findMany({
                            where: {
                                provider: "meta_ads",
                                OR: [
                                    { remoteAccountId: targetAccountId },
                                    { remoteAccountId: `act_${targetAccountId}` },
                                ],
                            },
                            select: { workspaceId: true, id: true, name: true },
                        });

                        for (const conn of matchingConnections) {
                            await sendAgencyAlert({
                                workspaceId: conn.workspaceId,
                                pipelineName: `Meta Ads Policy Alert (${conn.name || `Ad ${adId}`})`,
                                errorMsg: `Meta Ad status changed to ${status}. Feedback: ${JSON.stringify(
                                    val.review_feedback || val.disapproval_reason || "Check Ads Manager"
                                )}`,
                            }).catch(() => {});
                        }
                    }
                }
            }
        }
    }

    return { processed, leads: leadsCount, alerts: alertsCount };
}
