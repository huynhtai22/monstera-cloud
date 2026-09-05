import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    aggregateBlueprintMetrics,
    BLUEPRINT_ID,
    BLUEPRINT_VERSION,
    buildCampaignTable,
    canonicalJson,
    computeDependencyHash,
    computeVerificationStatus,
    comparisonWindowFor,
    computeMetricsDeltas,
    daysBetween,
    formatBlueprintMetric,
    lastCompleteWeek,
    mapReadinessStatus,
    METRIC_CONTRACT_VERSION,
    resolveExplicitWindow,
    safeRatio,
    sha256Hex,
    SUPPORTED_PROVIDERS,
    windowIsComplete,
    windowToDateRange,
    type MetricRowInput,
    type VerificationInput,
} from "./report-blueprint";

function row(overrides: Partial<MetricRowInput> = {}): MetricRowInput {
    return {
        platform: "google_ads",
        connectionId: "conn-1",
        accountId: "acc-1",
        accountName: "Account 1",
        campaignId: "c-1",
        campaignName: "Campaign 1",
        entityId: "e-1",
        level: "campaign",
        impressions: 1000,
        clicks: 100,
        spend: 50,
        conversions: 5,
        revenue: 250,
        currency: "USD",
        ...overrides,
    };
}

function verificationInput(overrides: Partial<VerificationInput> = {}): VerificationInput {
    return {
        readinessStatus: "READY",
        requiredProviders: ["google_ads"],
        includedProviders: ["google_ads"],
        coverageComplete: true,
        timezoneConfigured: true,
        currencyVerified: true,
        windowComplete: true,
        hasMetricData: true,
        aggregationCompatible: true,
        destinationSatisfied: true,
        dependencyHashMatches: true,
        ...overrides,
    };
}

describe("report blueprint: windows", () => {
    it("computes last complete Monday–Sunday week in the reporting timezone (1)", () => {
        // Wed 2026-09-02 23:30 in Asia/Ho_Chi_Minh (+07) → last complete week
        // Mon 2026-08-24 .. Sun 2026-08-30 in that timezone.
        const now = new Date("2026-09-02T16:30:00.000Z");
        const week = lastCompleteWeek("Asia/Ho_Chi_Minh", now);
        assert.equal(week.start, "2026-08-24");
        assert.equal(week.end, "2026-08-30");
        assert.equal(daysBetween(week.start, week.end), 6);
    });

    it("last complete week respects the timezone day boundary (1)", () => {
        // Sun 2026-08-30 23:00 in Ho_Chi_Minh is still Sunday locally → the
        // last complete week ends the PREVIOUS Sunday (2026-08-23).
        const utcSundayEvening = new Date("2026-08-30T16:00:00.000Z");
        const week = lastCompleteWeek("Asia/Ho_Chi_Minh", utcSundayEvening);
        assert.equal(week.end, "2026-08-23");
        // Same instant in UTC: still Sunday 2026-08-30, week ends 2026-08-23 too
        // (UTC Sunday) — different day START though.
        const utcWeek = lastCompleteWeek("UTC", utcSundayEvening);
        assert.equal(utcWeek.start, "2026-08-17");
        assert.equal(utcWeek.end, "2026-08-23");
    });

    it("preserves an explicit window exactly and requires 7 days (2)", () => {
        const window = resolveExplicitWindow("2026-08-24", "2026-08-30");
        assert.deepEqual(window, { start: "2026-08-24", end: "2026-08-30" });
        assert.throws(() => resolveExplicitWindow("2026-08-24", "2026-08-29"));
        assert.throws(() => resolveExplicitWindow("2026-08-24", "2026-08-31"));
        assert.throws(() => resolveExplicitWindow("not-a-date", "2026-08-30"));
    });

    it("derives the comparison window as the preceding 7 days", () => {
        const comparison = comparisonWindowFor({ start: "2026-08-24", end: "2026-08-30" });
        assert.deepEqual(comparison, { start: "2026-08-17", end: "2026-08-23" });
    });

    it("marks an unfinished window incomplete in its reporting timezone", () => {
        const window = { start: "2026-08-24", end: "2026-08-30" };
        assert.equal(windowIsComplete(window, "UTC", new Date("2026-08-31T00:00:00.000Z")), true);
        assert.equal(windowIsComplete(window, "UTC", new Date("2026-08-30T12:00:00.000Z")), false);
        assert.equal(
            windowIsComplete(window, "Asia/Ho_Chi_Minh", new Date("2026-08-30T17:30:00.000Z")),
            true,
        );
    });

    it("maps window day bounds through the reporting timezone", () => {
        const range = windowToDateRange(
            { start: "2026-08-24", end: "2026-08-30" },
            "Asia/Ho_Chi_Minh",
        );
        assert.equal(range.gte.toISOString(), "2026-08-23T17:00:00.000Z");
        assert.equal(range.lte.toISOString(), "2026-08-29T17:00:00.000Z");
    });
});

describe("report blueprint: aggregation", () => {
    it("derives metrics with explicit safe formulas", () => {
        const metrics = aggregateBlueprintMetrics([row()]);
        assert.equal(metrics.currency, "USD");
        assert.equal(metrics.spend, 50);
        assert.equal(metrics.ctr, 0.1);
        assert.equal(metrics.cpc, 0.5);
        assert.equal(metrics.cpa, 10);
        assert.equal(metrics.roas, 5);
    });

    it("renders zero denominators as unavailable, never zero (8)", () => {
        const metrics = aggregateBlueprintMetrics([row({ impressions: 0, clicks: 0, conversions: 0, revenue: 0, spend: 25 })]);
        assert.equal(metrics.ctr, null);
        assert.equal(metrics.cpc, null);
        assert.equal(metrics.cpa, null);
        // Zero numerator with a real denominator is an honest 0, not unavailable.
        assert.equal(metrics.roas, 0);
        assert.equal(formatBlueprintMetric(metrics.cpc, "USD", "money"), "—");
        assert.equal(safeRatio(10, 0), null);
    });

    it("never sums monetary totals across currencies (6)", () => {
        const metrics = aggregateBlueprintMetrics([
            row({ currency: "USD", spend: 100, revenue: 300 }),
            row({ currency: "VND", spend: 1_000_000, revenue: 2_000_000, campaignId: "c-2" }),
        ]);
        assert.equal(metrics.monetaryAvailable, false);
        assert.equal(metrics.currency, null);
        assert.equal(metrics.spend, null);
        assert.equal(metrics.conversionValue, null);
        assert.deepEqual(metrics.currencies, ["USD", "VND"]);
        // Non-monetary counts may still combine.
        assert.equal(metrics.clicks, 200);
        assert.equal(metrics.impressions, 2000);
    });

    it("treats missing currency as unknown and blocks monetary totals", () => {
        const metrics = aggregateBlueprintMetrics([row({ currency: null })]);
        assert.equal(metrics.monetaryAvailable, false);
        assert.deepEqual(metrics.currencies, ["UNKNOWN"]);
    });

    it("represents Google, Meta and TikTok normalized data independently (4)", () => {
        const rows = [
            row({ platform: "google_ads", campaignId: "g-1", currency: "USD" }),
            row({ platform: "meta_ads", campaignId: "m-1", currency: "USD" }),
            row({ platform: "tiktok_business", campaignId: "t-1", currency: "USD" }),
        ];
        const table = buildCampaignTable(rows, []);
        assert.deepEqual(
            table.campaigns.map((campaign) => campaign.provider),
            ["google_ads", "meta_ads", "tiktok_business"],
        );
    });

    it("preserves provider and campaign IDs as exact strings (9)", () => {
        const bigId = "123456789012345678901234";
        const table = buildCampaignTable([row({ campaignId: bigId, accountId: "998877665544332211" })], []);
        assert.equal(table.campaigns[0].campaignId, bigId);
        assert.equal(table.campaigns[0].accountId, "998877665544332211");
        assert.equal(typeof table.campaigns[0].campaignId, "string");
    });

    it("orders campaigns deterministically across repeated builds (10)", () => {
        const rows = [
            row({ campaignId: "z-1", campaignName: "Zeta", platform: "meta_ads" }),
            row({ campaignId: "a-9", campaignName: "Alpha", platform: "google_ads" }),
            row({ campaignId: "a-1", campaignName: "Alpha", platform: "google_ads" }),
        ];
        const first = buildCampaignTable(rows, []);
        const second = buildCampaignTable([...rows].reverse(), []);
        assert.deepEqual(
            first.campaigns.map((c) => `${c.provider}:${c.campaignId}`),
            second.campaigns.map((c) => `${c.provider}:${c.campaignId}`),
        );
        assert.deepEqual(
            first.campaigns.map((c) => c.campaignId),
            ["a-1", "a-9", "z-1"],
        );
    });

    it("computes week-over-week deltas only when currency-comparable", () => {
        const current = aggregateBlueprintMetrics([row({ spend: 120, revenue: 240 })]);
        const previous = aggregateBlueprintMetrics([row({ spend: 100, revenue: 200 })]);
        const deltas = computeMetricsDeltas(current, previous);
        const spendDelta = deltas.find((delta) => delta.field === "spend");
        assert.equal(spendDelta?.deltaPercent, 20);

        // Mixed currency in one window → deltas unavailable
        const mixed = aggregateBlueprintMetrics([row({ currency: "VND" }), row({ currency: "USD" })]);
        const mixedDeltas = computeMetricsDeltas(mixed, previous);
        assert.ok(mixedDeltas.every((delta) => delta.deltaPercent === null));
    });
});

describe("report blueprint: verification semantics", () => {
    it("maps shared readiness statuses onto the blueprint vocabulary", () => {
        assert.equal(mapReadinessStatus("ready"), "READY");
        assert.equal(mapReadinessStatus("best_effort"), "WARNING");
        assert.equal(mapReadinessStatus("blocked"), "NOT_READY");
    });

    it("produces VERIFIED only when every gate passes (13)", () => {
        const result = computeVerificationStatus(verificationInput());
        assert.equal(result.status, "VERIFIED");
        assert.deepEqual(result.reasons, []);
    });

    it("never produces VERIFIED from WARNING, NOT_READY or UNKNOWN (14)", () => {
        for (const readinessStatus of ["WARNING", "NOT_READY", "UNKNOWN"] as const) {
            const result = computeVerificationStatus(verificationInput({ readinessStatus }));
            assert.equal(result.status, "NOT_VERIFIED");
            assert.ok(result.reasons.includes(`readiness_not_ready:${readinessStatus}`));
        }
    });

    it("blocks verification when a required provider is missing (5)", () => {
        const result = computeVerificationStatus(verificationInput({
            requiredProviders: ["google_ads", "meta_ads", "tiktok_business"],
            includedProviders: ["google_ads", "meta_ads"],
        }));
        assert.equal(result.status, "NOT_VERIFIED");
        assert.ok(result.reasons.includes("required_providers_missing:tiktok_business"));
    });

    it("blocks verification on unverified timezone, currency, coverage and destination (7)", () => {
        const result = computeVerificationStatus(verificationInput({
            timezoneConfigured: false,
            currencyVerified: false,
            coverageComplete: false,
            destinationSatisfied: false,
            aggregationCompatible: false,
        }));
        assert.equal(result.status, "NOT_VERIFIED");
        for (const reason of [
            "reporting_timezone_unverified",
            "currency_unverified",
            "account_coverage_incomplete",
            "destination_evidence_missing",
            "incompatible_metric_semantics",
        ]) {
            assert.ok(result.reasons.includes(reason));
        }
    });

    it("blocks verification when dependency evidence changed (15, part)", () => {
        const result = computeVerificationStatus(verificationInput({ dependencyHashMatches: false }));
        assert.equal(result.status, "NOT_VERIFIED");
        assert.ok(result.reasons.includes("dependency_evidence_changed"));
    });
});

describe("report blueprint: dependency hashing / staleness", () => {
    it("produces a stable canonical hash for identical dependency states (17, pure part)", () => {
        const state = {
            requirement: { configVersion: 1, requiredProviders: ["google_ads"], requireDestination: false, reportingTimezone: "Asia/Ho_Chi_Minh", reportingCurrency: null },
            requirementUpdatedAt: "2026-08-31T00:00:00.000Z",
            accounts: [{ connectionId: "a", provider: "google_ads", accountId: "1", status: "connected" }],
            dataThrough: { a: "2026-08-30T00:00:00.000Z" },
            currencySet: ["USD"],
            readinessBlockers: [],
            destination: null,
            contractVersions: { metrics: METRIC_CONTRACT_VERSION },
        };
        const reordered = {
            contractVersions: { metrics: METRIC_CONTRACT_VERSION },
            destination: null,
            readinessBlockers: [],
            currencySet: ["USD"],
            dataThrough: { a: "2026-08-30T00:00:00.000Z" },
            accounts: [{ status: "connected", accountId: "1", provider: "google_ads", connectionId: "a" }],
            requirement: { requiredProviders: ["google_ads"], configVersion: 1, requireDestination: false, reportingTimezone: "Asia/Ho_Chi_Minh", reportingCurrency: null },
            requirementUpdatedAt: "2026-08-31T00:00:00.000Z",
        };
        assert.equal(canonicalJson(state), canonicalJson(reordered));
        assert.equal(computeDependencyHash(state), computeDependencyHash(reordered));
        assert.equal(computeDependencyHash(state), sha256Hex(canonicalJson(state)));
    });

    it("changes the hash when underlying data or requirements change (15)", () => {
        const base = {
            requirement: { configVersion: 1, requiredProviders: ["google_ads"], requireDestination: false, reportingTimezone: "Asia/Ho_Chi_Minh", reportingCurrency: null },
            requirementUpdatedAt: "2026-08-31T00:00:00.000Z",
            dataThrough: { a: "2026-08-30T00:00:00.000Z" },
            currencySet: ["USD"],
            accounts: [],
            readinessBlockers: [],
            destination: null,
            contractVersions: { metrics: METRIC_CONTRACT_VERSION },
        };
        const dataAdvanced = {
            ...base,
            dataThrough: { a: "2026-08-31T00:00:00.000Z" },
        };
        const requirementChanged = {
            ...base,
            requirement: { configVersion: 2, requiredProviders: ["google_ads", "meta_ads"], requireDestination: false, reportingTimezone: "Asia/Ho_Chi_Minh", reportingCurrency: null },
            requirementUpdatedAt: "2026-09-01T00:00:00.000Z",
        };
        const original = computeDependencyHash(base);
        assert.notEqual(computeDependencyHash(dataAdvanced), original);
        assert.notEqual(computeDependencyHash(requirementChanged), original);
    });
});

describe("report blueprint: constants and contracts", () => {
    it("binds the blueprint identity, version and metric contract (3, part)", () => {
        assert.equal(BLUEPRINT_ID, "weekly-paid-media-performance");
        assert.equal(BLUEPRINT_VERSION, 1);
        assert.equal(METRIC_CONTRACT_VERSION, "weekly-blueprint-metrics-v1");
        assert.deepEqual([...SUPPORTED_PROVIDERS], ["google_ads", "meta_ads", "tiktok_business"]);
    });
});
