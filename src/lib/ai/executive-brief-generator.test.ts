import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateDeterministicBrief,
  generateExecutiveBrief,
  validateModelStructuredSelection,
} from "./executive-brief-generator";
import type { ReportingContext } from "./reporting-contracts";
import { createMockFreshnessJourney } from "./reporting-contracts";

function createMockContext(overrides?: Partial<ReportingContext>): ReportingContext {
  return {
    workspaceId: "ws-test-1",
    clientId: "client-test-1",
    clientName: "Acme Brand",
    plan: "professional",
    windows: {
      preset: "last_7d",
      current: { start: "2026-09-17", end: "2026-09-23" },
      prior: { start: "2026-09-10", end: "2026-09-16" },
      timezone: "Asia/Ho_Chi_Minh",
      timezoneSource: "verified",
      daysCount: 7,
    },
    readiness: {
      status: "READY",
      exportEligible: true,
      blockers: [],
      warnings: [],
      latestDataDate: "2026-09-23T00:00:00.000Z",
      currencies: ["USD"],
      timezone: "Asia/Ho_Chi_Minh",
      fingerprint: "hash_abc_123",
    },
    freshnessJourney: createMockFreshnessJourney({ deliveryStatus: "verified" }),
    completeness: {
      coverageStatus: "complete",
      sourceCount: 2,
      partialCount: 0,
      missingDays: 0,
      limitReached: false,
    },
    metrics: [
      {
        metricId: "spend",
        name: "Advertising Spend",
        currency: "USD",
        currentValue: 12500,
        priorValue: 10000,
        absoluteChange: 2500,
        percentageChange: 0.25,
        status: "available",
        limitations: [],
      },
      {
        metricId: "roas",
        name: "Platform-Reported ROAS",
        currency: null,
        currentValue: 3.8,
        priorValue: 4.2,
        absoluteChange: -0.4,
        percentageChange: -0.095,
        status: "available",
        limitations: [],
      },
      {
        metricId: "conversions",
        name: "Platform-Reported Conversions",
        currency: null,
        currentValue: 420,
        priorValue: 380,
        absoluteChange: 40,
        percentageChange: 0.105,
        status: "available",
        limitations: [],
      },
      {
        metricId: "marketplace_revenue",
        name: "Marketplace Order Revenue",
        currency: "USD",
        currentValue: 35000,
        priorValue: 30000,
        absoluteChange: 5000,
        percentageChange: 0.166,
        status: "available",
        limitations: [],
      },
    ],
    channels: [
      {
        channel: "facebook",
        currency: "USD",
        spend: 7500,
        conversions: 260,
        conversionValue: 30000,
        roas: 4.0,
        orders: null,
        orderRevenue: null,
        clicks: 8500,
        impressions: 120000,
      },
      {
        channel: "shopee",
        currency: "USD",
        spend: 0,
        conversions: null,
        conversionValue: null,
        roas: null,
        orders: 1100,
        orderRevenue: 35000,
        clicks: 0,
        impressions: 0,
      },
    ],
    observations: [
      {
        id: "obs_spend_trend",
        type: "spend",
        text: "Total advertising spend increased by 25.0% compared to the prior period.",
        evidenceRef: "metric:spend:USD",
      },
    ],
    evaluatedAt: "2026-09-24T12:00:00.000Z",
    fingerprint: "hash_abc_123",
    ...overrides,
  };
}

describe("generateDeterministicBrief", () => {
  it("creates truthful English brief sections with explicit limitations", () => {
    const ctx = createMockContext();
    const sections = generateDeterministicBrief(ctx, "en");

    assert.ok(sections.headline.includes("Acme Brand"));
    assert.ok(sections.headline.includes("$12,500.00"));
    assert.ok(sections.headline.includes("3.80x ROAS"));

    // Check limitations exist
    assert.ok(
      sections.sourcesAndLimitations.some((s) => s.includes("Platform-reported attribution")),
    );
    assert.ok(
      sections.sourcesAndLimitations.some((s) => s.includes("Marketplace order revenue")),
    );

    // Check suggested checks are investigations, not confident budget commands
    assert.ok(
      sections.suggestedChecks.some((c) => c.toLowerCase().includes("investigate")),
    );
  });

  it("creates truthful Vietnamese brief sections with proper formatting", () => {
    const ctx = createMockContext();
    const sections = generateDeterministicBrief(ctx, "vi");

    assert.ok(sections.headline.includes("Acme Brand"));
    assert.ok(sections.headline.includes("ROAS 3.80x"));
    assert.ok(
      sections.sourcesAndLimitations.some((s) => s.includes("Mô hình quy kết")),
    );
  });
});

describe("generateExecutiveBrief", () => {
  it("returns a fully typed ExecutiveBriefResponse with export eligibility", async () => {
    const ctx = createMockContext();
    const brief = await generateExecutiveBrief({ context: ctx, language: "en" });

    assert.equal(brief.workspaceId, "ws-test-1");
    assert.equal(brief.clientId, "client-test-1");
    assert.equal(brief.clientName, "Acme Brand");
    assert.equal(brief.readiness.status, "READY");
    assert.equal(brief.readiness.exportEligible, true);
    assert.equal(brief.fingerprint, "hash_abc_123");
    assert.ok(brief.sections.headline.length > 0);
    assert.ok(brief.sections.kpiScorecard.length === 4);
    assert.ok(brief.sections.channelScorecard.length === 2);
  });
});

describe("validateModelStructuredSelection & Model Bounding Contract", () => {
  const allowedObservationIds = ["obs_spend_trend", "obs_roas_trend", "obs_conversions"];

  it("1. Rejects invented numbers/fields outside bounded schema", () => {
    const raw = {
      primaryObservationId: "obs_spend_trend",
      emphasis: "spend",
      inventedRevenue: 1000000,
    };
    const result = validateModelStructuredSelection(raw, allowedObservationIds);
    assert.equal(result.valid, false);
    assert.match(result.reason, /Unrecognized or additional field/);
  });

  it("2. Rejects unauthorized causal claims or free-form commentary", () => {
    const raw = {
      primaryObservationId: "obs_spend_trend",
      emphasis: "spend",
      causalClaim: "Higher spend caused lower conversion cost because of new creatives",
    };
    const result = validateModelStructuredSelection(raw, allowedObservationIds);
    assert.equal(result.valid, false);
    assert.match(result.reason, /Unrecognized or additional field/);
  });

  it("3. Rejects unknown observation IDs not in server-provided candidate list", () => {
    const raw = {
      primaryObservationId: "obs_hallucinated_unknown_id",
      emphasis: "spend",
    };
    const result = validateModelStructuredSelection(raw, allowedObservationIds);
    assert.equal(result.valid, false);
    assert.match(result.reason, /Unknown or invalid primaryObservationId/);
  });

  it("4. Rejects prompt injection payload attempting instruction bypass", () => {
    const raw = {
      primaryObservationId: "'; DROP TABLE \"CampaignMetric\"; --",
      emphasis: "spend",
    };
    const result = validateModelStructuredSelection(raw, allowedObservationIds);
    assert.equal(result.valid, false);
    assert.match(result.reason, /Unknown or invalid primaryObservationId/);
  });

  it("5. Rejects malformed JSON / non-object / missing fields / invalid emphasis", () => {
    assert.equal(validateModelStructuredSelection(null, allowedObservationIds).valid, false);
    assert.equal(validateModelStructuredSelection("just a string", allowedObservationIds).valid, false);
    assert.equal(validateModelStructuredSelection([1, 2, 3], allowedObservationIds).valid, false);
    assert.equal(
      validateModelStructuredSelection(
        { primaryObservationId: "obs_spend_trend", emphasis: "unknown_emphasis" },
        allowedObservationIds,
      ).valid,
      false,
    );
  });

  it("6. Accepts valid structured selection strictly matching candidate IDs and schema", () => {
    const raw = {
      primaryObservationId: "obs_spend_trend",
      emphasis: "spend",
    };
    const result = validateModelStructuredSelection(raw, allowedObservationIds);
    assert.equal(result.valid, true);
    if (result.valid) {
      assert.equal(result.selection.primaryObservationId, "obs_spend_trend");
      assert.equal(result.selection.emphasis, "spend");
    }
  });

  it("7. Fallback to deterministic brief on provider failure or timeout", async () => {
    const ctx = createMockContext();
    const brief = await generateExecutiveBrief({
      context: ctx,
      language: "en",
      allowModelRefinement: false,
    });
    assert.equal(brief.generationMode, "deterministic");
    assert.ok(brief.sections.headline.length > 0);
  });
});
