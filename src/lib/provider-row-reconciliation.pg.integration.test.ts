import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { computeStaleRowStats } from "./provider-row-reconciliation";

/**
 * Real PostgreSQL tests for OBSERVABILITY-ONLY provider-row reconciliation:
 * stale detection on complete snapshots, refusal on incomplete syncs,
 * late-arriving attribution tolerance, tenant isolation, and zero mutation.
 */
describe("PostgreSQL integration: provider stale-row reconciliation (observability only)", () => {
    let db: PrismaClient | null = null;
    let isDbAvailable = false;
    const suffix = `${Date.now()}-${process.pid}`;
    const ids = { owner: `rec-owner-${suffix}`, wsA: `rec-ws-a-${suffix}`, wsB: `rec-ws-b-${suffix}` };
    let connA: { id: string };
    let connB: { id: string };
    const since = new Date("2026-08-01T00:00:00.000Z");
    const until = new Date("2026-08-05T23:59:59.999Z");

    before(async () => {
        if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("mock")) return;
        try {
            db = new PrismaClient();
            await db.$connect();
            await db.$queryRaw`SELECT 1`;
            await db.user.create({ data: { id: ids.owner, email: `rec-${suffix}@example.test`, name: "Rec Owner" } });
            await db.workspace.createMany({
                data: [
                    { id: ids.wsA, name: "Rec A", slug: `rec-a-${suffix}`, ownerId: ids.owner, plan: "pilot" },
                    { id: ids.wsB, name: "Rec B", slug: `rec-b-${suffix}`, ownerId: ids.owner, plan: "pilot" },
                ],
            });
            connA = await db.connection.create({ data: { workspaceId: ids.wsA, name: "rA", type: "source", provider: "meta_ads", credentials: "t", remoteAccountId: `rec-a-${suffix}` } });
            connB = await db.connection.create({ data: { workspaceId: ids.wsB, name: "rB", type: "source", provider: "meta_ads", credentials: "t", remoteAccountId: `rec-b-${suffix}` } });

            const mk = (connectionId: string, entityId: string, date = new Date("2026-08-02T00:00:00.000Z")) =>
                db!.campaignMetric.create({
                    data: {
                        workspaceId: connectionId === connA.id ? ids.wsA : ids.wsB,
                        connectionId,
                        platform: "meta_ads",
                        accountId: "act_1",
                        level: "ad",
                        entityId,
                        campaignId: "c1",
                        date,
                        spend: 1,
                        breakdownHash: "none",
                    },
                });
            // Workspace A: ad1, ad2 present; ad3 present but "deleted at provider".
            await mk(connA.id, "ad1");
            await mk(connA.id, "ad2");
            await mk(connA.id, "ad3");
            // Different level — must be ignored by an ad-level comparison.
            await db.campaignMetric.create({
                data: { workspaceId: ids.wsA, connectionId: connA.id, platform: "meta_ads", accountId: "act_1", level: "campaign", entityId: "campX", campaignId: "campX", date: new Date("2026-08-02T00:00:00.000Z"), breakdownHash: "none" },
            });
            // Workspace B: same account id, different tenant.
            await db.campaignMetric.create({
                data: { workspaceId: ids.wsB, connectionId: connB.id, platform: "meta_ads", accountId: "act_1", level: "ad", entityId: "adB1", campaignId: "c1", date: new Date("2026-08-02T00:00:00.000Z"), breakdownHash: "none" },
            });
            isDbAvailable = true;
        } catch {
            isDbAvailable = false;
        }
    });

    after(async () => {
        if (!db) return;
        try {
            await db.campaignMetric.deleteMany({ where: { workspaceId: { in: [ids.wsA, ids.wsB] } } });
            await db.workspace.deleteMany({ where: { id: { in: [ids.wsA, ids.wsB] } } });
            await db.user.deleteMany({ where: { id: ids.owner } });
        } finally {
            await db.$disconnect();
        }
    });

    it("refuses to compare when the provider fetch is not provably complete", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        const stats = await computeStaleRowStats({
            workspaceId: ids.wsA, connectionId: connA.id, accountId: "act_1", level: "ad",
            since, until, providerEntityIds: ["ad1"], fetchComplete: false,
        });
        assert.equal(stats, null, "incomplete sync must never be treated as deletion evidence");
    });

    it("detects stale entities on a complete snapshot without mutating anything", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        const before = await db.campaignMetric.count({ where: { workspaceId: ids.wsA } });
        const stats = await computeStaleRowStats({
            workspaceId: ids.wsA, connectionId: connA.id, accountId: "act_1", level: "ad",
            since, until, providerEntityIds: ["ad1", "ad2"], fetchComplete: true,
        });
        assert.ok(stats);
        assert.equal(stats.staleRowCount, 1, "ad3 was not returned by the provider");
        assert.deepEqual(stats.staleEntityIds, ["ad3"]);
        assert.equal(stats.providerEntityCount, 2);
        assert.equal(stats.warehouseEntityCount, 3);
        const after = await db.campaignMetric.count({ where: { workspaceId: ids.wsA } });
        assert.equal(after, before, "observability-only: no rows deleted or rewritten");
    });

    it("late-arriving provider rows are never flagged (provider superset of warehouse)", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        const stats = await computeStaleRowStats({
            workspaceId: ids.wsA, connectionId: connA.id, accountId: "act_1", level: "ad",
            since, until, providerEntityIds: ["ad1", "ad2", "ad3", "ad_new_late"], fetchComplete: true,
        });
        assert.equal(stats?.staleRowCount, 0, "provider returning MORE entities than stored is an upsert case, not staleness");
    });

    it("level-scoped: campaign-level rows are invisible to an ad-level comparison", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        const stats = await computeStaleRowStats({
            workspaceId: ids.wsA, connectionId: connA.id, accountId: "act_1", level: "ad",
            since, until, providerEntityIds: ["ad1", "ad2", "ad3"], fetchComplete: true,
        });
        assert.equal(stats?.staleRowCount, 0, "campX (level=campaign) must not appear as a stale ad");
    });

    it("tenant isolation: another workspace's rows are never counted", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        // Same account id, empty provider set, but scoped to workspace B's own connection.
        const stats = await computeStaleRowStats({
            workspaceId: ids.wsB, connectionId: connB.id, accountId: "act_1", level: "ad",
            since, until, providerEntityIds: [], fetchComplete: true,
        });
        assert.equal(stats?.warehouseEntityCount, 1, "only tenant B's own adB1 counted");
        assert.deepEqual(stats?.staleEntityIds, ["adB1"]);
    });
});
