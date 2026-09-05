import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    aggregateBlueprintMetrics,
    BLUEPRINT_ID,
    BLUEPRINT_VERSION,
    buildCampaignTable,
    canonicalJson,
    comparisonWindowFor,
    computeDependencyHash,
    computeMetricsDeltas,
    computeVerificationStatus,
    daysBetween,
    defaultBlueprintWindow,
    isValidDateString,
    formatBlueprintMetric,
    lastCompleteWeek,
    METRIC_CONTRACT_VERSION,
    resolveExplicitWindow,
    safeRatio,
    sha256Hex,
    windowIsComplete,
    type DependencyState,
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
        date: new Date("2026-08-25T00:00:00.000Z"),
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
        requiredProvidersBasis: "explicit",
        requiredProviders: ["google_ads"],
        includedProviders: ["google_ads"],
        hasMetricData: true,
        aggregationCompatible: true,
        grainUnsupportedProviders: [],
        currencyVerified: true,
        windowComplete: true,
        timezoneVerified: true,
        destinationsRequired: ["google_sheets"],
        destinationsVerified: true,
        datasetLimited: false,
        generatorVersionRecorded: true,
        dependencyHashMatches: true,
        ...overrides,
    };
}

function dependencyState(overrides: Partial<DependencyState> = {}): DependencyState {
    return {
        requirement: {
            requiredProviders: ["google_ads"],
            requiredDestinations: ["google_sheets"],
            requirementsConfiguredAt: "2026-08-20T00:00:00.000Z",
        },
        datasetFingerprint: "fp-1",
        evidenceAt: "2026-08-31T00:00:00.000Z",
        dataThroughDate: "2026-08-30",
        rowCount: 7,
        comparisonDatasetFingerprint: "fp-0",
        comparisonEvidenceAt: "2026-08-24T00:00:00.000Z",
        comparisonDataThroughDate: "2026-08-23",
        comparisonRowCount: 7,
        receipts: [{
            id: "r-1",
            destination: "google_sheets",
            retrievedAt: "2026-08-31T01:00:00.000Z",
            dataThroughDate: "2026-08-30",
            current: true,
        }],
        contractVersions: { metrics: METRIC_CONTRACT_VERSION, dataset: "reporting-dataset-v1" },
        ...overrides,
    };
}

describe("report blueprint: windows", () => {
    it("computes the last complete Monday–Sunday week in UTC (1)", () => {
        const week = lastCompleteWeek(new Date("2026-09-02T16:30:00.000Z"));
        assert.deepEqual(week, { start: "2026-08-24", end: "2026-08-30" });
        assert.equal(daysBetween(week.start, week.end), 6);
    });

    it("keeps Sunday-evening input inside the current (incomplete) week", () => {
        const week = lastCompleteWeek(new Date("2026-08-30T16:00:00.000Z"));
        assert.equal(week.end, "2026-08-23");
    });

    it("exposes PR #152's shared default window unchanged", () => {
        const shared = defaultBlueprintWindow(new Date("2026-09-02T16:30:00.000Z"));
        assert.deepEqual(shared, { start: "2026-08-26", end: "2026-09-01" });
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

    it("marks an unfinished window incomplete", () => {
        const window = { start: "2026-08-24", end: "2026-08-30" };
        assert.equal(windowIsComplete(window, new Date("2026-08-31T00:00:00.000Z")), true);
        assert.equal(windowIsComplete(window, new Date("2026-08-30T12:00:00.000Z")), false);
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

    it("renders zero denominators as unavailable, never zero", () => {
        const metrics = aggregateBlueprintMetrics([row({ impressions: 0, clicks: 0, conversions: 0, revenue: 0, spend: 25 })]);
        assert.equal(metrics.ctr, null);
        assert.equal(metrics.cpc, null);
        assert.equal(metrics.cpa, null);
        // Zero numerator with a real denominator is an honest 0, not unavailable.
        assert.equal(metrics.roas, 0);
        assert.equal(formatBlueprintMetric(metrics.cpc, "USD", "money"), "—");
        assert.equal(safeRatio(10, 0), null);
    });

    it("never sums monetary totals across currencies (15)", () => {
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

    it("preserves provider and campaign IDs as exact strings (16)", () => {
        const bigId = "123456789012345678901234";
        const table = buildCampaignTable([row({ campaignId: bigId, accountId: "998877665544332211" })], []);
        assert.equal(table.campaigns[0].campaignId, bigId);
        assert.equal(table.campaigns[0].accountId, "998877665544332211");
        assert.equal(typeof table.campaigns[0].campaignId, "string");
    });

    it("orders campaigns deterministically across repeated builds", () => {
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
    it("produces VERIFIED only when every gate passes", () => {
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

    it("blocks verification when requirements are inferred rather than configured (3)", () => {
        const result = computeVerificationStatus(verificationInput({ requiredProvidersBasis: "assigned_sources" }));
        assert.equal(result.status, "NOT_VERIFIED");
        assert.ok(result.reasons.includes("required_providers_inferred"));
    });

    it("blocks verification on unverified timezone or currency context (7)", () => {
        const result = computeVerificationStatus(verificationInput({
            timezoneVerified: false,
            currencyVerified: false,
        }));
        assert.equal(result.status, "NOT_VERIFIED");
        assert.ok(result.reasons.includes("reporting_timezone_unverified"));
        assert.ok(result.reasons.includes("currency_unverified"));
    });

    it("blocks verification when delivery evidence is missing or not required-configured", () => {
        const missing = computeVerificationStatus(verificationInput({ destinationsVerified: false }));
        assert.equal(missing.status, "NOT_VERIFIED");
        assert.ok(missing.reasons.includes("destination_evidence_missing"));

        const unconfigured = computeVerificationStatus(verificationInput({ destinationsRequired: [] }));
        assert.equal(unconfigured.status, "NOT_VERIFIED");
        assert.ok(unconfigured.reasons.includes("destination_requirements_missing"));
    });

    it("blocks verification on limited evidence or an unrecorded generator version", () => {
        const result = computeVerificationStatus(verificationInput({
            datasetLimited: true,
            generatorVersionRecorded: false,
        }));
        assert.equal(result.status, "NOT_VERIFIED");
        assert.ok(result.reasons.includes("evidence_limit_reached"));
        assert.ok(result.reasons.includes("generator_version_unrecorded"));
    });

    it("blocks verification when dependency evidence changed", () => {
        const result = computeVerificationStatus(verificationInput({ dependencyHashMatches: false }));
        assert.equal(result.status, "NOT_VERIFIED");
        assert.ok(result.reasons.includes("dependency_evidence_changed"));
    });

    it("rejects caller-forged verification because the label is purely derived (17)", () => {
        // There is no input that can inject a verification label; a report
        // claiming VERIFIED must satisfy every gate. A fully failing input
        // cannot be talked into VERIFIED.
        const forged = computeVerificationStatus(verificationInput({
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
        }));
        assert.equal(forged.status, "NOT_VERIFIED");
        assert.ok(forged.reasons.length >= 11);
    });
});

describe("report blueprint: dependency hashing / staleness", () => {
    it("produces a stable canonical hash for identical dependency states", () => {
        const base = dependencyState();
        const reordered = {
            contractVersions: base.contractVersions,
            receipts: base.receipts,
            comparisonRowCount: base.comparisonRowCount,
            comparisonDataThroughDate: base.comparisonDataThroughDate,
            comparisonEvidenceAt: base.comparisonEvidenceAt,
            comparisonDatasetFingerprint: base.comparisonDatasetFingerprint,
            rowCount: base.rowCount,
            dataThroughDate: base.dataThroughDate,
            evidenceAt: base.evidenceAt,
            datasetFingerprint: base.datasetFingerprint,
            requirement: base.requirement,
        };
        assert.equal(canonicalJson(base), canonicalJson(reordered));
        assert.equal(computeDependencyHash(base), computeDependencyHash(reordered));
        assert.equal(computeDependencyHash(base), sha256Hex(canonicalJson(base)));
    });

    it("changes the hash when data, requirements or receipts change", () => {
        const base = computeDependencyHash(dependencyState());
        assert.notEqual(
            computeDependencyHash(dependencyState({ datasetFingerprint: "fp-2" })),
            base,
            "dataset change must invalidate",
        );
        assert.notEqual(
            computeDependencyHash(dependencyState({
                requirement: {
                    requiredProviders: ["google_ads", "meta_ads"],
                    requiredDestinations: ["google_sheets"],
                    requirementsConfiguredAt: "2026-08-20T00:00:00.000Z",
                },
            })),
            base,
            "requirement change must invalidate",
        );
        assert.notEqual(
            computeDependencyHash(dependencyState({
                receipts: [{ ...dependencyState().receipts[0], current: false }],
            })),
            base,
            "receipt currentness change must invalidate",
        );
        assert.notEqual(
            computeDependencyHash(dependencyState({ receipts: [] })),
            base,
            "receipt replacement/removal must invalidate",
        );
    });

    it("binds receipt identity and currentness so expiry or replacement goes stale (12)", () => {
        const base = dependencyState();
        const expired = dependencyState({
            receipts: [{ ...base.receipts[0], retrievedAt: "2026-08-31T00:30:00.000Z", current: false }],
        });
        assert.notEqual(computeDependencyHash(expired), computeDependencyHash(base));
    });
});

describe("report blueprint: grain, identity and date boundaries", () => {
    it("fails verification closed when a provider's grain is unsupported", () => {
        const result = computeVerificationStatus(verificationInput({ grainUnsupportedProviders: ["google_ads"] }));
        assert.equal(result.status, "NOT_VERIFIED");
        assert.ok(result.reasons.includes("aggregation_grain_unsupported:google_ads"));
    });

    it("keeps a renamed campaign as ONE identity row (stable key, latest name)", () => {
        const before = row({ date: new Date("2026-08-24T00:00:00.000Z"), campaignName: "Old Name" });
        const after = row({ date: new Date("2026-08-25T00:00:00.000Z"), campaignName: "New Name" });
        const table = buildCampaignTable([before, after], []);
        assert.equal(table.campaigns.length, 1);
        assert.equal(table.campaigns[0].campaignName, "New Name");
        assert.equal(table.campaigns[0].campaignId, "c-1");
        // Aggregation sums both rows exactly once (no double counting).
        assert.equal(table.campaigns[0].impressions, 2000);
    });

    it("rejects impossible calendar dates (2026-02-31)", () => {
        assert.throws(() => resolveExplicitWindow("2026-02-31", "2026-03-06"));
        assert.throws(() => resolveExplicitWindow("2026-02-30", "2026-03-06"));
        assert.equal(isValidDateString("2026-02-28"), true);
        assert.equal(isValidDateString("2026-02-31"), false);
    });
});

describe("report blueprint: constants and contracts", () => {
    it("binds the blueprint identity, version and metric contract", () => {
        assert.equal(BLUEPRINT_ID, "weekly-paid-media-performance");
        assert.equal(BLUEPRINT_VERSION, 1);
        assert.equal(METRIC_CONTRACT_VERSION, "weekly-blueprint-metrics-v3");
    });
});
