import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
    BLUEPRINT_ID,
    BLUEPRINT_VERSION,
    comparisonWindowFor,
    computeVerificationStatus,
    evaluateSnapshotFreshness,
    generateWeeklyBlueprint,
    computeDependencyHash,
    computeGenerationKey,
    METRIC_CONTRACT_VERSION,
    reopenWeeklyBlueprint,
    _setPublicationTestHooks,
    type DependencyState,
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
/**
 * Deterministic concurrency barriers. These poll DATABASE state (ungranted
 * advisory locks) until the forced interleaving is actually established —
 * they never depend on wall-clock timing, retries, or race windows.
 */
const POLL_INTERVAL_MS = 10;
const POLL_MAX_TRIES = 2_000;

async function countBlockedAdvisoryWaiters(dbForLocks: PrismaClient, generationKey: string): Promise<number> {
    return (await blockedAdvisoryWaiters(dbForLocks, generationKey)).length;
}

/**
 * Waiters on the EXACT advisory-lock key the service uses, identified by:
 * the 64-bit key split (classid = high 32 bits, objid = low 32 bits),
 * objsubid = 1 (single-key advisory form), and the CURRENT database OID —
 * plus the blocking sessions' backend PIDs with their database names.
 * Unrelated advisory waiters (different keys, two-integer forms, other
 * databases) can never satisfy the barrier.
 */
async function blockedAdvisoryWaiters(dbForLocks: PrismaClient, generationKey: string): Promise<Array<{ pid: number; datname: string | null }>> {
    const rows = await dbForLocks.$queryRaw<Array<{ pid: number; datname: string | null }>>`
        SELECT a.pid::int AS pid, current_database() AS datname
        FROM pg_locks l
        CROSS JOIN (SELECT hashtext(${generationKey})::bigint AS v) k
        CROSS JOIN (SELECT oid AS dboid FROM pg_database WHERE datname = current_database()) d
        LEFT JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'advisory' AND NOT l.granted
          AND l.objsubid = 1
          AND l.classid = ((k.v >> 32) & 4294967295)
          AND l.objid = (k.v & 4294967295)
          AND l.database = d.dboid`;
    return rows;
}

async function waitForCondition(
    condition: () => boolean | Promise<boolean>,
    label: string,
    dbForLocks?: PrismaClient,
): Promise<void> {
    for (let attempt = 0; attempt < POLL_MAX_TRIES; attempt += 1) {
        if (await condition()) return;
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error(`Deterministic barrier not established: ${label}`);
}


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
            adsetId?: string; adId?: string;
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
                // Meta rows shaped EXACTLY like the active syncMetaAds output:
                // level "ad", entityId = ad_id, adsetId/adId set, campaign
                // identity carried on every ad row. Two ads per campaign.
                {
                    workspaceId: ids.workspaceA, connectionId: ids.connMetaA, platform: "meta_ads",
                    accountId: "m-account-1", level: "ad", entityId: `ad-a-${suffix}`,
                    campaignId: "120210543958", campaignName: "Retargeting",
                    adsetId: "adset-1", adId: `ad-a-${suffix}`,
                    date: new Date(`${day}T00:00:00.000Z`),
                    impressions: 1200, clicks: 40, spend: 1_200_000, conversions: 1, revenue: 3_000_000, currency: "VND",
                },
                {
                    workspaceId: ids.workspaceA, connectionId: ids.connMetaA, platform: "meta_ads",
                    accountId: "m-account-1", level: "ad", entityId: `ad-b-${suffix}`,
                    campaignId: "120210543958", campaignName: "Retargeting",
                    adsetId: "adset-1", adId: `ad-b-${suffix}`,
                    date: new Date(`${day}T00:00:00.000Z`),
                    impressions: 800, clicks: 20, spend: 800_000, conversions: 1, revenue: 2_000_000, currency: "VND",
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

    /** Canonical dataset fingerprint through a real transaction client, with
     *  the same explicit provider scope generation uses. */
    async function datasetOf(workspaceId: string, clientId: string, window: { start: string; end: string }) {
        if (!db) throw new Error("db unavailable");
        return db.$transaction(async (tx) => {
            const client = await (tx as ScopedTransaction).client.findFirst({
                where: { id: clientId, workspaceId },
                select: { requiredProviders: true, requirementsConfiguredAt: true },
            });
            const scope = client?.requirementsConfiguredAt && client.requiredProviders.length > 0
                ? client.requiredProviders
                : undefined;
            return reportingDataset(tx as ScopedTransaction, workspaceId, clientId, window, scope);
        });
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
            where: { entityId: `ad-a-${suffix}`, date: new Date("2026-08-24T00:00:00.000Z") },
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

    it("Meta ad rows roll up to campaign identity without double-counting (P1-3)", async () => {
        if (!db) return;
        await db.destinationDeliveryReceipt.deleteMany({
            where: { workspaceId: ids.workspaceA, clientId: ids.clientA, windowStart: WINDOW.start, windowEnd: WINDOW.end },
        });
        // A legacy campaign-level aggregate from an earlier warehouse refresh:
        // non-authoritative for meta_ads, must be ignored — never summed.
        // Created BEFORE the receipt so delivery evidence covers the dataset.
        await db.campaignMetric.create({
            data: {
                workspaceId: ids.workspaceA, connectionId: ids.connMetaA, platform: "meta_ads",
                accountId: "m-account-1", level: "campaign", entityId: `legacy-m-${suffix}`,
                campaignId: "120210543958", campaignName: "Retargeting",
                date: new Date("2026-08-25T00:00:00.000Z"),
                impressions: 100_000, clicks: 5_000, spend: 90_000_000, conversions: 50, revenue: 900_000_000, currency: "VND",
            },
        });
        await seedCurrentReceipt();
        const result = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        // Meta provider totals = ad rows only (2000 impr/day × 7 = 14000),
        // the legacy campaign aggregate (700,000 impr) must not inflate it.
        const meta = result.report.providers.find((provider) => provider.provider === "meta_ads");
        assert.equal(meta?.metrics?.impressions, 14_000);
        assert.equal(meta?.metrics?.spend, 14_000_000);
        // One campaign row for the Meta campaign despite multiple ads + legacy row.
        const metaCampaigns = result.report.campaigns.filter((campaign) => campaign.campaignId === "120210543958");
        assert.equal(metaCampaigns.length, 1);
        // Verification is unaffected by the ignored duplicate grain.
        assert.equal(result.snapshot.verificationStatus, "VERIFIED");

        await db.campaignMetric.deleteMany({ where: { entityId: `legacy-m-${suffix}` } });
    });

    it("fails verification closed when a provider holds only unsupported grains (P1-3)", async () => {
        if (!db) return;
        await db.destinationDeliveryReceipt.deleteMany({
            where: { workspaceId: ids.workspaceA, clientId: ids.clientA, windowStart: WINDOW.start, windowEnd: WINDOW.end },
        });
        await seedCurrentReceipt();
        // Demote the google campaign rows to ad grain: for google_ads the
        // authoritative grain is campaign, so the window now holds only
        // unsupported grain evidence for that provider.
        await db.campaignMetric.updateMany({
            where: { connectionId: ids.connGoogleA, platform: "google_ads", date: { gte: new Date(`${WINDOW.start}T00:00:00.000Z`), lte: new Date(`${WINDOW.end}T23:59:59.999Z`) } },
            data: { level: "ad" },
        });
        const result = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(result.snapshot.verificationStatus, "NOT_VERIFIED");
        assert.ok(result.snapshot.verificationReasons.includes("aggregation_grain_unsupported:google_ads"));
        // Google contributes no aggregated rows; Meta (authoritative ad grain) still does.
        const google = result.report.providers.find((provider) => provider.provider === "google_ads");
        assert.equal(google?.metrics?.impressions, 0);
        // Restore the authoritative grain.
        await db.campaignMetric.updateMany({
            where: { connectionId: ids.connGoogleA, platform: "google_ads", date: { gte: new Date(`${WINDOW.start}T00:00:00.000Z`), lte: new Date(`${WINDOW.end}T23:59:59.999Z`) } },
            data: { level: "campaign" },
        });
    });

    it("a correction to previous-week data makes the snapshot stale and regeneration versions (P1-2)", async () => {
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

        // Correct data in the COMPARISON window only.
        await db.campaignMetric.updateMany({
            where: { entityId: `e-g-prev-${suffix}`, date: new Date("2026-08-18T00:00:00.000Z") },
            data: { spend: 999, pulledAt: new Date() },
        });
        const stored = await db.reportSnapshot.findUniqueOrThrow({ where: { id: baseline.snapshot.id } });
        const stale = await evaluateSnapshotFreshness(stored);
        assert.equal(stale.freshness, "STALE");
        assert.ok(stale.staleReasons.includes("dataset_changed"));

        const regenerated = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        assert.equal(regenerated.created, true);
        assert.equal(regenerated.snapshot.sequence, baseline.snapshot.sequence + 1);

        // Baseline untouched.
        const baselineStill = await db.reportSnapshot.findUniqueOrThrow({ where: { id: baseline.snapshot.id } });
        const oldCampaign = (baselineStill.result as { campaigns: Array<{ campaignId: string; changes: Array<{ field: string; previous: number | null }> }> })
            .campaigns.find((campaign) => campaign.campaignId === "1795849302486751234");
        assert.ok(oldCampaign);
        assert.equal(oldCampaign.changes.find((change) => change.field === "spend")?.previous, 8_000_000);
    });

    it("rejects direct cross-workspace snapshot insertion at the database level (P1-4)", async () => {
        if (!db) return;
        await assert.rejects(
            db.reportSnapshot.create({
                data: {
                    workspaceId: ids.workspaceB,
                    clientId: ids.clientA, // client A belongs to workspace A
                    blueprintId: BLUEPRINT_ID,
                    blueprintVersion: 1,
                    generationKey: `gk-cross-${suffix}`,
                    sequence: 1,
                    reportingWindowStart: new Date("2026-08-24T00:00:00.000Z"),
                    reportingWindowEnd: new Date("2026-08-30T00:00:00.000Z"),
                    requiredProviders: ["google_ads"],
                    requiredDestinations: ["google_sheets"],
                    includedProviders: [],
                    includedAccountIds: [],
                    dataThroughByProvider: {},
                    metricContractVersions: {},
                    datasetFingerprint: "x",
                    readinessStatus: "NOT_READY",
                    verificationStatus: "NOT_VERIFIED",
                    verificationReasons: [],
                    readinessEvidence: {},
                    destinationReceipts: [],
                    schemaVersion: 2,
                    dependencyHash: "x",
                    result: {},
                },
            }),
        );
        const leaked = await db.reportSnapshot.count({ where: { generationKey: `gk-cross-${suffix}` } });
        assert.equal(leaked, 0);
    });

    it("concurrent same-state generation is idempotent: one snapshot, no failures (P2-1)", async () => {
        if (!db) return;
        await db.destinationDeliveryReceipt.deleteMany({
            where: { workspaceId: ids.workspaceA, clientId: ids.clientA, windowStart: WINDOW.start, windowEnd: WINDOW.end },
        });
        await seedCurrentReceipt();
        const params = {
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        };
        const results = await Promise.all([
            generateWeeklyBlueprint(params),
            generateWeeklyBlueprint(params),
            generateWeeklyBlueprint(params),
            generateWeeklyBlueprint(params),
            generateWeeklyBlueprint(params),
        ]);
        const uniqueIds = new Set(results.map((result) => result.snapshot.id));
        assert.equal(uniqueIds.size, 1, "all concurrent same-state generations must return one snapshot");
        const rows = await db.reportSnapshot.count({ where: { generationKey: results[0].snapshot.generationKey } });
        assert.ok(rows >= 1);
        const uniqueSequences = new Set(
            (await db.reportSnapshot.findMany({ where: { generationKey: results[0].snapshot.generationKey } }))
                .map((row) => row.sequence),
        );
        assert.equal(uniqueSequences.size, (await db.reportSnapshot.findMany({ where: { generationKey: results[0].snapshot.generationKey } })).length);
    });

    it("forced identical concurrency stores one row and every caller reads the winner (P2-1)", async () => {
        if (!db) return;
        await db.destinationDeliveryReceipt.deleteMany({
            where: { workspaceId: ids.workspaceA, clientId: ids.clientA, windowStart: WINDOW.start, windowEnd: WINDOW.end },
        });
        await seedCurrentReceipt();
        const params = {
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        };
        const generationKey = computeGenerationKey(
            ids.workspaceA, ids.clientA, WINDOW, comparisonWindowFor(WINDOW),
        );

        // Deterministic database barrier: a holder transaction takes the SAME
        // transaction-scoped advisory lock the service uses, so both
        // generations park at their create transaction. No timing involved —
        // the test releases the barrier only after both are verifiably blocked.
        const lockClient = new PrismaClient();
        await lockClient.$connect();
        let holderOpen = false;
        const barrier: { release: (() => void) | null } = { release: null };
        const holder = lockClient.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${generationKey}))`;
            holderOpen = true;
            await new Promise<void>((resolve) => { barrier.release = resolve; });
            return true;
        }, { timeout: 120_000 });
        await waitForCondition(() => holderOpen, "barrier holder open");

        // Negative control: an unrelated advisory-lock waiter (different key)
        // exists but can never satisfy this barrier.
        const unrelatedKey = `unrelated-${suffix}`;
        let unrelatedOpen = false;
        const unrelatedBarrier: { release: (() => void) | null } = { release: null };
        const unrelatedHolder = lockClient.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${unrelatedKey}))`;
            unrelatedOpen = true;
            await new Promise<void>((resolve) => { unrelatedBarrier.release = resolve; });
            return true;
        }, { timeout: 60_000 });
        await waitForCondition(() => unrelatedOpen, "unrelated holder open");
        const unrelatedWaiter = lockClient.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${unrelatedKey}))`;
            return true;
        }, { timeout: 60_000 });
        // Negative control: a two-integer advisory lock whose BOTH integers
        // equal the raw hashtext value — a naive filter without the exact
        // key split would mistake it for our key. It must not count.
        const twoIntKey = `two-int-${suffix}`;
        let twoIntHolderOpen = false;
        const twoIntBarrier: { release: (() => void) | null } = { release: null };
        const twoIntHolder = lockClient.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${twoIntKey}), hashtext(${twoIntKey}))`;
            twoIntHolderOpen = true;
            await new Promise<void>((resolve) => { twoIntBarrier.release = resolve; });
            return true;
        }, { timeout: 60_000 });
        await waitForCondition(() => twoIntHolderOpen, "two-int holder open");
        const twoIntWaiter = lockClient.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${twoIntKey}), hashtext(${twoIntKey}))`;
            return true;
        }, { timeout: 60_000 });
        // Negative control: a waiter on the NEGATED hashtext value as a plain
        // bigint — a different 64-bit target than the service's key.
        const negativeWaiter = lockClient.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(-hashtext(${generationKey})::bigint)`;
            return true;
        }, { timeout: 60_000 });
        const lockDb = db as PrismaClient;
        try {
            await waitForCondition(async () => (await countBlockedAdvisoryWaiters(lockDb, unrelatedKey)) >= 1, "unrelated waiter blocked", lockDb);
            // The two-int waiter is verified blocked with its OWN lock shape
            // (classid=objid=hashtext, objsubid=2) — our exact-key barrier
            // (objsubid=1, split key) must not count it.
            await waitForCondition(async () => {
                const twoIntBlocked = await lockDb.$queryRaw<Array<{ n: bigint }>>`
                    SELECT count(*)::bigint AS n
                    FROM pg_locks l
                    CROSS JOIN (SELECT hashtext(${twoIntKey})::int AS h) k
                    WHERE l.locktype = 'advisory' AND NOT l.granted
                      AND l.objsubid = 2
                      AND l.classid = k.h
                      AND l.objid = k.h`;
                return Number(twoIntBlocked[0]?.n ?? 0) >= 1;
            }, "two-int waiter blocked on its own lock shape", lockDb);
            assert.equal(await countBlockedAdvisoryWaiters(lockDb, generationKey), 0, "negative controls: unrelated, two-int and negative-target waiters are not counted for this key");

            const first = generateWeeklyBlueprint(params);
            const second = generateWeeklyBlueprint(params);
            await waitForCondition(async () => (await countBlockedAdvisoryWaiters(lockDb, generationKey)) >= 2, "both generations blocked on the barrier", lockDb);
            // The blocked sessions are generators in THIS database.
            const currentDb = await lockDb.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
            for (const waiter of await blockedAdvisoryWaiters(lockDb, generationKey)) {
                assert.equal(waiter.datname, currentDb[0]?.db);
            }
            unrelatedBarrier.release?.();
            twoIntBarrier.release?.();
            await unrelatedHolder;
            await unrelatedWaiter.catch(() => undefined);
            await twoIntHolder.catch(() => undefined);
            await twoIntWaiter.catch(() => undefined);
            await negativeWaiter.catch(() => undefined);
            barrier.release?.();
            await holder;

            const [a, b] = await Promise.all([first, second]);
            assert.equal(a.snapshot.id, b.snapshot.id, "identical concurrency must agree on one snapshot");
            assert.equal(a.created !== b.created, true, "exactly one caller reports created:true");
            const rows = await db.reportSnapshot.count({ where: { generationKey, dependencyHash: a.snapshot.dependencyHash } });
            assert.equal(rows, 1, "exactly one snapshot row stored for this dependency state");
        } finally {
            barrier.release?.();
            unrelatedBarrier.release?.();
        }
        await holder;
        await unrelatedHolder.catch(() => undefined);
        await unrelatedWaiter.catch(() => undefined);
        await lockClient.$disconnect();
    });

    it("dataset change during candidate generation discards and republishes bound to the new state (P2-1, F1)", async () => {
        if (!db) return;
        await db.destinationDeliveryReceipt.deleteMany({
            where: { workspaceId: ids.workspaceA, clientId: ids.clientA, windowStart: WINDOW.start, windowEnd: WINDOW.end },
        });
        // Own mutable row so the candidate change never depends on other tests.
        await db.campaignMetric.create({
            data: {
                workspaceId: ids.workspaceA, connectionId: ids.connGoogleA, platform: "google_ads",
                accountId: "g-account-1", level: "campaign", entityId: `e-race3-${suffix}`,
                campaignId: "race-campaign", campaignName: "Race",
                date: new Date("2026-08-27T00:00:00.000Z"),
                impressions: 100, clicks: 10, spend: 500_000, conversions: 1, revenue: 2_000_000, currency: "VND",
            },
        }).catch(() => undefined);
        await seedCurrentReceipt();
        const params = {
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        };
        const generationKey = computeGenerationKey(
            ids.workspaceA, ids.clientA, WINDOW, comparisonWindowFor(WINDOW),
        );
        const mutate = () => db!.campaignMetric.updateMany({
            where: { entityId: `e-race3-${suffix}`, date: new Date("2026-08-27T00:00:00.000Z") },
            data: { pulledAt: new Date() },
        });

        // Deterministic publication interleaving via the internal test hook:
        // the candidate parks AFTER evaluation (holding the generation lock
        // and having computed the S1 binding), the dataset mutates, then the
        // candidate resumes. Re-validation must discard it and the retry must
        // publish bound to S2 — never the stale S1 VERIFIED result.
        const parkedRelease: { release: (() => void) | null } = { release: null };
        const parkedPromise = new Promise<void>((resolve) => { parkedRelease.release = () => resolve(); });
        let sawParkedGeneration = false;
        _setPublicationTestHooks({
            afterEvidence: async (info) => {
                if (info.generationKey !== generationKey) return;
                sawParkedGeneration = true;
                await parkedPromise;
            },
        });
        const lockDb = db as PrismaClient;
        try {
            const pending = generateWeeklyBlueprint(params);
            await waitForCondition(() => sawParkedGeneration, "generation parked after evidence", lockDb);
            // The dataset mutates only while the candidate is parked.
            await mutate();
            parkedRelease.release?.();
            const result = await pending;
            assert.equal(sawParkedGeneration, true, "the deterministic seam was reached");
            assert.equal(result.created, true);
            // Bound to the POST-mutation dataset: only reachable through the
            // discard-and-regenerate path.
            const datasetAfter = await datasetOf(ids.workspaceA, ids.clientA, WINDOW);
            const stored = await db.reportSnapshot.findUniqueOrThrow({ where: { id: result.snapshot.id } });
            const storedState = (stored.readinessEvidence as { dependencyState: DependencyState }).dependencyState;
            assert.equal(stored.datasetFingerprint, datasetAfter.fingerprint, "published binding is the superseding dataset S2, not the stale S1");
            assert.equal(computeDependencyHash(storedState), stored.dependencyHash, "stored hash matches its own state");
            assert.equal(result.report.overview.verification.status, "NOT_VERIFIED", "the receipt no longer matches the superseding dataset — honest, never a stale VERIFIED");
        } finally {
            _setPublicationTestHooks({});
        }

        // The versioned history keeps exactly one row per dependency state.
        const rows = await db.reportSnapshot.findMany({ where: { generationKey } });
        const sequences = rows.map((row: { sequence: number }) => row.sequence);
        assert.equal(new Set(sequences).size, sequences.length, "no duplicate sequences");
        await db.campaignMetric.deleteMany({ where: { entityId: `e-race3-${suffix}` } });
    });

    it("enforces the UNIQUE (generationKey, dependencyHash) constraint in the database (P2-1)", async () => {
        if (!db) return;
        const indexes = await db.$queryRaw<Array<{ indexdef: string }>>`
            SELECT indexdef FROM pg_indexes
            WHERE tablename = 'ReportSnapshot' AND indexdef LIKE '%generationKey_dependencyHash%'`;
        assert.equal(indexes.length, 1);
        assert.match(indexes[0].indexdef, /UNIQUE INDEX/);
    });

    it("R1→R2 interleave: generation must not return a verified R1 snapshot after R2 commits before publication (F1)", async () => {
        if (!db) return;
        const clientD = `client-req-${suffix}`;
        const connDG = `conn-reqg-${suffix}`;
        const connDM = `conn-reqm-${suffix}`;
        await db.client.create({
            data: {
                id: clientD, workspaceId: ids.workspaceA, name: "Requirement Client",
                requiredProviders: ["google_ads", "meta_ads"], requiredDestinations: ["google_sheets"],
                requirementsConfiguredAt: new Date("2026-08-20T00:00:00.000Z"),
            },
        });
        await db.connection.createMany({
            data: [
                { id: connDG, workspaceId: ids.workspaceA, clientId: clientD, name: "Req G", type: "source", provider: "google_ads", credentials: "enc:v1:test", remoteAccountId: `req-g-${suffix}`, status: "connected", lastSyncAt: new Date() },
                { id: connDM, workspaceId: ids.workspaceA, clientId: clientD, name: "Req M", type: "source", provider: "meta_ads", credentials: "enc:v1:test", remoteAccountId: `req-m-${suffix}`, status: "connected", lastSyncAt: new Date() },
            ],
        });
        await db.accountReportingContext.createMany({
            data: [
                { workspaceId: ids.workspaceA, connectionId: connDG, accountId: `req-g-${suffix}`, providerTimezone: "Asia/Ho_Chi_Minh", providerCurrency: "VND", providerObservedAt: NOW },
                { workspaceId: ids.workspaceA, connectionId: connDM, accountId: `req-m-${suffix}`, providerTimezone: "Asia/Ho_Chi_Minh", providerCurrency: "VND", providerObservedAt: NOW },
            ],
        });
        await db.campaignMetric.createMany({
            data: WEEK_DAYS.flatMap((day) => ([
                {
                    workspaceId: ids.workspaceA, connectionId: connDG, platform: "google_ads",
                    accountId: `req-g-${suffix}`, level: "campaign", entityId: `e-reqg-${suffix}`,
                    campaignId: "req-camp-g", campaignName: "Req G Campaign",
                    date: new Date(`${day}T00:00:00.000Z`),
                    impressions: 1000, clicks: 100, spend: 1_000_000, conversions: 2, revenue: 4_000_000, currency: "VND",
                },
                {
                    workspaceId: ids.workspaceA, connectionId: connDM, platform: "meta_ads",
                    accountId: `req-m-${suffix}`, level: "ad", entityId: `e-reqm-${suffix}`,
                    campaignId: "req-camp-m", campaignName: "Req M Campaign",
                    date: new Date(`${day}T00:00:00.000Z`),
                    impressions: 500, clicks: 50, spend: 500_000, conversions: 1, revenue: 2_000_000, currency: "VND",
                },
            ])),
        });
        const seedReceiptFor = async () => {
            const dataset = await datasetOf(ids.workspaceA, clientD, WINDOW);
            return db!.destinationDeliveryReceipt.create({
                data: {
                    workspaceId: ids.workspaceA, clientId: clientD, destination: "google_sheets",
                    windowStart: WINDOW.start, windowEnd: WINDOW.end,
                    dataThroughDate: dataset.dataThroughDate ?? WINDOW.end,
                    datasetFingerprint: dataset.fingerprint, rowCount: dataset.rowCount,
                    actorId: ids.owner,
                },
            });
        };
        await seedReceiptFor();

        const params = { workspaceId: ids.workspaceA, clientId: clientD, windowStart: WINDOW.start, windowEnd: WINDOW.end, now: NOW };
        const generationKey = computeGenerationKey(ids.workspaceA, clientD, WINDOW, comparisonWindowFor(WINDOW));

        // Deterministic barrier: the holder takes the SAME advisory lock the
        // publication transaction takes as its FIRST statement, so generation
        // A parks before ANY evidence read (no stale snapshot while queued).
        const lockClient = new PrismaClient();
        await lockClient.$connect();
        let holderOpen = false;
        const barrier: { release: (() => void) | null } = { release: null };
        const holder = lockClient.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${generationKey}))`;
            holderOpen = true;
            await new Promise<void>((resolve) => { barrier.release = resolve; });
            return true;
        }, { timeout: 120_000 });
        await waitForCondition(() => holderOpen, "barrier holder open");

        const a = generateWeeklyBlueprint(params);
        const lockDb = db as PrismaClient;
        try {
            await waitForCondition(async () => (await countBlockedAdvisoryWaiters(lockDb, generationKey)) >= 1, "generation A blocked before evaluation", lockDb);
            // R2 commits while A is parked — strictly before A's evaluation
            // AND publication. The requirement row is not locked by anyone yet.
            await db.client.update({
                where: { workspaceId_id: { workspaceId: ids.workspaceA, id: clientD } },
                data: { requiredProviders: ["google_ads"], requirementsConfiguredAt: new Date() },
            });
        } finally {
            barrier.release?.();
        }
        const ra = await a;

        // A must NOT return a verified R1 snapshot: it evaluates and binds R2.
        const isVerifiedR1 = ra.snapshot.verificationStatus === "VERIFIED"
            && JSON.stringify(ra.report.overview.requiredProviders) === JSON.stringify(["google_ads", "meta_ads"]);
        assert.equal(isVerifiedR1, false, "no verified R1 snapshot may be returned after R2 committed");
        assert.deepEqual(ra.report.overview.requiredProviders, ["google_ads"]);
        const raStored = await db.reportSnapshot.findUniqueOrThrow({ where: { id: ra.snapshot.id } });
        const raState = (raStored.readinessEvidence as { dependencyState: { requirement: { requiredProviders: string[] } } }).dependencyState.requirement;
        assert.deepEqual(raState.requiredProviders, ["google_ads"], "exactly one requirement state is bound");
        // With R2 the receipt no longer matches the scoped fingerprint — honest NOT_VERIFIED.
        assert.equal(ra.snapshot.verificationStatus, "NOT_VERIFIED");

        await db.campaignMetric.deleteMany({ where: { entityId: { in: [`e-reqg-${suffix}`, `e-reqm-${suffix}`] } } });
        await db.destinationDeliveryReceipt.deleteMany({ where: { clientId: clientD } });
        await db.accountReportingContext.deleteMany({ where: { connectionId: { in: [connDG, connDM] } } });
        await db.connection.deleteMany({ where: { id: { in: [connDG, connDM] } } });
        await db.client.deleteMany({ where: { id: clientD } });
        await lockClient.$disconnect();
    });

    it("keeps TikTok campaign-grain rows authoritative and verifiable (F2)", async () => {
        if (!db) return;
        const clientT = `client-tt-${suffix}`;
        const connT = `conn-tt-${suffix}`;
        await db.client.create({
            data: {
                id: clientT, workspaceId: ids.workspaceA, name: "TikTok Client",
                requiredProviders: ["tiktok_business"], requiredDestinations: ["google_sheets"],
                requirementsConfiguredAt: new Date("2026-08-20T00:00:00.000Z"),
            },
        });
        await db.connection.create({
            data: {
                id: connT, workspaceId: ids.workspaceA, clientId: clientT, name: "TikTok",
                type: "source", provider: "tiktok_business", credentials: "enc:v1:test",
                remoteAccountId: `tt-${suffix}`, status: "connected", lastSyncAt: new Date(),
            },
        });
        await db.accountReportingContext.create({
            data: {
                workspaceId: ids.workspaceA, connectionId: connT, accountId: `tt-${suffix}`,
                providerTimezone: "Asia/Ho_Chi_Minh", providerCurrency: "VND", providerObservedAt: NOW,
            },
        });
        await db.campaignMetric.createMany({
            data: WEEK_DAYS.map((day) => ({
                workspaceId: ids.workspaceA, connectionId: connT, platform: "tiktok_business",
                accountId: `tt-${suffix}`, level: "campaign", entityId: `e-tt-${suffix}`,
                campaignId: "tt-campaign-1", campaignName: "TT Launch",
                date: new Date(`${day}T00:00:00.000Z`),
                impressions: 2000, clicks: 200, spend: 2_000_000, conversions: 5, revenue: 10_000_000, currency: "VND",
            })),
        });
        const dataset = await datasetOf(ids.workspaceA, clientT, WINDOW);
        await db.destinationDeliveryReceipt.create({
            data: {
                workspaceId: ids.workspaceA, clientId: clientT, destination: "google_sheets",
                windowStart: WINDOW.start, windowEnd: WINDOW.end,
                dataThroughDate: dataset.dataThroughDate ?? WINDOW.end,
                datasetFingerprint: dataset.fingerprint, rowCount: dataset.rowCount,
                actorId: ids.owner,
            },
        });
        const result = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA, clientId: clientT,
            windowStart: WINDOW.start, windowEnd: WINDOW.end, now: NOW,
        });
        // TikTok's authoritative grain is campaign: rows aggregate once.
        const tiktok = result.report.providers.find((provider) => provider.provider === "tiktok_business");
        assert.equal(tiktok?.metrics?.impressions, 14_000);
        assert.equal(tiktok?.metrics?.spend, 14_000_000);
        assert.equal(result.snapshot.verificationStatus, "VERIFIED");

        await db.campaignMetric.deleteMany({ where: { entityId: `e-tt-${suffix}` } });
        await db.destinationDeliveryReceipt.deleteMany({ where: { clientId: clientT } });
        await db.accountReportingContext.deleteMany({ where: { connectionId: connT } });
        await db.connection.deleteMany({ where: { id: connT } });
        await db.client.deleteMany({ where: { id: clientT } });
    });

    it("never combines or verifies marketplace rows for a Shopee requirement (F2)", async () => {
        if (!db) return;
        const clientS = `client-sh-${suffix}`;
        const connS = `conn-sh-${suffix}`;
        await db.client.create({
            data: {
                id: clientS, workspaceId: ids.workspaceA, name: "Shopee Client",
                requiredProviders: ["google_ads", "shopee"], requiredDestinations: ["google_sheets"],
                requirementsConfiguredAt: new Date("2026-08-20T00:00:00.000Z"),
            },
        });
        const connSG = `conn-shg-${suffix}`;
        await db.connection.createMany({
            data: [
                { id: connSG, workspaceId: ids.workspaceA, clientId: clientS, name: "Google S", type: "source", provider: "google_ads", credentials: "enc:v1:test", remoteAccountId: `shg-${suffix}`, status: "connected", lastSyncAt: new Date() },
                { id: connS, workspaceId: ids.workspaceA, clientId: clientS, name: "Shopee", type: "source", provider: "shopee", credentials: "enc:v1:test", remoteAccountId: `sh-${suffix}`, status: "connected", lastSyncAt: new Date() },
            ],
        });
        await db.accountReportingContext.createMany({
            data: [
                { workspaceId: ids.workspaceA, connectionId: connSG, accountId: `shg-${suffix}`, providerTimezone: "Asia/Ho_Chi_Minh", providerCurrency: "VND", providerObservedAt: NOW },
                { workspaceId: ids.workspaceA, connectionId: connS, accountId: `sh-${suffix}`, providerTimezone: "Asia/Ho_Chi_Minh", providerCurrency: "VND", providerObservedAt: NOW },
            ],
        });
        await db.campaignMetric.createMany({
            data: WEEK_DAYS.map((day) => ({
                workspaceId: ids.workspaceA, connectionId: connSG, platform: "google_ads",
                accountId: `shg-${suffix}`, level: "campaign", entityId: `e-shg-${suffix}`,
                campaignId: "sh-camp-g", campaignName: "SH Google Campaign",
                date: new Date(`${day}T00:00:00.000Z`),
                impressions: 1000, clicks: 100, spend: 1_000_000, conversions: 2, revenue: 4_000_000, currency: "VND",
            })),
        });
        // Both marketplace row kinds: Shopee paid-ad campaign rows AND the
        // daily order rollup. Neither may be aggregated into the blueprint.
        await db.campaignMetric.createMany({
            data: [
                ...WEEK_DAYS.map((day) => ({
                    workspaceId: ids.workspaceA, connectionId: connS, platform: "shopee",
                    accountId: `sh-${suffix}`, level: "campaign", entityId: `sh-ads-${suffix}`,
                    campaignId: "shopee-ads-camp", campaignName: "Shopee Ads",
                    date: new Date(`${day}T00:00:00.000Z`),
                    impressions: 3000, clicks: 300, spend: 3_000_000, conversions: 3, revenue: 9_000_000, currency: "VND",
                })),
                ...WEEK_DAYS.map((day) => ({
                    workspaceId: ids.workspaceA, connectionId: connS, platform: "shopee",
                    accountId: `sh-${suffix}`, level: "campaign", entityId: "shopee-orders-daily",
                    campaignId: "shopee-orders-daily", campaignName: "Shopee orders (daily rollup)",
                    date: new Date(`${day}T00:00:00.000Z`),
                    impressions: 0, clicks: 0, spend: 7_000_000, conversions: 7, revenue: 70_000_000, currency: "VND",
                })),
            ],
        });
        const result = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA, clientId: clientS,
            windowStart: WINDOW.start, windowEnd: WINDOW.end, now: NOW,
        });
        // Fail closed with an explicit unsupported_provider reason.
        assert.equal(result.snapshot.verificationStatus, "NOT_VERIFIED");
        assert.ok(result.snapshot.verificationReasons.includes("unsupported_provider:shopee"));
        // Shopee rows (ads AND rollups) are excluded from every aggregation.
        assert.equal(result.report.totals.impressions, 7000, "only the google campaign-grain rows");
        // ...but never SILENTLY omitted: shopee is listed explicitly as
        // out-of-scope with zero aggregated metrics.
        const shopee = result.report.providers.find((provider) => provider.provider === "shopee");
        assert.ok(shopee, "shopee must be visible as unsupported");
        assert.equal(shopee?.status, "unsupported");
        assert.equal(shopee?.metrics, null, "unsupported providers carry null metrics — never numeric zero");
        assert.match(shopee?.explanation ?? "", /Out of scope/);
        assert.ok(result.report.campaigns.every((campaign) => !campaign.campaignId.startsWith("shopee")));
        assert.equal(result.report.overview.verification.reasons.includes("unsupported_provider:shopee"), true);

        await db.campaignMetric.deleteMany({ where: { connectionId: { in: [connS, connSG] } } });
        await db.accountReportingContext.deleteMany({ where: { connectionId: { in: [connS, connSG] } } });
        await db.connection.deleteMany({ where: { id: { in: [connS, connSG] } } });
        await db.client.deleteMany({ where: { id: clientS } });
    });

    it("rejects half-specified windows when reopening (low-cost)", async () => {
        if (!db) return;
        await assert.rejects(
            reopenWeeklyBlueprint({
                workspaceId: ids.workspaceA,
                clientId: ids.clientA,
                windowStart: WINDOW.start,
                now: NOW,
            }),
            (error: unknown) => (error as { code?: string }).code === "window_boundary_incomplete",
        );
        await assert.rejects(
            reopenWeeklyBlueprint({
                workspaceId: ids.workspaceA,
                clientId: ids.clientA,
                windowEnd: WINDOW.end,
                now: NOW,
            }),
            (error: unknown) => (error as { code?: string }).code === "window_boundary_incomplete",
        );
    });

    it("derives Google manager-account evidence from rows: customer ID + real connection ID (P2-3)", async () => {
        if (!db) return;
        // Manager-account scenario: the connection's remoteAccountId is the
        // MCC manager, while the persisted metric rows carry the CUSTOMER
        // account id — exactly how Google Ads manager linkage stores rows.
        const ws = ids.workspaceB;
        const clientM = `client-mcc-${suffix}`;
        const connM = `conn-mcc-${suffix}`;
        await db.client.create({
            data: {
                id: clientM, workspaceId: ws, name: "MCC Client",
                requiredProviders: ["google_ads"], requiredDestinations: ["google_sheets"],
                requirementsConfiguredAt: new Date("2026-08-20T00:00:00.000Z"),
            },
        });
        await db.connection.create({
            data: {
                id: connM, workspaceId: ws, clientId: clientM, name: "MCC Manager",
                type: "source", provider: "google_ads", credentials: "enc:v1:test",
                remoteAccountId: "manager-999-999-9999", // manager, NOT the customer
                status: "connected", lastSyncAt: new Date(),
            },
        });
        await db.accountReportingContext.create({
            data: {
                workspaceId: ws, connectionId: connM, accountId: "customer-123-4567",
                providerTimezone: "UTC", providerCurrency: "USD", providerObservedAt: NOW,
            },
        });
        await db.campaignMetric.createMany({
            data: WEEK_DAYS.map((day) => ({
                workspaceId: ws, connectionId: connM, platform: "google_ads",
                accountId: "customer-123-4567", level: "campaign", entityId: `e-mcc-${suffix}`,
                campaignId: "mcc-campaign", campaignName: "MCC Campaign",
                date: new Date(`${day}T00:00:00.000Z`),
                impressions: 400, clicks: 40, spend: 10, conversions: 1, revenue: 30, currency: "USD",
            })),
        });
        await db.destinationDeliveryReceipt.deleteMany({ where: { clientId: clientM } });
        const dataset = await datasetOf(ws, clientM, WINDOW);
        await db.destinationDeliveryReceipt.create({
            data: {
                workspaceId: ws, clientId: clientM, destination: "google_sheets",
                windowStart: WINDOW.start, windowEnd: WINDOW.end,
                dataThroughDate: dataset.dataThroughDate ?? WINDOW.end,
                datasetFingerprint: dataset.fingerprint, rowCount: dataset.rowCount,
                actorId: ids.owner,
            },
        });
        const result = await generateWeeklyBlueprint({
            workspaceId: ws, clientId: clientM,
            windowStart: WINDOW.start, windowEnd: WINDOW.end, now: NOW,
        });
        const accounts = result.report.overview.includedAccounts
            .filter((account) => account.provider === "google_ads");
        assert.deepEqual(accounts.map((account) => account.accountId), ["customer-123-4567"], "customer id from the metric rows");
        assert.deepEqual(accounts.map((account) => account.connectionId), [connM], "the REAL connection id, not a remoteAccountId match");
        assert.equal(result.snapshot.verificationStatus, "VERIFIED");
    });

    it("derives included accounts from metric evidence, not connection labels (P2-3)", async () => {
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
        // Metric rows carry accountId "g-account-1"; the connection label is
        // remoteAccountId — the report must show the metric evidence id.
        const googleAccounts = result.report.overview.includedAccounts
            .filter((account) => account.provider === "google_ads")
            .map((account) => account.accountId);
        assert.deepEqual(googleAccounts, ["g-account-1"]);
        const stored = await db.reportSnapshot.findUniqueOrThrow({ where: { id: result.snapshot.id } });
        assert.ok(stored.includedAccountIds.includes("g-account-1"));
    });

    it("keeps a renamed campaign as one campaign row across the window (P2-4)", async () => {
        if (!db) return;
        await db.destinationDeliveryReceipt.deleteMany({
            where: { workspaceId: ids.workspaceA, clientId: ids.clientA, windowStart: WINDOW.start, windowEnd: WINDOW.end },
        });
        await seedCurrentReceipt();
        // Rename the campaign on the LATEST date only: the stable identity
        // must keep one row and display the latest name.
        await db.campaignMetric.updateMany({
            where: { entityId: `e-g-${suffix}`, date: new Date("2026-08-30T00:00:00.000Z") },
            data: { campaignName: "Always On (renamed)", pulledAt: new Date() },
        });
        await seedCurrentReceipt();
        const result = await generateWeeklyBlueprint({
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            windowStart: WINDOW.start,
            windowEnd: WINDOW.end,
            now: NOW,
        });
        const google = result.report.campaigns.filter((campaign) => campaign.campaignId === "1795849302486751234");
        assert.equal(google.length, 1, "a renamed campaign must not split into two rows");
        assert.equal(google[0].campaignName, "Always On (renamed)");
    });

    it("rejects impossible calendar dates and half-specified windows (low-cost)", async () => {
        if (!db) return;
        await assert.rejects(
            generateWeeklyBlueprint({
                workspaceId: ids.workspaceA,
                clientId: ids.clientA,
                windowStart: "2026-02-31", // Date.parse rolls this to March
                windowEnd: "2026-03-06",
                now: NOW,
            }),
            (error: unknown) => error instanceof Error && /YYYY-MM-DD|7 days/.test(error.message),
        );
        await assert.rejects(
            generateWeeklyBlueprint({
                workspaceId: ids.workspaceA,
                clientId: ids.clientA,
                windowStart: WINDOW.start, // one boundary only
                now: NOW,
            }),
            (error: unknown) => (error as { code?: string }).code === "window_boundary_incomplete",
        );
        await assert.rejects(
            generateWeeklyBlueprint({
                workspaceId: ids.workspaceA,
                clientId: ids.clientA,
                windowEnd: WINDOW.end, // the other boundary only
                now: NOW,
            }),
            (error: unknown) => (error as { code?: string }).code === "window_boundary_incomplete",
        );
    });

    it("rejects caller-forged verification through the pure gate set (17)", () => {
        const forged = computeVerificationStatus({
            readinessStatus: "NOT_READY",
            requiredProvidersBasis: "assigned_sources",
            requiredProviders: [],
            includedProviders: [],
            hasMetricData: false,
            aggregationCompatible: false,
            grainUnsupportedProviders: [],
            unsupportedProviders: [],
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
        assert.equal(METRIC_CONTRACT_VERSION, "weekly-blueprint-metrics-v3");
    });
});
