import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
    recordAccountOutcome,
    getSkippedAccountIds,
    getAccountHealth,
    QUARANTINE_THRESHOLD,
} from "./provider-account-health";

/**
 * Real PostgreSQL tests for durable per-account health:
 * retryable vs terminal failures, quarantine threshold, reconnect_required,
 * recovery-by-success, sibling isolation, and workspace scoping.
 */
describe("PostgreSQL integration: provider account health", () => {
    let db: PrismaClient | null = null;
    let isDbAvailable = false;
    const suffix = `${Date.now()}-${process.pid}`;
    const ids = { owner: `ah-owner-${suffix}`, ws: `ah-ws-${suffix}` };
    let conn: { id: string };
    let connOther: { id: string };

    before(async () => {
        if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("mock")) return;
        try {
            db = new PrismaClient();
            await db.$connect();
            await db.$queryRaw`SELECT 1`;
            await db.user.create({ data: { id: ids.owner, email: `ah-${suffix}@example.test`, name: "AH Owner" } });
            await db.workspace.create({ data: { id: ids.ws, name: "AH WS", slug: `ah-${suffix}`, ownerId: ids.owner, plan: "pilot" } });
            conn = await db.connection.create({ data: { workspaceId: ids.ws, name: "AH conn", type: "source", provider: "meta_ads", credentials: "t", remoteAccountId: `ah-conn-${suffix}` } });
            connOther = await db.connection.create({ data: { workspaceId: ids.ws, name: "AH conn 2", type: "source", provider: "google_ads", credentials: "t", remoteAccountId: `ah-conn2-${suffix}` } });
            isDbAvailable = true;
        } catch {
            isDbAvailable = false;
        }
    });

    after(async () => {
        if (!db) return;
        try {
            await db.providerAccountHealth.deleteMany({ where: { workspaceId: ids.ws } });
            await db.workspace.deleteMany({ where: { id: ids.ws } });
            await db.user.deleteMany({ where: { id: ids.owner } });
        } finally {
            await db.$disconnect();
        }
    });

    const outcome = (over: Partial<Parameters<typeof recordAccountOutcome>[0]> & { accountId: string }) =>
        recordAccountOutcome({
            workspaceId: ids.ws,
            connectionId: conn.id,
            provider: "meta_ads",
            ok: true,
            ...over,
        } as Parameters<typeof recordAccountOutcome>[0]);

    it("success creates a healthy row; retryable failures degrade but never quarantine", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        await outcome({ accountId: "act_ok" });
        let health = await db.providerAccountHealth.findUniqueOrThrow({
            where: { connectionId_accountId: { connectionId: conn.id, accountId: "act_ok" } },
        });
        assert.equal(health.status, "healthy");
        assert.equal(health.consecutiveFailures, 0);

        // Transient storm: THRESHOLD+ retryable failures must not quarantine.
        for (let i = 0; i < QUARANTINE_THRESHOLD + 3; i++) {
            await outcome({ accountId: "act_ok", ok: false, retryable: true, error: "Error 429: rate limit" });
        }
        health = await db.providerAccountHealth.findUniqueOrThrow({
            where: { connectionId_accountId: { connectionId: conn.id, accountId: "act_ok" } },
        });
        assert.equal(health.status, "degraded", "transient failures never quarantine");
        assert.ok(!(await getSkippedAccountIds(conn.id)).has("act_ok"), "still sync-eligible");
    });

    it(`quarantines after ${QUARANTINE_THRESHOLD} consecutive non-retryable failures; siblings unaffected`, async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        for (let i = 0; i < QUARANTINE_THRESHOLD; i++) {
            await outcome({ accountId: "act_poison", ok: false, retryable: false, error: "CUSTOMER_NOT_ENABLED" });
        }
        const skipped = await getSkippedAccountIds(conn.id);
        assert.ok(skipped.has("act_poison"), "poison account is skipped after threshold");
        assert.ok(!skipped.has("act_ok"), "healthy sibling still syncs");

        const health = await db.providerAccountHealth.findUniqueOrThrow({
            where: { connectionId_accountId: { connectionId: conn.id, accountId: "act_poison" } },
        });
        assert.equal(health.status, "quarantined");
        assert.ok(health.lastError?.includes("CUSTOMER_NOT_ENABLED"));
    });

    it("auth failure marks reconnect_required immediately and success recovers it", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        await outcome({ accountId: "act_auth", ok: false, retryable: false, authFailure: true, error: "Error validating access token: session revoked" });
        let health = await db.providerAccountHealth.findUniqueOrThrow({
            where: { connectionId_accountId: { connectionId: conn.id, accountId: "act_auth" } },
        });
        assert.equal(health.status, "reconnect_required");
        assert.ok((await getSkippedAccountIds(conn.id)).has("act_auth"));

        // A later success (e.g. after reconnect) automatically recovers the account.
        await outcome({ accountId: "act_auth", ok: true });
        health = await db.providerAccountHealth.findUniqueOrThrow({
            where: { connectionId_accountId: { connectionId: conn.id, accountId: "act_auth" } },
        });
        assert.equal(health.status, "healthy");
        assert.equal(health.consecutiveFailures, 0);
        assert.ok(health.lastSuccessAt);
        assert.ok(!(await getSkippedAccountIds(conn.id)).has("act_auth"), "recovered account syncs again");
    });

    it("health rows are scoped per connection (no cross-connection leakage)", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        await recordAccountOutcome({
            workspaceId: ids.ws, connectionId: connOther.id, provider: "google_ads",
            accountId: "act_poison", ok: false, retryable: false, error: "disabled",
        });
        const otherSkipped = await getSkippedAccountIds(connOther.id);
        const connSkipped = await getSkippedAccountIds(conn.id);
        assert.ok(otherSkipped.size >= 0);
        assert.ok(connSkipped.has("act_poison"), "original connection's quarantine intact");
        // Only one failure for connOther → not quarantined there yet.
        assert.ok(!otherSkipped.has("act_poison"), "same accountId on another connection has independent health");
        const all = await getAccountHealth(connOther.id);
        assert.ok(all.every((h) => h.workspaceId === ids.ws));
    });
});
