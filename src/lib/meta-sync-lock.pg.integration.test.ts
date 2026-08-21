import assert from "node:assert/strict";
import { assertCiDatabaseReachable } from "./pg-test-discipline";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
    buildSyncScope,
    acquireMetaSyncLock,
    heartbeatMetaSyncLock,
    assertMetaSyncLease,
    releaseMetaSyncLock,
    upsertMetaMetric,
} from "./meta-sync-lock";

/**
 * Real PostgreSQL (16) concurrency tests for the Meta sync lease.
 * No advisory locking is mocked — these run against `pg_try_advisory_xact_lock`.
 * Requires a reachable DATABASE_URL whose schema was created by the canonical
 * migrations (fresh-database reproducibility is itself under test).
 */
describe("PostgreSQL integration: meta sync lock / fencing", () => {
    let db: PrismaClient | null = null;
    let isDbAvailable = false;
      isDbAvailable = false;
    const suffix = `${Date.now()}-${process.pid}`;
    const ids = {
        owner: `lock-owner-${suffix}`,
        workspaceA: `lock-ws-a-${suffix}`,
        workspaceB: `lock-ws-b-${suffix}`,
    };
    let connA: { id: string };
    let connB: { id: string };
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
            // A clean database must provide everything lock acquisition needs —
            // if this suite passes after `prisma migrate deploy` alone, the
            // historical missing `advisory_lock_key` dependency is gone.
            await db.user.create({ data: { id: ids.owner, email: `lock-${suffix}@example.test`, name: "Lock Owner" } });
            await db.workspace.createMany({
                data: [
                    { id: ids.workspaceA, name: "Lock WS A", slug: `lock-a-${suffix}`, ownerId: ids.owner, plan: "pilot" },
                    { id: ids.workspaceB, name: "Lock WS B", slug: `lock-b-${suffix}`, ownerId: ids.owner, plan: "pilot" },
                ],
            });
            connA = await db.connection.create({
                data: { workspaceId: ids.workspaceA, name: "Lock conn A", type: "source", provider: "meta_ads", credentials: "enc:v1:t", remoteAccountId: `lock-conn-a-${suffix}` },
            });
            connB = await db.connection.create({
                data: { workspaceId: ids.workspaceB, name: "Lock conn B", type: "source", provider: "meta_ads", credentials: "enc:v1:t", remoteAccountId: `lock-conn-b-${suffix}` },
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
            await db.campaignMetric.deleteMany({ where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } } });
            await db.workspace.deleteMany({ where: { id: { in: [ids.workspaceA, ids.workspaceB] } } });
            await db.user.deleteMany({ where: { id: ids.owner } });
        } finally {
            await db.$disconnect();
        }
    });

    it("first worker acquires; a concurrent second worker cannot acquire the same active scope", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        const scope = buildSyncScope({ workspaceId: ids.workspaceA, connectionId: connA.id, adAccountId: "act_1" });
        scopes.push(scope);

        const first = await acquireMetaSyncLock({ workspaceId: ids.workspaceA, connectionId: connA.id, adAccountId: "act_1", jobId: "job-1" });
        assert.equal(first.acquired, true);

        // Contended acquisition: real concurrent attempts (barrier via Promise.all)
        const contenders = await Promise.all([
            acquireMetaSyncLock({ workspaceId: ids.workspaceA, connectionId: connA.id, adAccountId: "act_1", jobId: "job-2" }),
            acquireMetaSyncLock({ workspaceId: ids.workspaceA, connectionId: connA.id, adAccountId: "act_1", jobId: "job-3" }),
        ]);
        assert.ok(contenders.every((c) => !c.acquired), "active lease must block all competitors");

        await releaseMetaSyncLock({ scope, leaseId: (first as any).leaseId, success: true });
    });

    it("a different workspace/scope acquires independently", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        const scopeA = buildSyncScope({ workspaceId: ids.workspaceA, connectionId: connA.id, adAccountId: "act_1" });
        const scopeB = buildSyncScope({ workspaceId: ids.workspaceB, connectionId: connB.id, adAccountId: "act_1" });
        scopes.push(scopeA, scopeB);

        const a = await acquireMetaSyncLock({ workspaceId: ids.workspaceA, connectionId: connA.id, adAccountId: "act_1", jobId: "job-a" });
        const b = await acquireMetaSyncLock({ workspaceId: ids.workspaceB, connectionId: connB.id, adAccountId: "act_1", jobId: "job-b" });
        assert.equal(a.acquired, true);
        assert.equal(b.acquired, true, "different workspace+connection must not interfere");

        await releaseMetaSyncLock({ scope: scopeA, leaseId: (a as any).leaseId, success: true });
        await releaseMetaSyncLock({ scope: scopeB, leaseId: (b as any).leaseId, success: true });
    });

    it("expired lease can be reclaimed and the fencing token increments on ownership change", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        const scope = buildSyncScope({ workspaceId: ids.workspaceA, connectionId: connA.id, adAccountId: "act_2" });
        scopes.push(scope);

        const first = await acquireMetaSyncLock({ workspaceId: ids.workspaceA, connectionId: connA.id, adAccountId: "act_2", jobId: "job-1" });
        assert.equal(first.acquired, true);
        const token1 = (first as any).fencingToken as bigint;

        // Simulate expiry without sleeping 20 minutes.
        await db!.syncLock.update({ where: { scope }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });

        const second = await acquireMetaSyncLock({ workspaceId: ids.workspaceA, connectionId: connA.id, adAccountId: "act_2", jobId: "job-2" });
        assert.equal(second.acquired, true, "expired lease must be stealable");
        assert.ok((second as any).fencingToken > token1, "fencing token must increase on steal");

        // The stale (first) owner can no longer pass the fence or heartbeat.
        await assert.rejects(() => assertMetaSyncLease({ scope, leaseId: (first as any).leaseId, fencingToken: token1 }), /Stale worker/);
        await assert.rejects(() => heartbeatMetaSyncLock({ scope, leaseId: (first as any).leaseId }), /Lease lost/);

        await releaseMetaSyncLock({ scope, leaseId: (second as any).leaseId, success: true });
    });

    it("stale owner cannot write metrics after being replaced; the new owner can", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        const scope = buildSyncScope({ workspaceId: ids.workspaceA, connectionId: connA.id, adAccountId: "act_3" });
        scopes.push(scope);

        const stale = await acquireMetaSyncLock({ workspaceId: ids.workspaceA, connectionId: connA.id, adAccountId: "act_3", jobId: "job-1" });
        await db!.syncLock.update({ where: { scope }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
        const fresh = await acquireMetaSyncLock({ workspaceId: ids.workspaceA, connectionId: connA.id, adAccountId: "act_3", jobId: "job-2" });

        const metricArgs = (leaseId: string, fencingToken: bigint, entityId: string) => ({
            workspaceId: ids.workspaceA,
            connectionId: connA.id,
            accountId: "act_3",
            level: "ad",
            entityId,
            date: new Date("2026-08-01T00:00:00Z"),
            breakdownHash: "none",
            metrics: { impressions: 1, clicks: 1, spend: 1 } as any,
            syncJobId: "job-x",
            lockScope: scope,
            leaseId,
            fencingToken,
        });

        await assert.rejects(
            () => upsertMetaMetric(metricArgs((stale as any).leaseId, (stale as any).fencingToken, "stale-ad")),
            /Stale worker/,
        );
        await upsertMetaMetric(metricArgs((fresh as any).leaseId, (fresh as any).fencingToken, "fresh-ad"));
        const written = await db!.campaignMetric.findFirst({ where: { connectionId: connA.id, entityId: "fresh-ad" } });
        assert.ok(written, "current owner's fenced write lands");
        const rejected = await db!.campaignMetric.findFirst({ where: { connectionId: connA.id, entityId: "stale-ad" } });
        assert.equal(rejected, null, "stale worker's write must not land");

        await releaseMetaSyncLock({ scope, leaseId: (fresh as any).leaseId, success: true });
    });

    it("heartbeat extends valid ownership", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        const scope = buildSyncScope({ workspaceId: ids.workspaceA, connectionId: connA.id, adAccountId: "act_4" });
        scopes.push(scope);

        const held = await acquireMetaSyncLock({ workspaceId: ids.workspaceA, connectionId: connA.id, adAccountId: "act_4", jobId: "job-hb" });
        await heartbeatMetaSyncLock({ scope, leaseId: (held as any).leaseId });
        const row = await db!.syncLock.findUniqueOrThrow({ where: { scope } });
        assert.ok(row.leaseExpiresAt.getTime() > Date.now() + 15 * 60 * 1000, "heartbeat extended the lease");
        await assertMetaSyncLease({ scope, leaseId: (held as any).leaseId, fencingToken: row.fencingToken });

        await releaseMetaSyncLock({ scope, leaseId: (held as any).leaseId, success: true });
    });
});
