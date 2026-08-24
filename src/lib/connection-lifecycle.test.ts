/**
 * Disconnect retention & permanent-delete regression tests.
 *
 * Covers docs/KNOWN_LIMITATIONS.md §15 semantics:
 *   1. Disconnect stops future sync capability (status gate).
 *   2. Stored credentials are revoked on disconnect.
 *   3. Historical CampaignMetric rows are retained on disconnect.
 *   4. Other workspace data is untouched.
 *   5. Pipelines are paused, not deleted, on disconnect.
 *   6. Purge deletes only the intended connection's pipelines/metrics/connection,
 *      always scoped to the owning workspace.
 *   7. Tenant fencing: every write/delete where-clause carries the workspaceId.
 *   8. Reconnecting reuses the same connection row (identity-triple upsert), so
 *      retained metrics are not duplicated or orphaned.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import prisma from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import {
    disconnectConnection,
    purgeConnection,
    isConnectionSyncBlocked,
    revokedCredentialsPayload,
} from "./connection-lifecycle";
import { upsertSourceConnection } from "./connection-upsert";

const WORKSPACE = "ws-lifecycle-test";
const OTHER_WORKSPACE = "ws-other";
const CONNECTION_ID = "conn-1";

type RecordedCall = { model: string; op: string; args: any };

function makeRecordingTx(calls: RecordedCall[], connectionUpdateCount = 1, connectionDeleteCount = 1) {
    return {
        pipeline: {
            updateMany: async (args: any) => {
                calls.push({ model: "pipeline", op: "updateMany", args });
                return { count: 1 };
            },
            deleteMany: async (args: any) => {
                calls.push({ model: "pipeline", op: "deleteMany", args });
                return { count: 1 };
            },
        },
        connection: {
            updateMany: async (args: any) => {
                calls.push({ model: "connection", op: "updateMany", args });
                return { count: connectionUpdateCount };
            },
            deleteMany: async (args: any) => {
                calls.push({ model: "connection", op: "deleteMany", args });
                return { count: connectionDeleteCount };
            },
        },
        campaignMetric: {
            deleteMany: async (args: any) => {
                calls.push({ model: "campaignMetric", op: "deleteMany", args });
                return { count: 5 };
            },
        },
    } as any;
}

describe("connection-lifecycle disconnect retention", () => {
    let calls: RecordedCall[];

    beforeEach(() => {
        process.env.ENCRYPTION_KEY =
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        calls = [];
    });

    it("disconnect pauses pipelines, marks connection disconnected, revokes credentials, and never touches CampaignMetric rows", async () => {
        const tx = makeRecordingTx(calls);
        await disconnectConnection(tx, { connectionId: CONNECTION_ID, workspaceId: WORKSPACE });

        const ops = calls.map((c) => `${c.model}.${c.op}`);
        assert.ok(!ops.includes("campaignMetric.deleteMany"), "disconnect must not delete metrics");
        assert.ok(!ops.includes("pipeline.deleteMany"), "disconnect must not delete pipelines");
        assert.ok(!ops.includes("connection.deleteMany"), "disconnect must not delete the connection");

        const pipelineUpdate = calls.find((c) => c.model === "pipeline");
        assert.equal(pipelineUpdate?.args.where.workspaceId, WORKSPACE);
        assert.equal(pipelineUpdate?.args.data.status, "paused");
        assert.deepEqual(pipelineUpdate?.args.where.OR, [
            { sourceConnectionId: CONNECTION_ID },
            { destinationConnectionId: CONNECTION_ID },
        ]);

        const connectionUpdate = calls.find((c) => c.model === "connection");
        assert.equal(connectionUpdate?.args.where.id, CONNECTION_ID);
        assert.equal(connectionUpdate?.args.where.workspaceId, WORKSPACE, "tenant fence on connection write");
        assert.equal(connectionUpdate?.args.data.status, "disconnected");
        const revoked = JSON.parse(decrypt(connectionUpdate?.args.data.credentials));
        assert.equal(revoked.revoked, true, "credentials replaced by revoked payload");
        assert.ok(revoked.revokedAt);
    });

    it("revoked credentials are not usable OAuth material", async () => {
        const payload = JSON.parse(decrypt(revokedCredentialsPayload()));
        assert.equal(payload.revoked, true);
        assert.ok(!("accessToken" in payload) && !("refreshToken" in payload));
    });

    it("a disconnected connection is blocked from syncing; connected is not", () => {
        assert.equal(isConnectionSyncBlocked("disconnected"), true);
        assert.equal(isConnectionSyncBlocked("connected"), false);
    });

    it("disconnect throws if the connection row vanished mid-transaction", async () => {
        const tx = makeRecordingTx(calls, /* connectionUpdateCount */ 0);
        await assert.rejects(
            () => disconnectConnection(tx, { connectionId: CONNECTION_ID, workspaceId: WORKSPACE }),
            /changed before disconnect/
        );
    });

    it("purge deletes pipelines, metrics, and the connection — all scoped to the owning workspace", async () => {
        const tx = makeRecordingTx(calls);
        await purgeConnection(tx, { connectionId: CONNECTION_ID, workspaceId: WORKSPACE });

        const metricDelete = calls.find((c) => c.model === "campaignMetric");
        assert.ok(metricDelete, "purge deletes retained metrics");
        assert.equal(metricDelete?.args.where.connectionId, CONNECTION_ID);
        assert.equal(metricDelete?.args.where.workspaceId, WORKSPACE, "metrics delete is workspace-scoped");

        const pipelineDelete = calls.find((c) => c.model === "pipeline" && c.op === "deleteMany");
        assert.equal(pipelineDelete?.args.where.workspaceId, WORKSPACE);

        const connectionDelete = calls.find((c) => c.model === "connection" && c.op === "deleteMany");
        assert.equal(connectionDelete?.args.where.id, CONNECTION_ID);
        assert.equal(connectionDelete?.args.where.workspaceId, WORKSPACE, "tenant fence on connection delete");
    });

    it("purge of another workspace's connection id deletes nothing (updateMany/deleteMany count 0 throws)", async () => {
        const tx = makeRecordingTx(calls, 0, 0);
        await assert.rejects(
            () => purgeConnection(tx, { connectionId: CONNECTION_ID, workspaceId: OTHER_WORKSPACE }),
            /changed before deletion/
        );
    });
});

describe("connection-lifecycle reconnect does not duplicate retained metrics", () => {
    beforeEach(() => {
        process.env.ENCRYPTION_KEY =
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    });

    it("reconnect upserts by identity triple, reusing the same connection row and resetting status to connected", async () => {
        let upsertArgs: any;
        (prisma as any).connection = {
            findUnique: async () => ({ id: CONNECTION_ID }),
            upsert: async (args: any) => {
                upsertArgs = args;
                return { id: CONNECTION_ID, status: args.update.status };
            },
        };

        const result = await upsertSourceConnection({
            workspaceId: WORKSPACE,
            provider: "google_ads",
            remoteAccountId: "123-456-7890",
            name: "Google Ads",
            type: "source",
            credentials: { accessToken: "fresh-token" },
        });

        assert.equal(result.id, CONNECTION_ID, "same row reused — no duplicate connection");
        assert.equal(result.created, false);
        assert.deepEqual(upsertArgs.where.workspaceId_provider_remoteAccountId, {
            workspaceId: WORKSPACE,
            provider: "google_ads",
            remoteAccountId: "123-456-7890",
        });
        assert.equal(upsertArgs.update.status, "connected", "reconnect reactivates the disconnected row");
        // Same row id ⇒ retained CampaignMetric.connectionId stays valid and the
        // deterministic unique key prevents duplicate rows on the next sync.
    });
});
