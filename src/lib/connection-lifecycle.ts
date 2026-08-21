/**
 * Connection lifecycle semantics (see docs/KNOWN_LIMITATIONS.md §15).
 *
 * Disconnect and Permanent Delete are deliberately separate operations:
 *   - disconnectConnection: non-destructive. Stops future syncs, revokes stored
 *     credentials, pauses referencing pipelines, and RETAINS all CampaignMetric
 *     history for the connection.
 *   - purgeConnection: the ONLY path that deletes retained warehouse data.
 *     Callers must obtain explicit user confirmation first.
 */

import { encrypt } from "@/lib/encryption";

/**
 * Minimal structural transaction client (compatible with the extended Prisma
 * client's interactive transaction and with test mocks).
 */
type PrismaTx = {
    pipeline: {
        updateMany: (args: any) => Promise<{ count: number }>;
        deleteMany: (args: any) => Promise<{ count: number }>;
    };
    connection: {
        updateMany: (args: any) => Promise<{ count: number }>;
        deleteMany: (args: any) => Promise<{ count: number }>;
    };
    campaignMetric: {
        deleteMany: (args: any) => Promise<{ count: number }>;
    };
};

export function revokedCredentialsPayload(): string {
    return encrypt(JSON.stringify({ revoked: true, revokedAt: new Date().toISOString() }));
}

/** Manual/cron sync entry points must refuse to run a disconnected connection. */
export function isConnectionSyncBlocked(status: string): boolean {
    return status === "disconnected";
}

/**
 * Disconnect: pause referencing pipelines, mark the connection disconnected and
 * revoke its stored credentials. Historical CampaignMetric rows are untouched.
 * All writes are scoped to the connection's workspace (tenant fencing).
 */
export async function disconnectConnection(
    tx: PrismaTx,
    input: { connectionId: string; workspaceId: string }
): Promise<void> {
    await tx.pipeline.updateMany({
        where: {
            workspaceId: input.workspaceId,
            status: "active",
            OR: [
                { sourceConnectionId: input.connectionId },
                { destinationConnectionId: input.connectionId },
            ],
        },
        data: { status: "paused" },
    });
    const updated = await tx.connection.updateMany({
        where: { id: input.connectionId, workspaceId: input.workspaceId },
        data: {
            status: "disconnected",
            credentials: revokedCredentialsPayload(),
            lastError: null,
        },
    });
    if (updated.count !== 1) throw new Error("Connection was changed before disconnect");
}

/**
 * Permanent delete: remove pipelines referencing the connection (sync logs cascade),
 * delete the connection's retained CampaignMetric history, then the Connection row.
 * All deletes are scoped to the connection's workspace (tenant fencing).
 */
export async function purgeConnection(
    tx: PrismaTx,
    input: { connectionId: string; workspaceId: string }
): Promise<void> {
    await tx.pipeline.deleteMany({
        where: {
            workspaceId: input.workspaceId,
            OR: [
                { sourceConnectionId: input.connectionId },
                { destinationConnectionId: input.connectionId },
            ],
        },
    });
    await tx.campaignMetric.deleteMany({
        where: { connectionId: input.connectionId, workspaceId: input.workspaceId },
    });
    const deleted = await tx.connection.deleteMany({
        where: { id: input.connectionId, workspaceId: input.workspaceId },
    });
    if (deleted.count !== 1) throw new Error("Connection was changed before deletion");
}
