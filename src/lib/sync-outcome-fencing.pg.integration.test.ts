import assert from "node:assert/strict";
import { assertCiDatabaseReachable } from "./pg-test-discipline";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
    acquireConnectionSyncLease,
    releaseConnectionSyncLease,
    buildConnectionScope,
} from "./connection-sync-lease";
import { syncConnectionData, persistConnectionSyncOutcome } from "./sync-connection";

/**
 * Real PostgreSQL acceptance tests for sync-outcome lease fencing and
 * warehouse-refresh serialization (stale/zombie worker scenarios).
 */
describe("PostgreSQL integration: sync outcome lease fencing", () => {
    let db: PrismaClient | null = null;
    let isDbAvailable = false;
    const suffix = `${Date.now()}-${process.pid}`;
    const ids = { owner: `fence-owner-${suffix}`, ws: `fence-ws-${suffix}` };
    let conn: { id: string };
    let connOther: { id: string };
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
            await db.user.create({ data: { id: ids.owner, email: `fence-${suffix}@example.test`, name: "Fence Owner" } });
            await db.workspace.create({ data: { id: ids.ws, name: "Fence WS", slug: `fence-${suffix}`, ownerId: ids.owner, plan: "pilot" } });
            conn = await db.connection.create({
                data: { workspaceId: ids.ws, name: "Fence conn", type: "source", provider: "google_ads", credentials: "enc:v1:t", remoteAccountId: `fence-conn-${suffix}` },
            });
            connOther = await db.connection.create({
                data: { workspaceId: ids.ws, name: "Fence conn other", type: "source", provider: "google_ads", credentials: "enc:v1:t", remoteAccountId: `fence-conn2-${suffix}` },
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
            await db.workspace.deleteMany({ where: { id: ids.ws } });
            await db.user.deleteMany({ where: { id: ids.owner } });
        } finally {
            await db.$disconnect();
        }
    });

    const leaseFor = (connectionId: string) =>
        acquireConnectionSyncLease({ provider: "google_ads", workspaceId: ids.ws, connectionId });

    it("exactly one of two competing workers acquires the connection lease", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        scopes.push(buildConnectionScope({ provider: "google_ads", workspaceId: ids.ws, connectionId: conn.id }));
        const [a, b] = await Promise.all([leaseFor(conn.id), leaseFor(conn.id)]);
        assert.equal([a.acquired, b.acquired].filter(Boolean).length, 1, "CAS + advisory lock must elect one owner");
        for (const r of [a, b]) if (r.acquired) await releaseConnectionSyncLease(r.lease, true);
    });

    it("different connections acquire concurrently (no global lock)", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        scopes.push(
            buildConnectionScope({ provider: "google_ads", workspaceId: ids.ws, connectionId: conn.id }),
            buildConnectionScope({ provider: "google_ads", workspaceId: ids.ws, connectionId: connOther.id }),
        );
        const [a, b] = await Promise.all([leaseFor(conn.id), leaseFor(connOther.id)]);
        assert.equal(a.acquired, true);
        assert.equal(b.acquired, true, "independent connections must not serialize each other");
        await releaseConnectionSyncLease(a.lease, true);
        await releaseConnectionSyncLease(b.lease, true);
    });

    it("a second sync attempt on a leased connection defers without touching connection state", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        scopes.push(buildConnectionScope({ provider: "google_ads", workspaceId: ids.ws, connectionId: conn.id }));
        const held = await leaseFor(conn.id);
        assert.equal(held.acquired, true);

        const before = await db.connection.findUniqueOrThrow({ where: { id: conn.id } });
        const blocked = await syncConnectionData({
            connectionId: conn.id,
            provider: "google_ads",
            credentials: {},
            workspaceId: ids.ws,
        });
        const afterRow = await db.connection.findUniqueOrThrow({ where: { id: conn.id } });

        assert.equal(blocked.success, false);
        assert.equal(blocked.outcome, "failed");
        assert.match(blocked.error ?? "", /Another sync is already running/);
        assert.equal(blocked.children[0]?.retryable, true, "lease contention is retryable");
        assert.equal(afterRow.lastError, before.lastError, "blocked worker must not write outcome state");
        assert.equal(afterRow.lastSyncAt?.getTime(), before.lastSyncAt?.getTime());

        await releaseConnectionSyncLease(held.lease, true);
    });

    it("stale worker cannot advance lastSyncAt / clear errors after its lease is stolen; the new owner can", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        scopes.push(buildConnectionScope({ provider: "google_ads", workspaceId: ids.ws, connectionId: conn.id }));

        // Worker A starts, its lease expires (simulated), Worker B steals it.
        const workerA = await leaseFor(conn.id);
        assert.equal(workerA.acquired, true);
        await db.connection.update({ where: { id: conn.id }, data: { lastError: "set by worker B" } });
        await db.syncLock.update({
            where: { scope: workerA.lease.scope },
            data: { leaseExpiresAt: new Date(Date.now() - 1000) },
        });
        const workerB = await leaseFor(conn.id);
        assert.equal(workerB.acquired, true);
        assert.ok(workerB.lease.fencingToken > workerA.lease.fencingToken, "token advanced on steal");

        // 1. Success-after-loss: A finishes "successfully" — must be rejected.
        await persistConnectionSyncOutcome(conn.id, { outcome: "success", error: undefined }, workerA.lease);
        let row = await db.connection.findUniqueOrThrow({ where: { id: conn.id } });
        assert.equal(row.lastSyncAt, null, "stale worker must not advance lastSyncAt");
        assert.equal(row.status, "connected");

        // 2. Failure-after-loss: A reports a failure — must not clear/overwrite B's error.
        await persistConnectionSyncOutcome(conn.id, { outcome: "failed", error: "stale worker error" }, workerA.lease);
        row = await db.connection.findUniqueOrThrow({ where: { id: conn.id } });
        assert.equal(row.lastError, "set by worker B", "stale worker must not overwrite newer error state");

        // 3. Worker B remains the source of truth.
        await persistConnectionSyncOutcome(conn.id, { outcome: "success", error: undefined }, workerB.lease);
        row = await db.connection.findUniqueOrThrow({ where: { id: conn.id } });
        assert.ok(row.lastSyncAt, "current owner advances lastSyncAt");
        assert.equal(row.lastError, null);

        await releaseConnectionSyncLease(workerB.lease, true);
    });

    it("a crashed worker's expired lease does not permanently block the connection", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        scopes.push(buildConnectionScope({ provider: "google_ads", workspaceId: ids.ws, connectionId: connOther.id }));
        const crashed = await leaseFor(connOther.id); // worker dies, never releases
        assert.equal(crashed.acquired, true);
        await db.syncLock.update({
            where: { scope: crashed.lease.scope },
            data: { leaseExpiresAt: new Date(Date.now() - 1000) },
        });
        const reclaimed = await leaseFor(connOther.id);
        assert.equal(reclaimed.acquired, true, "expired lease is reclaimable");
        await releaseConnectionSyncLease(reclaimed.lease, true);
    });
});
