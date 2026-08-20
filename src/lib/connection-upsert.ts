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
 * Upsert a connection by its identity triple (workspaceId, provider, remoteAccountId).
 * Returns the connection record (either updated or newly created).
 */
export async function upsertSourceConnection(
    input: UpsertConnectionInput
) {
    const credentialString = encrypt(JSON.stringify(input.credentials));
    const identity = {
        workspaceId: input.workspaceId,
        provider: input.provider,
        remoteAccountId: input.remoteAccountId,
    };

    const existing = await prisma.connection.findUnique({
        where: { workspaceId_provider_remoteAccountId: identity },
        select: { id: true },
    });

    // Use Prisma upsert with the composite unique key.
    const connection = await prisma.connection.upsert({
        where: {
            workspaceId_provider_remoteAccountId: identity,
        },
        update: {
            name: input.name,
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
            remoteAccountId: input.remoteAccountId,
            credentials: credentialString,
            status: input.status ?? "connected",
            lastError: null,
            ...(input.clientId ? { clientId: input.clientId } : {}),
        },
    });

    const created = !existing;
    logger.info(
        `[CONNECTION_UPSERT] ${input.provider} for workspace ${input.workspaceId}: ${created ? "created" : "updated"} (id=${connection.id})`
    );

    return Object.assign(connection, { created });
}
