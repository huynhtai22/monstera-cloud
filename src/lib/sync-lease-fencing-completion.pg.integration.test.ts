import assert from "node:assert/strict";
import { assertCiDatabaseReachable } from "./pg-test-discipline";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
    acquireConnectionSyncLease,
    buildConnectionScope,
    heartbeatConnectionSyncLease,
    releaseConnectionSyncLease,
} from "./connection-sync-lease";
import { ingestGoogleAdsRows } from "./ad-platform-ingest";
import { markConnectionsSyncedOk } from "./ingestion/connection-sync-state";

/**
 * Real PostgreSQL acceptance tests for the lease-fencing completion pass:
 * heartbeat renewal/self-abort, fenced outcome writes from pipeline runs,
 * row-level lease stamping for non-Meta providers, and force-unlock token
 * monotonicity (expire-instead-of-delete).
 */
describe("PostgreSQL integration: sync lease fencing completion", () => {
    let db: PrismaClient | null = null;
    let isDbAvailable = false;
    const suffix = `${Date.now()}-${process.pid}`;
    const ids = { owner: `lc-owner-${suffix}`, ws: `lc-ws-${suffix}` };
    let srcConn: { id: string };
    let dstConn: { id: string };
    let ingestConn: { id: string };
    const scopes: string[] = [];

    before(async () => {
        if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("mock")) {
            assertCiDatabaseReachable();
            return;
        }
        try {
            db = new PrismaClient();
            await db.$connect();
            await db.$queryRaw`SELECT 1`;
            await db.user.create({ data: { id: ids.owner, email: `lease-completion-${suffix}@example.test`, name: "Lease Completion" } });
            await db.workspace.create({ data: { id: ids.ws, name: "Lease Completion WS", slug: `lease-completion-${suffix}`, ownerId: ids.owner, plan: "pilot" } });
            srcConn = await db.connection.create({
                data: { workspaceId: ids.ws, name: "LC src", type: "source", provider: "google_ads", credentials: "enc:v1:t", remoteAccountId: `lc-src-${suffix}` },
            });
            dstConn = await db.connection.create({
                data: { workspaceId: ids.ws, name: "LC dst", type: "destination", provider: "google_sheets", credentials: "enc:v1:t", remoteAccountId: `lc-dst-${suffix}` },
            });
            ingestConn = await db.connection.create({
                data: { workspaceId: ids.ws, name: "LC ingest", type: "source", provider: "google_ads", credentials: "enc:v1:t", remoteAccountId: `lc-ing-${suffix}` },
            });
            isDbAvailable = true;
        } catch {
            assertCiDatabaseReachable();
            isDbAvailable = false;
        }
    });

    after(async () => {
        if (!db) return;
        try {
            if (scopes.length) await db.syncLock.deleteMany({ where: { scope: { in: scopes } } });
            await db.campaignMetric.deleteMany({ where: { workspaceId: ids.ws } });
            await db.connection.deleteMany({ where: { workspaceId: ids.ws } });
            await db.workspace.deleteMany({ where: { id: ids.ws } });
            await db.user.deleteMany({ where: { id: ids.owner } });
        } finally {
            await db.$disconnect();
        }
    });

    const leaseFor = (connectionId: string, provider = "google_ads") =>
        acquireConnectionSyncLease({ provider, workspaceId: ids.ws, connectionId });

    it("heartbeat extends an owned lease and rejects a stolen one", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        scopes.push(buildConnectionScope({ provider: "google_ads", workspaceId: ids.ws, connectionId: srcConn.id }));

        const workerA = await leaseFor(srcConn.id);
        assert.equal(workerA.acquired, true);
        await heartbeatConnectionSyncLease(workerA.lease);

        const extended = await db.syncLock.findUniqueOrThrow({ where: { scope: workerA.lease.scope } });
        assert.ok(
            extended.leaseExpiresAt.getTime() > Date.now() + 15 * 60 * 1000,
            "heartbeat must extend the lease well into the future"
        );

        // Simulate expiry + steal by worker B; A's heartbeat must now fail.
        await db.syncLock.update({
            where: { scope: workerA.lease.scope },
            data: { leaseExpiresAt: new Date(Date.now() - 1000) },
        });
        const workerB = await leaseFor(srcConn.id);
        assert.equal(workerB.acquired, true);
        await assert.rejects(
            () => heartbeatConnectionSyncLease(workerA.lease),
            /Lease lost/,
            "stale worker heartbeat must self-abort"
        );

        await heartbeatConnectionSyncLease(workerB.lease);
        await releaseConnectionSyncLease(workerB.lease, true);
    });

    it("pipeline outcome writes are fenced: stale worker skipped, current owner lands", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        scopes.push(buildConnectionScope({ provider: "google_ads", workspaceId: ids.ws, connectionId: srcConn.id }));

        const workerA = await leaseFor(srcConn.id);
        assert.equal(workerA.acquired, true);
        await db.syncLock.update({
            where: { scope: workerA.lease.scope },
            data: { leaseExpiresAt: new Date(Date.now() - 1000) },
        });
        const workerB = await leaseFor(srcConn.id);
        assert.equal(workerB.acquired, true);

        const connIds = { sourceId: srcConn.id, destinationId: dstConn.id };
        const at = new Date();

        // Worker A lost its source lease: its half of the write is skipped while
        // the unfenced destination half still applies.
        await markConnectionsSyncedOk(connIds, at, { sourceId: workerA.lease });
        const srcRow = await db.connection.findUniqueOrThrow({ where: { id: srcConn.id } });
        const dstRow = await db.connection.findUniqueOrThrow({ where: { id: dstConn.id } });
        assert.equal(srcRow.lastSyncAt, null, "stale worker must not advance source lastSyncAt");
        assert.ok(dstRow.lastSyncAt, "destination write without a lease keeps legacy behavior");

        // Current owner B writes both halves successfully.
        const at2 = new Date();
        await markConnectionsSyncedOk(connIds, at2, {
            sourceId: workerB.lease,
            destinationId: undefined,
        });
        const srcRow2 = await db.connection.findUniqueOrThrow({ where: { id: srcConn.id } });
        assert.ok(srcRow2.lastSyncAt?.getTime() === at2.getTime(), "current owner advances lastSyncAt");
        assert.equal(srcRow2.lastError, null);

        await releaseConnectionSyncLease(workerB.lease, true);
    });

    it("fenced Google Ads ingestion stamps lease evidence and aborts when the lease is lost", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        scopes.push(buildConnectionScope({ provider: "google_ads", workspaceId: ids.ws, connectionId: ingestConn.id }));

        const rows = [1, 2, 3].map((i) => ({
            campaign_id: `camp-${i}-${suffix}`,
            campaign_name: `Camp ${i}`,
            date: "2026-08-20",
            impressions: i * 10,
            clicks: i,
            cost: i * 1.5,
        }));

        const workerA = await leaseFor(ingestConn.id);
        assert.equal(workerA.acquired, true);

        const first = await ingestGoogleAdsRows(rows, {
            workspaceId: ids.ws,
            connectionId: ingestConn.id,
            accountId: "ing-acct",
            accountName: "Ing Acct",
            syncJobId: `job-a-${suffix}`,
            lease: workerA.lease,
        });
        assert.equal(first.upserted, 3);
        assert.equal(first.failed, 0);

        const stamped = await db.campaignMetric.findFirst({
            where: { workspaceId: ids.ws, connectionId: ingestConn.id, entityId: `camp-1-${suffix}` },
        });
        assert.ok(stamped, "rows were written");
        assert.equal(stamped?.lockScope, workerA.lease.scope, "lockScope evidence stamped");
        assert.equal(
            typeof stamped?.fencingToken === "bigint" ? stamped.fencingToken.toString() : String(stamped?.fencingToken),
            workerA.lease.fencingToken.toString(),
            "fencingToken evidence stamped"
        );

        // Steal the lease, then replay the same ingestion as the stale worker:
        // the opening heartbeat must abort the whole batch before any write.
        await db.syncLock.update({
            where: { scope: workerA.lease.scope },
            data: { leaseExpiresAt: new Date(Date.now() - 1000) },
        });
        const workerB = await leaseFor(ingestConn.id);
        assert.equal(workerB.acquired, true);

        const stale = await ingestGoogleAdsRows(rows.map((r) => ({ ...r, impressions: 9999 })), {
            workspaceId: ids.ws,
            connectionId: ingestConn.id,
            accountId: "ing-acct",
            accountName: "Ing Acct",
            syncJobId: `job-stale-${suffix}`,
            lease: workerA.lease,
        });
        assert.equal(stale.upserted, 0, "stale worker must not write any rows");
        assert.equal(stale.failed, rows.length, "aborted rows are reported as failures");

        const untouched = await db.campaignMetric.findFirst({
            where: { workspaceId: ids.ws, connectionId: ingestConn.id, entityId: `camp-1-${suffix}` },
        });
        assert.equal(untouched?.impressions, 10, "stale replay must not overwrite the owner's rows");

        await releaseConnectionSyncLease(workerB.lease, true);
    });

    it("force unlock by expiry (no delete) keeps fencingToken monotonic across generations", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        scopes.push(buildConnectionScope({ provider: "google_ads", workspaceId: ids.ws, connectionId: dstConn.id }));

        const first = await leaseFor(dstConn.id);
        assert.equal(first.acquired, true);
        const generationOne = first.lease.fencingToken;

        // Same mutation the force-unlock route performs now (expire, not delete).
        await db.syncLock.updateMany({
            where: { scope: { startsWith: buildConnectionScope({ provider: "google_ads", workspaceId: ids.ws, connectionId: dstConn.id }) } },
            data: { status: "released", heartbeatAt: new Date(), leaseExpiresAt: new Date(0) },
        });

        const second = await leaseFor(dstConn.id);
        assert.equal(second.acquired, true);
        assert.ok(
            second.lease.fencingToken > generationOne,
            "next claim after force unlock must increment the previous token, never restart at 1"
        );
        await releaseConnectionSyncLease(second.lease, true);
    });
});
