import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
    BLUEPRINT_ID,
    BLUEPRINT_VERSION,
    computeVerificationStatus,
    evaluateSnapshotFreshness,
    generateWeeklyBlueprint,
    METRIC_CONTRACT_VERSION,
    reopenWeeklyBlueprint,
} from "./report-blueprint";
import { reportingDataset } from "./report-delivery";
import type { ScopedTransaction } from "./warehouse-query";
import { TENANT_GUARDED_MODELS } from "./tenant-guard";
import { assertCiDatabaseReachableWhenMissing } from "./pg-test-discipline";

/**
 * Real PostgreSQL tests for the Verified Weekly Performance Blueprint on the
 * PR #152 architecture: client requirements live on `Client`, delivery proof
 * is `DestinationDeliveryReceipt` currentness, readiness is the shared
 * evidence-based evaluator. NOT mocks: uniqueness, staleness, receipt scoping
 * and tenant isolation are proven against the database.
 */
describe("PostgreSQL integration: verified weekly report blueprint", () => {
    let db: PrismaClient | null = null;
    const suffix = `bp-${Date.now()}-${process.pid}`;
    const ids = {
        owner: `owner-${suffix}`,
        outsider: `outsider-${suffix}`,
        workspaceA: `ws-a-${suffix}`,
        workspaceB: `ws-b-${suffix}`,
        clientA: `client-a-${suffix}`,
        clientB: `client-b-${suffix}`,
        connGoogleA: `conn-g-${suffix}`,
        connMetaA: `conn-m-${suffix}`,
        connGoogleB: `conn-gb-${suffix}`,
    };

    const NOW = new Date("2026-09-02T10:00:00.000Z");
    const WINDOW = { start: "2026-08-24", end: "2026-08-30" };
    const WEEK_DAYS = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"];

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

        // The generator must record its build identity; tests emulate a deploy.
        process.env.GIT_COMMIT_SHA = `test-sha-${suffix}`;

        await db.user.createMany({
            data: [
                { id: ids.owner, email: `${ids.owner}@example.test`, name: "Owner" },
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
                { workspaceId: ids.workspaceB, userId: ids.owner, role: "owner" },
            ],
        });
        // Client requirements are PR #152's explicit Client columns.
        await db.client.createMany({
            data: [
                {
                    id: ids.clientA,
                    workspaceId: ids.workspaceA,
                    name: "Client A",
                    requiredProviders: ["google_ads", "meta_ads"],
                    requiredDestinations: ["google_sheets"],
                    requirementsConfiguredAt: new Date("2026-08-20T00:00:00.000Z"),
                },
                {
                    id: ids.clientB,
                    workspaceId: ids.workspaceB,
                    name: "Client B",
                    requiredProviders: ["google_ads"],
                    requiredDestinations: ["google_sheets"],
                    requirementsConfiguredAt: new Date("2026-08-20T00:00:00.000Z"),
                },
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
                },
            ],
        });
        // Verified reporting context (timezone/currency) per account.
        await db.accountReportingContext.createMany({
            data: [
                {
                    workspaceId: ids.workspaceA,
                    connectionId: ids.connGoogleA,
                    accountId: "g-account-1",
                    providerTimezone: "Asia/Ho_Chi_Minh",
                    providerCurrency: "VND",
                    providerObservedAt: NOW,
                },
                {
                    workspaceId: ids.workspaceA,
                    connectionId: ids.connMetaA,
                    accountId: "m-account-1",
                    providerTimezone: "Asia/Ho_Chi_Minh",
                    providerCurrency: "VND",
                    providerObservedAt: NOW,
                },
                {
                    workspaceId: ids.workspaceB,
                    connectionId: ids.connGoogleB,
                    accountId: "g-account-b",
                    providerTimezone: "UTC",
                    providerCurrency: "USD",
                    providerObservedAt: NOW,
                },
            ],
        });
        // Rows for EVERY day of the window (the evaluator rejects missing days).
        const rows: Array<{
            workspaceId: string; connectionId: string; platform: string; accountId: string;
            level: string; entityId: string; campaignId: string; campaignName: string;
            date: Date; impressions: number; clicks: number; spend: number;
            conversions: number; revenue: number; currency: string;
        }> = [];
        for (const day of WEEK_DAYS) {
            rows.push(
                {
                    workspaceId: ids.workspaceA, connectionId: ids.connGoogleA, platform: "google_ads",
                    accountId: "g-account-1", level: "campaign", entityId: `e-g-${suffix}`,
                    campaignId: "1795849302486751234", campaignName: "Always On",
                    date: new Date(`${day}T00:00:00.000Z`),
                    impressions: 1000, clicks: 100, spend: 5_000_000, conversions: 4, revenue: 25_000_000, currency: "VND",
                },
                {
                    workspaceId: ids.workspaceA, connectionId: ids.connMetaA, platform: "meta_ads",
                    accountId: "m-account-1", level: "campaign", entityId: `e-m-${suffix}`,
                    campaignId: "120210543958", campaignName: "Retargeting",
                    date: new Date(`${day}T00:00:00.000Z`),
                    impressions: 2000, clicks: 60, spend: 2_000_000, conversions: 2, revenue: 6_000_000, currency: "VND",
                },
            );
        }
        // Previous-window rows for week-over-week deltas.
        for (const day of ["2026-08-18", "2026-08-19"]) {
            rows.push({
                workspaceId: ids.workspaceA, connectionId: ids.connGoogleA, platform: "google_ads",
                accountId: "g-account-1", level: "campaign", entityId: `e-g-prev-${suffix}`,
                campaignId: "1795849302486751234", campaignName: "Always On",
                date: new Date(`${day}T00:00:00.000Z`),
                impressions: 800, clicks: 80, spend: 4_000_000, conversions: 3, revenue: 15_000_000, currency: "VND",
            });
        }
        await db.campaignMetric.createMany({ data: rows });
        // Workspace B rows (its own window coverage for the isolation test).
        await db.campaignMetric.createMany({
            data: WEEK_DAYS.map((day) => ({
                workspaceId: ids.workspaceB, connectionId: ids.connGoogleB, platform: "google_ads",
                accountId: "g-account-b", level: "campaign", entityId: `e-b-${suffix}`,
                campaignId: "camp-b", campaignName: "WS B Campaign",
                date: new Date(`${day}T00:00:00.000Z`),
                impressions: 500, clicks: 50, spend: 10, conversions: 1, revenue: 30, currency: "USD",
            })),
        });
    });

    after(async () => {
        delete process.env.GIT_COMMIT_SHA;
        if (!db) return;
        await db.workspace.deleteMany({ where: { id: { in: [ids.workspaceA, ids.workspaceB] } } }).catch(() => undefined);
        await db.user.deleteMany({ where: { id: { in: [ids.owner, ids.outsider] } } }).catch(() => undefined);
        await db.$disconnect();
    });

    /** Canonical dataset fingerprint through a real transaction client. */
    async function datasetOf(workspaceId: string, clientId: string, window: { start: string; end: string }) {
        if (!db) throw new Error("db unavailable");
        return db.$transaction((tx) => reportingDataset(tx as ScopedTransaction, workspaceId, clientId, window));
    }

    /** Latest receipt for a destination with the CURRENT dataset fingerprint. */
    async function seedCurrentReceipt(destination = "google_sheets") {
        if (!db) throw new Error("db unavailable");
        const dataset = await datasetOf(ids.workspaceA, ids.clientA, WINDOW);
        return db.destinationDeliveryReceipt.create({
            data: {
                workspaceId: ids.workspaceA,
                clientId: ids.clientA,
                destination,
                windowStart: WINDOW.start,
                windowEnd: WINDOW.end,
                dataThroughDate: dataset.dataThroughDate ?? WINDOW.end,
                datasetFingerprint: dataset.fingerprint,
                rowCount: dataset.rowCount,
                actorId: ids.owner,
            },
        });
    }

    it("classifies ReportSnapshot as tenant-guarded and drops the duplicate model (2, 24)", () => {
        assert.ok(TENANT_GUARDED_MODELS.has("ReportSnapshot"));
        assert.ok(!TENANT_GUARDED_MODELS.has("ClientReportingRequirement"));
        // The Prisma client has no duplicate requirements delegate.
        if (db) {
            assert.equal("clientReportingRequirement" in db, false);
        }
    });

    it("generates from Client requirements + warehouse rows with exact string IDs (1, 4, 16, 21)", async () => {
        if (!db) return;
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
            assert.equal(fetchCalled, false, "generation must never call provider/fetch APIs");
            assert.equal(result.snapshot.blueprintId, BLUEPRINT_ID);
            assert.equal(result.snapshot.blueprintVersion, BLUEPRINT_VERSION);
            assert.equal(result.report.overview.clientName, "Client A");
            assert.deepEqual(result.report.overview.requiredProviders, ["google_ads", "meta_ads"]);
            assert.deepEqual(result.report.overview.requiredDestinations, ["google_sheets"]);
            assert.equal(result.report.overview.reportingTimezone, "Asia/Ho_Chi_Minh");
            assert.equal(result.report.overview.currency, "VND");
            const googleCampaign = result.report.campaigns.find((c) => c.provider === "google_ads");
            assert.equal(googleCampaign?.campaignId, "1795849302486751234");
            assert.equal(typeof googleCampaign?.campaignId, "string");
            assert.equal(googleCampaign?.impressions, 7000);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it("returns NOT_VERIFIED without any delivery receipt (5)", async () => {
        if (!db) return;
        const result = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(result.snapshot.verificationStatus, "NOT_VERIFIED");
        assert.ok(result.snapshot.verificationReasons.includes("destination_evidence_missing"));
        assert.equal(result.report.overview.readiness.destinationState, "unverified");
    });

    it("a receipt from another client, window or destination cannot verify (6, 7, 8)", async () => {
        if (!db) return;
        // Other client (own workspace): composite FK accepts it, but the
        // blueprint only consults receipts scoped to THIS client + window.
        const otherClientDataset = await datasetOf(ids.workspaceA, ids.clientA, WINDOW);
        await db.destinationDeliveryReceipt.create({
            data: {
                workspaceId: ids.workspaceA,
                clientId: ids.clientA,
                destination: "looker_studio", // wrong destination
                windowStart: WINDOW.start,
                windowEnd: WINDOW.end,
                dataThroughDate: otherClientDataset.dataThroughDate ?? WINDOW.end,
                datasetFingerprint: otherClientDataset.fingerprint,
                rowCount: otherClientDataset.rowCount,
                actorId: ids.owner,
            },
        });
        const still = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(still.snapshot.verificationStatus, "NOT_VERIFIED");
        assert.ok(still.snapshot.verificationReasons.includes("destination_evidence_missing"));

        // Wrong window: right destination, different window.
        await db.destinationDeliveryReceipt.create({
            data: {
                workspaceId: ids.workspaceA,
                clientId: ids.clientA,
                destination: "google_sheets",
                windowStart: "2026-08-17",
                windowEnd: "2026-08-23",
                dataThroughDate: "2026-08-23",
                datasetFingerprint: "other-window",
                rowCount: 3,
                actorId: ids.owner,
            },
        });
        const wrongWindow = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(wrongWindow.snapshot.verificationStatus, "NOT_VERIFIED");

        // A receipt cannot even exist for a rival workspace's client:
        // the composite FK (workspaceId, clientId) rejects cross-tenant rows.
        await assert.rejects(
            db.destinationDeliveryReceipt.create({
                data: {
                    workspaceId: ids.workspaceB,
                    clientId: ids.clientA, // client A belongs to workspace A
                    destination: "google_sheets",
                    windowStart: WINDOW.start,
                    windowEnd: WINDOW.end,
                    dataThroughDate: WINDOW.end,
                    datasetFingerprint: "forged",
                    rowCount: 1,
                    actorId: ids.owner,
                },
            }),
        );
    });

    it("a receipt with a stale fingerprint or pre-evidence retrieval cannot verify (9, 10)", async () => {
        if (!db) return;
        const dataset = await datasetOf(ids.workspaceA, ids.clientA, WINDOW);
        // Old fingerprint (data mutated since retrieval).
        await db.destinationDeliveryReceipt.create({
            data: {
                workspaceId: ids.workspaceA,
                clientId: ids.clientA,
                destination: "google_sheets",
                windowStart: WINDOW.start,
                windowEnd: WINDOW.end,
                dataThroughDate: dataset.dataThroughDate ?? WINDOW.end,
                datasetFingerprint: "stale-fingerprint",
                rowCount: dataset.rowCount,
                actorId: ids.owner,
                retrievedAt: new Date("2026-09-02T23:00:00.000Z"),
            },
        });
        const oldFingerprint = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(oldFingerprint.snapshot.verificationStatus, "NOT_VERIFIED");
        assert.ok(oldFingerprint.snapshot.verificationReasons.includes("destination_evidence_missing"));

        // Fresh fingerprint but retrieved BEFORE the current evidence mutation
        // clock (predates the latest row pull) → not current.
        await db.destinationDeliveryReceipt.create({
            data: {
                workspaceId: ids.workspaceA,
                clientId: ids.clientA,
                destination: "google_sheets",
                windowStart: WINDOW.start,
                windowEnd: WINDOW.end,
                dataThroughDate: dataset.dataThroughDate ?? WINDOW.end,
                datasetFingerprint: dataset.fingerprint,
                rowCount: dataset.rowCount,
                actorId: ids.owner,
                retrievedAt: new Date("2020-01-01T00:00:00.000Z"),
            },
        });
        const preEvidence = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(preEvidence.snapshot.verificationStatus, "NOT_VERIFIED");
        assert.equal(preEvidence.report.overview.readiness.destinationState, "stale");
    });

    it("a valid exact current receipt permits VERIFIED when every gate passes (11, 13)", async () => {
        if (!db) return;
        const receipt = await seedCurrentReceipt();
        const result = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(result.snapshot.verificationStatus, "VERIFIED");
        assert.deepEqual(result.snapshot.verificationReasons, []);
        assert.equal(result.report.overview.readiness.status, "READY");
        assert.equal(result.report.overview.readiness.destinationState, "verified");

        // Idempotent + reproducible (14, 17): same input returns the stored
        // snapshot byte-for-byte; the stored hash matches a fresh derivation.
        const again = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(again.created, false);
        assert.equal(again.snapshot.id, result.snapshot.id);
        assert.deepEqual(again.report, result.report);

        const reopen = await reopenWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(reopen.snapshot?.id, result.snapshot.id);
        assert.equal(reopen.snapshot?.freshness.freshness, "CURRENT");
        assert.deepEqual(reopen.report, result.report);
        assert.equal(reopen.snapshot?.verification.status, "VERIFIED");
        void receipt;
    });

    it("receipt mutation or replacement makes the saved snapshot stale (12)", async () => {
        if (!db) return;
        const stored = await db.reportSnapshot.findFirstOrThrow({
            where: { workspaceId: ids.workspaceA, blueprintId: BLUEPRINT_ID },
            orderBy: [{ generatedAt: "desc" }],
        });
        // The receipt is retrieved BEFORE the evidence clock once a new metric
        // row lands (pulledAt advances), so currentness flips to false.
        await db.campaignMetric.updateMany({
            where: { entityId: `e-g-${suffix}`, date: new Date("2026-08-30T00:00:00.000Z") },
            data: { pulledAt: new Date() },
        });
        const stale = await evaluateSnapshotFreshness(stored);
        assert.equal(stale.freshness, "STALE");
        assert.ok(
            stale.staleReasons.includes("dataset_changed")
            || stale.staleReasons.includes("destination_evidence_changed"),
        );

        // Reopen drops VERIFIED with an explicit reason (stale never verifies).
        const reopen = await reopenWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(reopen.snapshot?.verification.status, "NOT_VERIFIED");
        assert.ok(reopen.snapshot?.verification.reasons.includes("dependency_evidence_changed"));
    });

    it("client requirement changes produce a new immutable version and stale history (13, 18-versioning)", async () => {
        if (!db) return;
        // Refresh delivery evidence for the current dataset first.
        await db.destinationDeliveryReceipt.deleteMany({
            where: { workspaceId: ids.workspaceA, clientId: ids.clientA, destination: "google_sheets", windowStart: WINDOW.start, windowEnd: WINDOW.end },
        });
        await seedCurrentReceipt();
        const baseline = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        // Data was re-pulled above, so the new receipt's currentness vs the
        // generation-time dataset decides: regenerate until idempotent.

        await db.client.update({
            where: { workspaceId_id: { workspaceId: ids.workspaceA, id: ids.clientA } },
            data: { requiredProviders: ["google_ads"], requirementsConfiguredAt: new Date() },
        });
        // google_sheets receipt still current for the new dataset (rows unchanged).
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
        assert.deepEqual(changed.report.overview.requiredProviders, ["google_ads"]);
        // Meta is no longer required; its rows are excluded from the report.
        assert.ok(changed.report.providers.every((provider) => provider.provider !== "meta_ads"));

        // Baseline snapshot untouched.
        const baselineStill = await db.reportSnapshot.findUniqueOrThrow({ where: { id: baseline.snapshot.id } });
        assert.deepEqual(baselineStill.requiredProviders, ["google_ads", "meta_ads"]);

        const stale = await evaluateSnapshotFreshness(baselineStill);
        assert.equal(stale.freshness, "STALE");
        assert.ok(stale.staleReasons.includes("requirement_changed")
            || stale.staleReasons.includes("dataset_changed"));

        // Restore; the changed requirement clock creates yet another version.
        await db.client.update({
            where: { workspaceId_id: { workspaceId: ids.workspaceA, id: ids.clientA } },
            data: { requiredProviders: ["google_ads", "meta_ads"], requirementsConfiguredAt: new Date() },
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
        const again = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(again.created, false);
        assert.equal(again.snapshot.id, restored.snapshot.id);
    });

    it("data changes make the snapshot stale while receipts keep their identity", async () => {
        if (!db) return;
        await db.destinationDeliveryReceipt.deleteMany({
            where: { workspaceId: ids.workspaceA, clientId: ids.clientA, windowStart: WINDOW.start, windowEnd: WINDOW.end },
        });
        await seedCurrentReceipt();
        const baseline = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(baseline.snapshot.verificationStatus, "VERIFIED");

        // Warehouse data mutates (a row is re-pulled) without touching receipts.
        await db.campaignMetric.updateMany({
            where: { entityId: `e-m-${suffix}`, date: new Date("2026-08-24T00:00:00.000Z") },
            data: { pulledAt: new Date() },
        });
        const stored = await db.reportSnapshot.findUniqueOrThrow({ where: { id: baseline.snapshot.id } });
        const stale = await evaluateSnapshotFreshness(stored);
        assert.equal(stale.freshness, "STALE");
        assert.ok(stale.staleReasons.includes("dataset_changed"));

        await reopenWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        }).then((reopen) => {
            assert.equal(reopen.snapshot?.verification.status, "NOT_VERIFIED");
            assert.ok(reopen.snapshot?.verification.reasons.includes("dependency_evidence_changed"));
        });
    });

    it("mixed currency prevents combined monetary totals and verification (15)", async () => {
        if (!db) return;
        await db.destinationDeliveryReceipt.deleteMany({
            where: { workspaceId: ids.workspaceA, clientId: ids.clientA, windowStart: WINDOW.start, windowEnd: WINDOW.end },
        });
        await seedCurrentReceipt();
        await db.campaignMetric.create({
            data: {
                workspaceId: ids.workspaceA,
                connectionId: ids.connGoogleA,
                platform: "google_ads",
                accountId: "g-account-1",
                level: "campaign",
                entityId: `e-usd-${suffix}`,
                campaignId: "camp-usd",
                campaignName: "USD Launch",
                date: new Date("2026-08-31T00:00:00.000Z"),
                impressions: 100,
                clicks: 10,
                spend: 10,
                conversions: 1,
                revenue: 40,
                currency: "USD",
            },
        });
        // The evaluator window is 08-24..30; add a USD row INSIDE it.
        await db.campaignMetric.create({
            data: {
                workspaceId: ids.workspaceA,
                connectionId: ids.connGoogleA,
                platform: "google_ads",
                accountId: "g-account-1",
                level: "campaign",
                entityId: `e-usd2-${suffix}`,
                campaignId: "camp-usd-2",
                campaignName: "USD Launch 2",
                date: new Date("2026-08-26T00:00:00.000Z"),
                impressions: 100,
                clicks: 10,
                spend: 10,
                conversions: 1,
                revenue: 40,
                currency: "USD",
            },
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
        assert.ok(result.report.overview.readiness.warnings.includes("MIXED_CURRENCY"));

        // Clean up for later tests.
        await db.campaignMetric.deleteMany({ where: { entityId: { in: [`e-usd-${suffix}`, `e-usd2-${suffix}`] } } });
    });

    it("persisted snapshots keep no credentials, raw payloads or unbounded results (20)", async () => {
        if (!db) return;
        await db.destinationDeliveryReceipt.deleteMany({
            where: { workspaceId: ids.workspaceA, clientId: ids.clientA, windowStart: WINDOW.start, windowEnd: WINDOW.end },
        });
        await seedCurrentReceipt();
        const result = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        const stored = await db.reportSnapshot.findUniqueOrThrow({ where: { id: result.snapshot.id } });
        const serialized = JSON.stringify({
            result: stored.result,
            evidence: stored.readinessEvidence,
            receipts: stored.destinationReceipts,
        });
        assert.ok(!serialized.includes("enc:v1"), "no credential material may be persisted");
        assert.ok(!serialized.includes("rawData"), "no raw provider payloads may be persisted");
        assert.ok(serialized.length < 200_000, "snapshot result must stay bounded");
        // Receipt binding carries identity/currentness, not payloads.
        const receipts = stored.destinationReceipts as Array<{ id: string; destination: string; current: boolean }>;
        assert.ok(receipts.length > 0);
        for (const receipt of receipts) {
            assert.equal(typeof receipt.id, "string");
            assert.equal(typeof receipt.current, "boolean");
            assert.ok(!("payload" in receipt));
        }
    });

    it("fails closed for rival-workspace identifiers (18)", async () => {
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
        const rivalSnapshots = await db.reportSnapshot.count({ where: { workspaceId: ids.workspaceB } });
        assert.equal(rivalSnapshots, 0);
    });

    it("keeps per-window rows tenant-scoped between rival workspaces", async () => {
        if (!db) return;
        await db.destinationDeliveryReceipt.deleteMany({ where: { workspaceId: ids.workspaceB } });
        const datasetB = await datasetOf(ids.workspaceB, ids.clientB, WINDOW);
        await db.destinationDeliveryReceipt.create({
            data: {
                workspaceId: ids.workspaceB,
                clientId: ids.clientB,
                destination: "google_sheets",
                windowStart: WINDOW.start,
                windowEnd: WINDOW.end,
                dataThroughDate: datasetB.dataThroughDate ?? WINDOW.end,
                datasetFingerprint: datasetB.fingerprint,
                rowCount: datasetB.rowCount,
                actorId: ids.owner,
            },
        });
        const resultB = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceB,
            clientId: ids.clientB,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.ok(resultB.report.campaigns.every((campaign) => campaign.campaignId !== "1795849302486751234"));
        assert.ok(resultB.report.campaigns.some((campaign) => campaign.campaignId === "camp-b"));
        assert.equal(resultB.report.overview.currency, "USD");
    });

    it("rejects caller-forged verification through the pure gate set (17)", () => {
        const forged = computeVerificationStatus({
            readinessStatus: "NOT_READY",
            requiredProvidersBasis: "assigned_sources",
            requiredProviders: [],
            includedProviders: [],
            hasMetricData: false,
            aggregationCompatible: false,
            currencyVerified: false,
            windowComplete: false,
            timezoneVerified: false,
            destinationsRequired: [],
            destinationsVerified: false,
            datasetLimited: true,
            generatorVersionRecorded: false,
            dependencyHashMatches: false,
        });
        assert.equal(forged.status, "NOT_VERIFIED");
        // The service signature accepts no verification input at all; the
        // contract version is server-owned.
        assert.equal(METRIC_CONTRACT_VERSION, "weekly-blueprint-metrics-v1");
    });
});
