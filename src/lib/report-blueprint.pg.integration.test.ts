import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
    BLUEPRINT_ID,
    BLUEPRINT_VERSION,
    computeVerificationStatus,
    evaluateSnapshotFreshness,
    generateWeeklyBlueprint,
    mapReadinessStatus,
    METRIC_CONTRACT_VERSION,
    reopenWeeklyBlueprint,
    type MetricRowInput,
} from "./report-blueprint";
import { TENANT_GUARDED_MODELS } from "./tenant-guard";
import { assertCiDatabaseReachableWhenMissing } from "./pg-test-discipline";

/**
 * Real PostgreSQL tests for the Verified Weekly Performance Blueprint.
 * Requires a reachable DATABASE_URL whose schema includes the
 * weekly_report_blueprint migration (fresh-database reproducibility is
 * itself under test). These are NOT mocks: uniqueness, staleness and
 * tenant isolation claims are proven against the database.
 */
describe("PostgreSQL integration: verified weekly report blueprint", () => {
    let db: PrismaClient | null = null;
    const suffix = `bp-${Date.now()}-${process.pid}`;
    const ids = {
        owner: `owner-${suffix}`,
        admin: `admin-${suffix}`,
        outsider: `outsider-${suffix}`,
        workspaceA: `ws-a-${suffix}`,
        workspaceB: `ws-b-${suffix}`,
        clientA: `client-a-${suffix}`,
        clientB: `client-b-${suffix}`,
        connGoogleA: `conn-g-${suffix}`,
        connMetaA: `conn-m-${suffix}`,
        connGoogleB: `conn-gb-${suffix}`,
        destA: `dest-a-${suffix}`,
    };

    /** Fixed generation clock inside the last complete week, in +07. */
    const NOW = new Date("2026-09-02T10:00:00.000Z");
    const WINDOW = { start: "2026-08-24", end: "2026-08-30" };

    function metricRow(overrides: Partial<MetricRowInput> = {}): MetricRowInput {
        return {
            platform: "google_ads",
            connectionId: ids.connGoogleA,
            accountId: "account-1",
            accountName: "Account One",
            campaignId: "camp-1",
            campaignName: "Launch",
            entityId: "entity-1",
            level: "campaign",
            impressions: 1000,
            clicks: 100,
            spend: 50,
            conversions: 4,
            revenue: 200,
            currency: "VND",
            ...overrides,
        };
    }

    before(async () => {
        if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("mock")) {
            assertCiDatabaseReachableWhenMissing();
            console.warn("Skipping PostgreSQL blueprint tests: no real DATABASE_URL configured");
            return;
        }
        try {
            db = new PrismaClient();
            await db.$connect();
            await db.$queryRaw`SELECT 1`;
        } catch {
            console.warn("Skipping PostgreSQL blueprint tests: database not reachable");
            db = null;
        }
        if (!db) return;

        await db.user.createMany({
            data: [
                { id: ids.owner, email: `${ids.owner}@example.test`, name: "Owner" },
                { id: ids.admin, email: `${ids.admin}@example.test`, name: "Admin" },
                { id: ids.outsider, email: `${ids.outsider}@example.test`, name: "Outsider" },
            ],
        });
        await db.workspace.createMany({
            data: [
                { id: ids.workspaceA, name: "Blueprint WS A", slug: `bpa-${suffix}`, ownerId: ids.owner, plan: "pilot" },
                { id: ids.workspaceB, name: "Blueprint WS B", slug: `bpb-${suffix}`, ownerId: ids.owner, plan: "pilot" },
            ],
        });
        await db.workspaceMember.createMany({
            data: [
                { workspaceId: ids.workspaceA, userId: ids.owner, role: "owner" },
                { workspaceId: ids.workspaceA, userId: ids.admin, role: "admin" },
                { workspaceId: ids.workspaceB, userId: ids.owner, role: "owner" },
            ],
        });
        await db.client.createMany({
            data: [
                { id: ids.clientA, workspaceId: ids.workspaceA, name: "Client A" },
                { id: ids.clientB, workspaceId: ids.workspaceB, name: "Client B" },
            ],
        });
        await db.connection.createMany({
            data: [
                {
                    id: ids.connGoogleA,
                    workspaceId: ids.workspaceA,
                    clientId: ids.clientA,
                    name: "Google A",
                    type: "source",
                    provider: "google_ads",
                    credentials: "enc:v1:test",
                    remoteAccountId: "g-account-1",
                    status: "connected",
                    lastSyncAt: new Date(),
                    lastDataThrough: new Date("2026-08-30T00:00:00.000Z"),
                },
                {
                    id: ids.connMetaA,
                    workspaceId: ids.workspaceA,
                    clientId: ids.clientA,
                    name: "Meta A",
                    type: "source",
                    provider: "meta_ads",
                    credentials: "enc:v1:test",
                    remoteAccountId: "m-account-1",
                    status: "connected",
                    lastSyncAt: new Date(),
                    lastDataThrough: new Date("2026-08-30T00:00:00.000Z"),
                },
                {
                    id: ids.connGoogleB,
                    workspaceId: ids.workspaceB,
                    clientId: ids.clientB,
                    name: "Google B",
                    type: "source",
                    provider: "google_ads",
                    credentials: "enc:v1:test",
                    remoteAccountId: "g-account-b",
                    status: "connected",
                    lastSyncAt: new Date(),
                    lastDataThrough: new Date("2026-08-30T00:00:00.000Z"),
                },
                {
                    id: ids.destA,
                    workspaceId: ids.workspaceA,
                    name: "Sheets Destination",
                    type: "destination",
                    provider: "google_sheets",
                    credentials: "enc:v1:test",
                    remoteAccountId: "sheet-1",
                    status: "connected",
                },
            ],
        });
    });

    after(async () => {
        if (!db) return;
        // Cleanup best-effort; cascades remove children.
        await db.workspace.deleteMany({ where: { id: { in: [ids.workspaceA, ids.workspaceB] } } }).catch(() => undefined);
        await db.user.deleteMany({ where: { id: { in: [ids.owner, ids.admin, ids.outsider] } } }).catch(() => undefined);
        await db.$disconnect();
    });

    async function writeMetrics(rows: MetricRowInput[], date: string) {
        if (!db) throw new Error("db unavailable");
        const day = new Date(`${date}T00:00:00.000Z`);
        await db.campaignMetric.createMany({
            data: rows.map((row) => ({
                workspaceId: row.connectionId === ids.connGoogleB ? ids.workspaceB : ids.workspaceA,
                connectionId: row.connectionId,
                platform: row.platform,
                accountId: row.accountId,
                accountName: row.accountName,
                level: row.level,
                entityId: row.entityId,
                campaignId: row.campaignId,
                campaignName: row.campaignName,
                date: day,
                impressions: row.impressions,
                clicks: row.clicks,
                spend: row.spend,
                conversions: row.conversions,
                revenue: row.revenue,
                currency: row.currency,
            })),
            skipDuplicates: true,
        });
    }

    async function seedRequirements(requireDestination = false) {
        if (!db) throw new Error("db unavailable");
        await db.clientReportingRequirement.upsert({
            where: { workspaceId_clientId: { workspaceId: ids.workspaceA, clientId: ids.clientA } },
            create: {
                workspaceId: ids.workspaceA,
                clientId: ids.clientA,
                requiredProviders: ["google_ads", "meta_ads"],
                requireDestination,
                reportingTimezone: "Asia/Ho_Chi_Minh",
                reportingCurrency: "VND",
            },
            update: {
                requiredProviders: ["google_ads", "meta_ads"],
                requireDestination,
                reportingTimezone: "Asia/Ho_Chi_Minh",
                reportingCurrency: "VND",
            },
        });
    }

    it("classifies both blueprint models as tenant-guarded (24)", () => {
        assert.ok(TENANT_GUARDED_MODELS.has("ReportSnapshot"));
        assert.ok(TENANT_GUARDED_MODELS.has("ClientReportingRequirement"));
    });

    it("generates a snapshot from normalized warehouse rows with exact string IDs (4, 9, 19)", async () => {
        if (!db) return;
        await seedRequirements();
        await writeMetrics(
            [
                metricRow({ platform: "google_ads", campaignId: "1795849302486751234", currency: "VND" }),
                metricRow({ platform: "meta_ads", connectionId: ids.connMetaA, campaignId: "120210543958", currency: "VND" }),
            ],
            "2026-08-25",
        );

        const fetchCallsBefore = 0;
        const originalFetch = globalThis.fetch;
        let fetchCalled = false;
        globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
            fetchCalled = true;
            return originalFetch(...args);
        }) as typeof fetch;
        try {
            const result = await generateWeeklyBlueprint({
                workspaceId: ids.workspaceA,
                clientId: ids.clientA,
                windowStart: WINDOW.start,
                windowEnd: WINDOW.end,
                now: NOW,
            });
            assert.equal(fetchCalled, fetchCallsBefore === 0 ? false : true);
            assert.equal(fetchCalled, false, "generation must never call provider/fetch APIs");
            assert.equal(result.snapshot.blueprintId, BLUEPRINT_ID);
            assert.equal(result.snapshot.blueprintVersion, BLUEPRINT_VERSION);
            assert.equal(result.report.overview.clientName, "Client A");
            assert.equal(result.report.overview.reportingTimezone, "Asia/Ho_Chi_Minh");
            assert.equal(result.report.overview.currency, "VND");
            assert.deepEqual(result.report.overview.requiredProviders, ["google_ads", "meta_ads"]);
            const googleCampaign = result.report.campaigns.find((c) => c.provider === "google_ads");
            assert.equal(googleCampaign?.campaignId, "1795849302486751234");
            assert.equal(typeof googleCampaign?.campaignId, "string");
            // Deterministic derived metrics: CTR = 100/1000 = 0.1
            assert.equal(googleCampaign?.impressions, 1000);
            assert.equal(googleCampaign?.clicks, 100);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("returns VERIFIED when readiness is READY and every gate passes (13)", async () => {
        if (!db) return;
        const result = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(result.report.overview.readiness.status, mapReadinessStatus("ready"));
        assert.equal(result.snapshot.verificationStatus, "VERIFIED");
        assert.deepEqual(result.report.overview.verification.reasons, []);
    });

    it("is idempotent for the same canonical input and dependency state (18, 17)", async () => {
        if (!db) return;
        const first = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        const second = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(second.created, false);
        assert.equal(second.snapshot.id, first.snapshot.id);
        assert.equal(second.snapshot.dependencyHash, first.snapshot.dependencyHash);
        assert.deepEqual(second.report, first.report);

        const reopen = await reopenWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(reopen.snapshot?.id, first.snapshot.id);
        assert.equal(reopen.snapshot?.freshness.freshness, "CURRENT");
        assert.deepEqual(reopen.snapshot?.dependencyHash, first.snapshot.dependencyHash);
        assert.deepEqual(reopen.report, first.report);
    });

    it("blocks verification when a required provider is missing (5)", async () => {
        if (!db) return;
        if (!db) throw new Error("unreachable");
        // Requirements demand tiktok_business too, which has no connection/data.
        await db.clientReportingRequirement.update({
            where: { workspaceId_clientId: { workspaceId: ids.workspaceA, clientId: ids.clientA } },
            data: { requiredProviders: ["google_ads", "meta_ads", "tiktok_business"] },
        });
        const result = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(result.snapshot.verificationStatus, "NOT_VERIFIED");
        assert.ok(result.snapshot.verificationReasons.includes("required_providers_missing:tiktok_business"));
        // Restore for later tests
        await db.clientReportingRequirement.update({
            where: { workspaceId_clientId: { workspaceId: ids.workspaceA, clientId: ids.clientA } },
            data: { requiredProviders: ["google_ads", "meta_ads"] },
        });
    });

    it("creates a NEW immutable version when requirements change, never overwriting (15, 18)", async () => {
        if (!db) return;
        const baseline = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        // Earlier tests in this serial file may have already created the
        // current version; either way the changed requirement below must
        // produce a NEW sequence and leave the baseline row untouched.

        await db.clientReportingRequirement.update({
            where: { workspaceId_clientId: { workspaceId: ids.workspaceA, clientId: ids.clientA } },
            data: { requireDestination: true },
        });
        const changed = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(changed.created, true);
        assert.notEqual(changed.snapshot.id, baseline.snapshot.id);
        assert.equal(changed.snapshot.sequence, baseline.snapshot.sequence + 1);
        assert.notEqual(changed.snapshot.dependencyHash, baseline.snapshot.dependencyHash);
        // Destination is required and present+connected in this fixture, so
        // the report still verifies; the missing-evidence case is covered in
        // the destination-change test below.
        assert.equal(changed.snapshot.verificationStatus, "VERIFIED");

        const baselineStill = await db.reportSnapshot.findUnique({ where: { id: baseline.snapshot.id } });
        assert.ok(baselineStill);
        assert.equal(baselineStill.verificationStatus, "VERIFIED", "historical snapshot must not be rewritten");

        const stale = await evaluateSnapshotFreshness(baselineStill);
        assert.equal(stale.freshness, "STALE");
        assert.ok(stale.staleReasons.includes("requirement_changed"));

        // Restore the requirement content. updatedAt legitimately advanced,
        // so the dependency hash differs and generation creates another
        // immutable version — the original baseline is still returned intact.
        await db.clientReportingRequirement.update({
            where: { workspaceId_clientId: { workspaceId: ids.workspaceA, clientId: ids.clientA } },
            data: { requireDestination: false },
        });
        const restored = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(restored.created, true);
        assert.equal(restored.snapshot.sequence, changed.snapshot.sequence + 1);
        // Same canonical input again is idempotent against the restored state.
        const again = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(again.created, false);
        assert.equal(again.snapshot.id, restored.snapshot.id);
        assert.deepEqual(again.report, restored.report);
    });

    it("marks snapshots stale when warehouse data advances (15)", async () => {
        if (!db) return;
        const baseline = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        // New sync advances the connection's data-through timestamp.
        await db.connection.update({
            where: { id: ids.connGoogleA },
            data: { lastDataThrough: new Date("2026-08-30T12:00:00.000Z") },
        });
        const stored = await db.reportSnapshot.findUnique({ where: { id: baseline.snapshot.id } });
        assert.ok(stored);
        const stale = await evaluateSnapshotFreshness(stored);
        assert.equal(stale.freshness, "STALE");
        assert.ok(stale.staleReasons.includes("data_through_changed"));

        // Reopen reflects staleness: VERIFIED label must drop (15, 14)
        const reopen = await reopenWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(reopen.snapshot?.verification.status, "NOT_VERIFIED");
        assert.ok(reopen.snapshot?.verification.reasons.includes("dependency_evidence_changed"));

        // Restore for subsequent tests.
        await db.connection.update({
            where: { id: ids.connGoogleA },
            data: { lastDataThrough: new Date("2026-08-30T00:00:00.000Z") },
        });
    });

    it("marks snapshots stale when the delivery destination changes (16)", async () => {
        if (!db) return;
        await db.clientReportingRequirement.update({
            where: { workspaceId_clientId: { workspaceId: ids.workspaceA, clientId: ids.clientA } },
            data: { requireDestination: true },
        });
        // Destination exists and is connected: snapshot is verifiable.
        const verified = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(verified.snapshot.verificationStatus, "VERIFIED");

        // Destination disconnects → stored snapshot goes stale + loses VERIFIED.
        await db.connection.update({
            where: { id: ids.destA },
            data: { status: "disconnected" },
        });
        const stored = await db.reportSnapshot.findUnique({ where: { id: verified.snapshot.id } });
        assert.ok(stored);
        const stale = await evaluateSnapshotFreshness(stored);
        assert.equal(stale.freshness, "STALE");
        assert.ok(stale.staleReasons.includes("destination_changed"));

        const reopen = await reopenWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(reopen.snapshot?.verification.status, "NOT_VERIFIED");

        // Regenerating after the destination broke creates a NOT_VERIFIED version.
        const afterBreak = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(afterBreak.created, true);
        assert.equal(afterBreak.snapshot.verificationStatus, "NOT_VERIFIED");
        assert.ok(afterBreak.snapshot.verificationReasons.includes("destination_evidence_missing"));

        await db.connection.update({ where: { id: ids.destA }, data: { status: "connected" } });
        await db.clientReportingRequirement.update({
            where: { workspaceId_clientId: { workspaceId: ids.workspaceA, clientId: ids.clientA } },
            data: { requireDestination: false },
        });
    });

    it("fails closed for rival-workspace identifiers (11, 12)", async () => {
        if (!db) return;
        await assert.rejects(
            generateWeeklyBlueprint({
                workspaceId: ids.workspaceB, // rival workspace
                clientId: ids.clientA, // client belongs to workspace A
                windowStart: WINDOW.start,
                windowEnd: WINDOW.end,
                now: NOW,
            }),
            (error: unknown) => (error as { code?: string }).code === "client_not_found",
        );
        // No snapshot was created for the rival workspace.
        const rivalSnapshots = await db!.reportSnapshot.count({
            where: { workspaceId: ids.workspaceB },
        });
        assert.equal(rivalSnapshots, 0);
    });

    it("mixed-currency windows keep monetary totals unavailable and store no raw payloads (6, 20)", async () => {
        if (!db) return;
        await db.campaignMetric.createMany({
            data: [
                {
                    workspaceId: ids.workspaceA,
                    connectionId: ids.connGoogleA,
                    platform: "google_ads",
                    accountId: "account-1",
                    level: "campaign",
                    entityId: "entity-usd",
                    campaignId: "camp-usd",
                    campaignName: "USD Launch",
                    date: new Date("2026-08-26T00:00:00.000Z"),
                    spend: 10,
                    revenue: 40,
                    currency: "USD",
                },
            ],
            skipDuplicates: true,
        });
        const result = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(result.snapshot.verificationStatus, "NOT_VERIFIED");
        assert.ok(result.snapshot.verificationReasons.includes("currency_unverified"));
        assert.equal(result.report.totals.monetaryAvailable, false);
        assert.equal(result.report.totals.spend, null);

        // Persisted snapshot must not contain credentials or raw provider payloads.
        const stored = await db.reportSnapshot.findUnique({ where: { id: result.snapshot.id } });
        assert.ok(stored);
        const serialized = JSON.stringify({ result: stored.result, evidence: stored.readinessEvidence });
        assert.ok(!serialized.includes("enc:v1"), "no credential material may be persisted");
        assert.ok(!serialized.includes("rawData"), "no raw provider payloads may be persisted");
        assert.ok(serialized.length < 200_000, "snapshot result must stay bounded");

        // Clean the extra row so later runs of other tests stay deterministic.
        await db.campaignMetric.deleteMany({ where: { entityId: "entity-usd" } });
    });

    it("rejects verification claims that are not derived server-side (12)", () => {
        // The service API has no parameter accepting a caller-declared
        // verification state; prove that computeVerificationStatus ignores
        // any label not supported by its gates.
        const forged = computeVerificationStatus({
            readinessStatus: "NOT_READY",
            requiredProviders: ["google_ads"],
            includedProviders: [],
            coverageComplete: false,
            timezoneConfigured: false,
            currencyVerified: false,
            windowComplete: false,
            hasMetricData: false,
            aggregationCompatible: false,
            destinationSatisfied: false,
            dependencyHashMatches: false,
        });
        assert.equal(forged.status, "NOT_VERIFIED");
        assert.ok(forged.reasons.length >= 9);
        // METRIC_CONTRACT_VERSION is server-owned; snapshots bind it, callers cannot.
        assert.equal(METRIC_CONTRACT_VERSION, "weekly-blueprint-metrics-v1");
    });

    it("keeps per-window rows tenant-scoped between rival workspaces (11)", async () => {
        if (!db) return;
        await db.clientReportingRequirement.upsert({
            where: { workspaceId_clientId: { workspaceId: ids.workspaceB, clientId: ids.clientB } },
            create: {
                workspaceId: ids.workspaceB,
                clientId: ids.clientB,
                requiredProviders: ["google_ads"],
                reportingTimezone: "UTC",
                reportingCurrency: "USD",
            },
            update: {},
        });
        await db.campaignMetric.createMany({
            data: [
                {
                    workspaceId: ids.workspaceB,
                    connectionId: ids.connGoogleB,
                    platform: "google_ads",
                    accountId: "g-account-b",
                    level: "campaign",
                    entityId: "entity-b",
                    campaignId: "camp-b",
                    campaignName: "WS B Campaign",
                    date: new Date("2026-08-25T00:00:00.000Z"),
                    spend: 10,
                    revenue: 30,
                    currency: "USD",
                },
            ],
            skipDuplicates: true,
        });
        const resultB = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceB,
            clientId: ids.clientB,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        // Only workspace B's own rows appear.
        assert.ok(resultB.report.campaigns.every((campaign) => campaign.campaignId !== "1795849302486751234"));
        assert.ok(resultB.report.campaigns.some((campaign) => campaign.campaignId === "camp-b"));
    });
});
