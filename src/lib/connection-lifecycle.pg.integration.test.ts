import assert from "node:assert/strict";
import { assertCiDatabaseReachable } from "./pg-test-discipline";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
    disconnectConnection,
    purgeConnection,
} from "./connection-lifecycle";
import { markConnectionsSyncedOk } from "./ingestion/connection-sync-state";
import { decrypt } from "./encryption";
import { upsertSourceConnection } from "./connection-upsert";

/**
 * Real PostgreSQL verification of the disconnect-retention semantics
 * (docs/KNOWN_LIMITATIONS.md §15). Requires a reachable DATABASE_URL;
 * skips otherwise (CI provides a postgres:16 service, matching this suite).
 */
describe("PostgreSQL integration: disconnect retention & purge fencing", () => {
    let prisma: PrismaClient | null = null;
    let isDbAvailable = false;
      isDbAvailable = false;
    const suffix = `${Date.now()}-${process.pid}`;
    const ids = {
        owner: `dc-owner-${suffix}`,
        intruder: `dc-intruder-${suffix}`,
        workspaceA: `dc-ws-a-${suffix}`,
        workspaceB: `dc-ws-b-${suffix}`,
    };
    let sourceA: { id: string };
    let otherSourceA: { id: string };
    let sourceB: { id: string };
    let pipelineA: { id: string };
    let pipelineOther: { id: string };
    let metricIdA: string;
    let metricIdOther: string;
    let metricIdB: string;

    before(async () => {
        if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("mock")) {
      assertCiDatabaseReachable();
      return;
    }
        process.env.ENCRYPTION_KEY =
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        try {
            prisma = new PrismaClient();
            await prisma.$connect();
            await prisma.$queryRaw`SELECT 1`;

            await prisma.user.createMany({
                data: [
                    { id: ids.owner, email: `dc-owner-${suffix}@example.test`, name: "DC Owner" },
                    { id: ids.intruder, email: `dc-intruder-${suffix}@example.test`, name: "DC Intruder" },
                ],
            });
            await prisma.workspace.createMany({
                data: [
                    { id: ids.workspaceA, name: "DC Workspace A", slug: `dc-a-${suffix}`, ownerId: ids.owner, plan: "pilot" },
                    { id: ids.workspaceB, name: "DC Workspace B", slug: `dc-b-${suffix}`, ownerId: ids.intruder, plan: "pilot" },
                ],
            });
            await prisma.workspaceMember.createMany({
                data: [
                    { workspaceId: ids.workspaceA, userId: ids.owner, role: "owner" },
                    { workspaceId: ids.workspaceB, userId: ids.intruder, role: "owner" },
                ],
            });

            const dest = await prisma.connection.create({
                data: {
                    workspaceId: ids.workspaceA,
                    name: "DC destination",
                    type: "destination",
                    provider: "google_sheets",
                    credentials: "enc:v1:test",
                    remoteAccountId: `dc-dest-${suffix}`,
                },
            });
            sourceA = await prisma.connection.create({
                data: {
                    workspaceId: ids.workspaceA,
                    name: "DC source A",
                    type: "source",
                    provider: "meta_ads",
                    credentials: "enc:v1:test",
                    remoteAccountId: `dc-src-a-${suffix}`,
                },
            });
            otherSourceA = await prisma.connection.create({
                data: {
                    workspaceId: ids.workspaceA,
                    name: "DC other source A",
                    type: "source",
                    provider: "google_ads",
                    credentials: "enc:v1:test",
                    remoteAccountId: `dc-src-a2-${suffix}`,
                },
            });
            sourceB = await prisma.connection.create({
                data: {
                    workspaceId: ids.workspaceB,
                    name: "DC source B",
                    type: "source",
                    provider: "meta_ads",
                    credentials: "enc:v1:test",
                    remoteAccountId: `dc-src-b-${suffix}`,
                },
            });
            pipelineA = await prisma.pipeline.create({
                data: {
                    workspaceId: ids.workspaceA,
                    name: "DC pipeline A",
                    sourceConnectionId: sourceA.id,
                    destinationConnectionId: dest.id,
                    status: "active",
                },
            });
            pipelineOther = await prisma.pipeline.create({
                data: {
                    workspaceId: ids.workspaceA,
                    name: "DC pipeline other",
                    sourceConnectionId: otherSourceA.id,
                    destinationConnectionId: dest.id,
                    status: "active",
                },
            });

            const db = prisma;
            const metric = (connectionId: string, workspaceId: string, entityId: string) =>
                db.campaignMetric.create({
                    data: {
                        workspaceId,
                        connectionId,
                        platform: "meta_ads",
                        accountId: "act_1",
                        accountName: "Test account",
                        level: "campaign",
                        entityId,
                        campaignId: entityId,
                        campaignName: "Test campaign",
                        date: new Date("2026-08-01T00:00:00Z"),
                        spend: 10.5,
                        breakdownHash: "none",
                    },
                });
            metricIdA = (await metric(sourceA.id, ids.workspaceA, "camp-a")).id;
            metricIdOther = (await metric(otherSourceA.id, ids.workspaceA, "camp-a")).id;
            metricIdB = (await metric(sourceB.id, ids.workspaceB, "camp-a")).id;

            isDbAvailable = true;
        } catch {
            assertCiDatabaseReachable();
            isDbAvailable = false;
        }
    });

    after(async () => {
        if (!prisma) return;
        try {
            await prisma.workspace.deleteMany({ where: { id: { in: [ids.workspaceA, ids.workspaceB] } } });
            await prisma.user.deleteMany({ where: { id: { in: [ids.owner, ids.intruder] } } });
        } finally {
            await prisma.$disconnect();
        }
    });

    it("1+2. disconnect retains CampaignMetric rows, pauses pipelines, revokes credentials, keeps the connection", async (t) => {
        if (!isDbAvailable || !prisma) return t.skip("PostgreSQL database not reachable; run with real DATABASE_URL");
        await prisma.$transaction((tx) =>
            disconnectConnection(tx, { connectionId: sourceA.id, workspaceId: ids.workspaceA })
        );

        const conn = await prisma.connection.findUniqueOrThrow({ where: { id: sourceA.id } });
        assert.equal(conn.status, "disconnected");
        assert.equal(JSON.parse(decrypt(conn.credentials)).revoked, true, "stored credentials replaced by revoked payload");

        const retained = await prisma.campaignMetric.findUniqueOrThrow({ where: { id: metricIdA } });
        assert.equal(retained.connectionId, sourceA.id, "historical metric row retained");

        const pipeline = await prisma.pipeline.findUniqueOrThrow({ where: { id: pipelineA.id } });
        assert.equal(pipeline.status, "paused", "referencing pipeline paused");

        const otherPipeline = await prisma.pipeline.findUniqueOrThrow({ where: { id: pipelineOther.id } });
        assert.equal(otherPipeline.status, "active", "unrelated pipeline untouched");

        const otherMetric = await prisma.campaignMetric.findUniqueOrThrow({ where: { id: metricIdOther } });
        assert.ok(otherMetric, "other connection's metrics untouched");
    });

    it("3. a stale/in-flight sync completion cannot resurrect the disconnected connection", async (t) => {
        if (!isDbAvailable || !prisma) return t.skip("PostgreSQL database not reachable; run with real DATABASE_URL");
        await markConnectionsSyncedOk({ sourceId: sourceA.id, destinationId: sourceA.id }, new Date());
        const conn = await prisma.connection.findUniqueOrThrow({ where: { id: sourceA.id } });
        assert.equal(conn.status, "disconnected", "sync-outcome writer must not flip status back to connected");
        assert.equal(conn.lastSyncAt, null, "stale worker must not advance freshness on a disconnected source");
    });

    it("4. purge deletes only the intended connection's data in the workspace", async (t) => {
        if (!isDbAvailable || !prisma) return t.skip("PostgreSQL database not reachable; run with real DATABASE_URL");
        await prisma.$transaction((tx) =>
            purgeConnection(tx, { connectionId: otherSourceA.id, workspaceId: ids.workspaceA })
        );
        assert.equal(await prisma.connection.findUnique({ where: { id: otherSourceA.id } }), null);
        assert.equal(await prisma.campaignMetric.findUnique({ where: { id: metricIdOther } }), null, "purged connection's metrics deleted");
        assert.equal(await prisma.pipeline.findUnique({ where: { id: pipelineOther.id } }), null, "purged connection's pipelines deleted");

        // Same workspace, different connection: untouched.
        assert.ok(await prisma.campaignMetric.findUnique({ where: { id: metricIdA } }));
        assert.ok(await prisma.pipeline.findUnique({ where: { id: pipelineA.id } }));
        // Other workspace: untouched.
        assert.ok(await prisma.connection.findUnique({ where: { id: sourceB.id } }));
        assert.ok(await prisma.campaignMetric.findUnique({ where: { id: metricIdB } }));
    });

    it("5. cross-workspace purge of another tenant's connection id deletes nothing and throws", async (t) => {
        if (!isDbAvailable || !prisma) return t.skip("PostgreSQL database not reachable; run with real DATABASE_URL");
        await assert.rejects(
            () =>
                prisma!.$transaction((tx) =>
                    purgeConnection(tx, { connectionId: sourceB.id, workspaceId: ids.workspaceA })
                ),
            /changed before deletion/
        );
        assert.ok(await prisma.connection.findUnique({ where: { id: sourceB.id } }), "tenant B connection survives");
        assert.ok(await prisma.campaignMetric.findUnique({ where: { id: metricIdB } }), "tenant B metrics survive");
    });

    it("6+7. reconnect reuses the retained connection identity and the unique key prevents duplicate metrics", async (t) => {
        if (!isDbAvailable || !prisma) return t.skip("PostgreSQL database not reachable; run with real DATABASE_URL");
        const reconnected = await upsertSourceConnection({
            workspaceId: ids.workspaceA,
            provider: "meta_ads",
            remoteAccountId: `dc-src-a-${suffix}`,
            name: "DC source A",
            type: "source",
            credentials: { accessToken: "fresh-token" },
        });
        assert.equal(reconnected.created, false);
        assert.equal(reconnected.id, sourceA.id, "same connection row reused — retained metrics stay attached");
        assert.equal(reconnected.status, "connected");

        // Deterministic warehouse uniqueness: re-syncing the same entity/date must collide.
        await assert.rejects(
            () =>
                prisma!.campaignMetric.create({
                    data: {
                        workspaceId: ids.workspaceA,
                        connectionId: sourceA.id,
                        platform: "meta_ads",
                        accountId: "act_1",
                        level: "campaign",
                        entityId: "camp-a",
                        campaignId: "camp-a",
                        date: new Date("2026-08-01T00:00:00Z"),
                        breakdownHash: "none",
                    },
                }),
            (err: { code?: string }) => err.code === "P2002",
            "unique key must reject a duplicate row after reconnect"
        );
    });

    it("8. transaction rollback on mid-disconnect failure leaves state fully consistent", async (t) => {
        if (!isDbAvailable || !prisma) return t.skip("PostgreSQL database not reachable; run with real DATABASE_URL");
        const dest = await prisma.connection.create({
            data: {
                workspaceId: ids.workspaceA,
                name: "DC rollback dest",
                type: "destination",
                provider: "google_sheets",
                credentials: "enc:v1:test",
                remoteAccountId: `dc-dest-rollback-${suffix}`,
            },
        });
        const src = await prisma.connection.create({
            data: {
                workspaceId: ids.workspaceA,
                name: "DC rollback src",
                type: "source",
                provider: "tiktok_business",
                credentials: "enc:v1:test",
                remoteAccountId: `dc-src-rollback-${suffix}`,
            },
        });
        await prisma.pipeline.create({
            data: {
                workspaceId: ids.workspaceA,
                name: "DC rollback pipeline",
                sourceConnectionId: src.id,
                destinationConnectionId: dest.id,
                status: "active",
            },
        });

        // Disconnect succeeds, then a later statement in the same transaction fails.
        await assert.rejects(() =>
            prisma!.$transaction(async (tx) => {
                await disconnectConnection(tx, { connectionId: src.id, workspaceId: ids.workspaceA });
                throw new Error("simulated failure after disconnect");
            })
        );

        const conn = await prisma.connection.findUniqueOrThrow({ where: { id: src.id } });
        assert.equal(conn.status, "connected", "disconnect rolled back");
        const pipeline = await prisma.pipeline.findFirstOrThrow({
            where: { sourceConnectionId: src.id },
        });
        assert.equal(pipeline.status, "active", "pipeline pause rolled back");
    });
});