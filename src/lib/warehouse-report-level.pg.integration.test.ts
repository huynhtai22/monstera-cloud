import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { queryWarehouse, isSupportedReportLevel, SUPPORTED_REPORT_LEVELS } from "./warehouse-query";

/**
 * Real PostgreSQL tests for honest report-level semantics:
 * raw `ad` filtering, true group-by aggregation for adset/campaign/account,
 * currency-safe grouping, and workspace isolation.
 */
describe("PostgreSQL integration: warehouse report levels", () => {
    let db: PrismaClient | null = null;
    let isDbAvailable = false;
    const suffix = `${Date.now()}-${process.pid}`;
    const ids = { owner: `lvl-owner-${suffix}`, wsA: `lvl-ws-a-${suffix}`, wsB: `lvl-ws-b-${suffix}` };
    const scopes: Array<{ ws: string }> = [];

    before(async () => {
        if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("mock")) return;
        try {
            db = new PrismaClient();
            await db.$connect();
            await db.$queryRaw`SELECT 1`;
            const dbc = db;
            await dbc.user.create({ data: { id: ids.owner, email: `lvl-${suffix}@example.test`, name: "Lvl Owner" } });
            await dbc.workspace.createMany({
                data: [
                    { id: ids.wsA, name: "Lvl A", slug: `lvl-a-${suffix}`, ownerId: ids.owner, plan: "pilot" },
                    { id: ids.wsB, name: "Lvl B", slug: `lvl-b-${suffix}`, ownerId: ids.owner, plan: "pilot" },
                ],
            });
            const connA = await dbc.connection.create({ data: { workspaceId: ids.wsA, name: "c", type: "source", provider: "meta_ads", credentials: "t", remoteAccountId: `lvl-a-${suffix}` } });
            const connB = await dbc.connection.create({ data: { workspaceId: ids.wsB, name: "c", type: "source", provider: "meta_ads", credentials: "t", remoteAccountId: `lvl-b-${suffix}` } });
            scopes.push({ ws: ids.wsA }, { ws: ids.wsB });

            const mk = (args: Partial<Parameters<PrismaClient["campaignMetric"]["create"]>[0]["data"]> & { workspaceId: string; connectionId: string }) =>
                dbc.campaignMetric.create({ data: { platform: "meta_ads", accountId: "act_1", accountName: "Acc1", level: "ad", entityId: "ad1", campaignId: "camp1", campaignName: "Camp1", adsetId: "set1", adsetName: "Set1", date: new Date("2026-08-10T00:00:00Z"), impressions: 100, clicks: 10, spend: 50, revenue: 100, currency: "USD", breakdownHash: "none", ...args } as any });

            // Workspace A: two Meta ad rows in one adset/campaign + one Google campaign row
            await mk({ workspaceId: ids.wsA, connectionId: connA.id, entityId: "ad1" });
            await mk({ workspaceId: ids.wsA, connectionId: connA.id, entityId: "ad2", impressions: 100, clicks: 20, spend: 150, revenue: 300 });
            await mk({ workspaceId: ids.wsA, connectionId: connA.id, platform: "google_ads", level: "campaign", entityId: "g1", campaignId: "g1", campaignName: "GCamp", adsetId: "", impressions: 10, clicks: 1, spend: 5, revenue: 9 });
            // Same account/day, different currency — must never blend
            await mk({ workspaceId: ids.wsA, connectionId: connA.id, entityId: "ad3", spend: 100000, revenue: 2000000, currency: "VND", impressions: 50, clicks: 5 });
            // Workspace B isolation row
            await mk({ workspaceId: ids.wsB, connectionId: connB.id, entityId: "adB" });
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

    it("level validation: known levels accepted, unknown rejected by the helper", () => {
        for (const lvl of ["ad", "adset", "campaign", "account"]) {
            assert.equal(isSupportedReportLevel(lvl), true);
        }
        assert.deepEqual([...SUPPORTED_REPORT_LEVELS], ["ad", "adset", "campaign", "account"]);
        assert.equal(isSupportedReportLevel("adgroup"), false);
        assert.equal(isSupportedReportLevel(""), false);
    });

    it("ad level returns raw ad rows only (no campaign-level rows mixed in)", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        const r = await queryWarehouse({ workspaceId: ids.wsA, level: "ad" });
        assert.ok(r.rows.length >= 3);
        assert.ok(r.rows.every((row) => row.level === "ad"));
        assert.ok(r.rows.every((row) => row.platform === "meta_ads"), "google campaign rows must not leak into ad level");
        assert.equal(r.aggregatedLevel, undefined);
    });

    it("adset level truly aggregates per adset with recomputed ratios", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        const r = await queryWarehouse({ workspaceId: ids.wsA, level: "adset" });
        assert.equal(r.aggregatedLevel, "adset");
        const usd = r.rows.find((row) => row.currency === "USD" && row.adsetId === "set1");
        assert.ok(usd, "aggregated adset row exists");
        // ad1+ad2: 200 impressions, 30 clicks, 200 spend, 400 revenue
        assert.equal(usd.impressions, 200);
        assert.equal(usd.clicks, 30);
        assert.equal(usd.spend, 200);
        assert.equal(usd.revenue, 400);
        assert.ok(Math.abs(usd.cpc - 200 / 30) < 1e-9, "cpc recomputed from sums");
        assert.ok(Math.abs(usd.roas - 2) < 1e-9, "roas recomputed from sums");
        const vnd = r.rows.find((row) => row.currency === "VND" && row.adsetId === "set1");
        assert.ok(vnd, "VND row aggregated separately");
        assert.equal(vnd.spend, 100000);
    });

    it("campaign level groups by campaign across platforms without cross-currency blending", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        const r = await queryWarehouse({ workspaceId: ids.wsA, level: "campaign" });
        assert.equal(r.aggregatedLevel, "campaign");
        const metaUsd = r.rows.find((row) => row.platform === "meta_ads" && row.campaignId === "camp1" && row.currency === "USD");
        assert.ok(metaUsd, "Meta ad rows roll up to their campaign");
        assert.equal(metaUsd.impressions, 200);
        const google = r.rows.find((row) => row.platform === "google_ads" && row.campaignId === "g1");
        assert.ok(google, "existing campaign-level rows group to themselves");
        assert.equal(google.impressions, 10);
        assert.ok(!r.rows.some((row) => row.currency === null || row.currency === ""), "no currency-blended groups");
    });

    it("account level aggregates per account+date+platform+currency and isolates workspaces", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        const r = await queryWarehouse({ workspaceId: ids.wsA, level: "account" });
        const usd = r.rows.find((row) => row.currency === "USD" && row.platform === "meta_ads");
        assert.ok(usd, "account/day/currency aggregate exists");
        assert.equal(usd.impressions, 200, "account aggregate for meta USD only");
        const googleAcc = r.rows.find((row) => row.platform === "google_ads");
        assert.equal(googleAcc?.impressions, 10, "platform is part of the group key");
        // Workspace B's row must never appear in workspace A's aggregates.
        assert.ok(!r.rows.some((row) => row.workspaceId === ids.wsB));
    });

    it("absent level keeps legacy all-rows behavior", async (t) => {
        if (!isDbAvailable || !db) return t.skip("PostgreSQL database not reachable");
        const r = await queryWarehouse({ workspaceId: ids.wsA });
        assert.equal(r.aggregatedLevel, undefined);
        assert.ok(r.rows.some((row) => row.level === "ad"));
        assert.ok(r.rows.some((row) => row.level === "campaign"));
    });
});
