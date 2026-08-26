/**
 * Idempotent Connection Upsert — Identity Mapping
 *
 * Uses workspaceId + provider + remoteAccountId as the composite identity key.
 * If a connection already exists for this identity, it updates credentials and
 * metadata (reconnection flow). If not, it creates a new record.
 *
 * This prevents duplicate Bento boxes when a user reconnects the same
 * remote account multiple times.
 */

import prisma from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";

export interface UpsertConnectionInput {
    workspaceId: string;
    provider: string;
    remoteAccountId: string;
    name: string;
    type: string;
    credentials: Record<string, unknown>;
    status?: string;
    clientId?: string | null;
}

/**
 * Canonicalizes a remoteAccountId for a given provider to prevent duplicate
 * connections caused by formatting differences (e.g. "158-170-9190" vs "1581709190",
 * "act_12345" vs "12345", or auto-generated name strings).
 */
export function canonicalizeRemoteAccountId(
    provider: string,
    rawId: string | null | undefined,
    credentials?: Record<string, unknown>
): string {
    const str = (rawId || "").trim();

    if (provider === "google_ads") {
        const credsMcc = (credentials?.mccId || credentials?.managerCustomerId) as string | undefined;
        if (credsMcc && typeof credsMcc === "string" && credsMcc.replace(/\D/g, "").length > 0) {
            return credsMcc.replace(/\D/g, "");
        }
        const credsCustomers = (credentials?.customerIds || (credentials?.extraFields as any)?.customerIds) as string[] | undefined;
        if (Array.isArray(credsCustomers) && credsCustomers.length > 0 && typeof credsCustomers[0] === "string") {
            const clean = credsCustomers[0].replace(/\D/g, "");
            if (clean.length > 0) return clean;
        }
        const cleanDigits = str.replace(/\D/g, "");
        if (cleanDigits.length >= 8) return cleanDigits;
        return str || "google_ads";
    }

    if (provider === "meta_ads") {
        const credsBm = (credentials?.businessManagerId || credentials?.bmId) as string | undefined;
        if (credsBm && typeof credsBm === "string" && credsBm.trim().length > 0) {
            return `bm_${credsBm.replace(/\D/g, "")}`;
        }
        const credsAds = (credentials?.adAccounts || credentials?.adAccountIds) as Array<{ id: string } | string> | undefined;
        if (Array.isArray(credsAds) && credsAds.length > 0) {
            const first = typeof credsAds[0] === "object" ? credsAds[0]?.id : credsAds[0];
            if (first) return String(first).startsWith("act_") ? String(first) : `act_${String(first).replace(/\D/g, "")}`;
        }
        if (str.startsWith("act_")) return str;
        const cleanDigits = str.replace(/\D/g, "");
        if (cleanDigits.length >= 6) return `act_${cleanDigits}`;
        return str || "meta_ads";
    }

    if (provider === "tiktok_business") {
        const credsBc = (credentials?.businessCenterId || credentials?.bcId) as string | undefined;
        if (credsBc && typeof credsBc === "string" && credsBc.trim().length > 0) {
            return `bc_${credsBc.trim()}`;
        }
        const cleanDigits = str.replace(/\D/g, "");
        if (cleanDigits.length >= 8) return cleanDigits;
        return str || "tiktok_business";
    }

    if (provider === "shopee") {
        const shopId = credentials?.shop_id || credentials?.shopId;
        if (shopId) return String(shopId);
        return str || "shopee";
    }

    if (provider === "shopify") {
        const domain = (credentials?.shopDomain || credentials?.domain || credentials?.shop) as string | undefined;
        if (domain) return domain.toLowerCase().trim();
        return str.toLowerCase().trim() || "shopify";
    }

    return str || provider;
}

/**
 * Upsert a connection by its identity triple (workspaceId, provider, remoteAccountId).
 * Returns the connection record (either updated or newly created).
 */
export async function upsertSourceConnection(
    input: UpsertConnectionInput
) {
    const credentialString = encrypt(JSON.stringify(input.credentials));
    const canonicalRemoteId = canonicalizeRemoteAccountId(input.provider, input.remoteAccountId, input.credentials);
    const identity = {
        workspaceId: input.workspaceId,
        provider: input.provider,
        remoteAccountId: canonicalRemoteId,
    };

    let existing = await prisma.connection.findUnique({
        where: { workspaceId_provider_remoteAccountId: identity },
        select: { id: true, remoteAccountId: true },
    });

    if (!existing) {
        // Check for legacy variations or default name strings
        const potentialMatches = await prisma.connection.findMany({
            where: {
                workspaceId: input.workspaceId,
                provider: input.provider,
            },
            select: { id: true, remoteAccountId: true, credentials: true },
        });

        for (const conn of potentialMatches) {
            let matchCreds: Record<string, unknown> = {};
            try {
                matchCreds = typeof conn.credentials === "string" ? JSON.parse(conn.credentials) : (conn.credentials ?? {});
            } catch {
                matchCreds = {};
            }
            const existingCanonical = canonicalizeRemoteAccountId(input.provider, conn.remoteAccountId, matchCreds);
            if (existingCanonical === canonicalRemoteId) {
                existing = conn;
                break;
            }
        }
    }

    if (existing) {
        const updated = await prisma.connection.update({
            where: { id: existing.id },
            data: {
                name: input.name,
                remoteAccountId: canonicalRemoteId,
                credentials: credentialString,
                status: input.status ?? "connected",
                lastError: null,
                updatedAt: new Date(),
                ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
            },
        });
        logger.info(
            `[CONNECTION_UPSERT] ${input.provider} for workspace ${input.workspaceId}: updated existing connection (id=${updated.id}, canonical=${canonicalRemoteId})`
        );
        return Object.assign(updated, { created: false });
    }

    // Use Prisma upsert with the composite unique key.
    const connection = await prisma.connection.upsert({
        where: {
            workspaceId_provider_remoteAccountId: identity,
        },
        update: {
            name: input.name,
            remoteAccountId: canonicalRemoteId,
            credentials: credentialString,
            status: input.status ?? "connected",
            lastError: null,
            updatedAt: new Date(),
            ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
        },
        create: {
            workspaceId: input.workspaceId,
            name: input.name,
            type: input.type,
            provider: input.provider,
            remoteAccountId: canonicalRemoteId,
            credentials: credentialString,
            status: input.status ?? "connected",
            lastError: null,
            ...(input.clientId ? { clientId: input.clientId } : {}),
        },
    });

    const created = !existing;
    logger.info(
        `[CONNECTION_UPSERT] ${input.provider} for workspace ${input.workspaceId}: ${created ? "created" : "updated"} (id=${connection.id}, canonical=${canonicalRemoteId})`
    );

    return Object.assign(connection, { created });
}
