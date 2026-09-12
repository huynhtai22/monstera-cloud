import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CAPABILITY_REASON_CODES,
  PROVIDER_CAPABILITY_REGISTRY,
  PROVIDER_CAPABILITY_REGISTRY_VERSION,
  createProviderCapabilityRegistry,
  evaluateAttributionWindows,
  evaluateCapabilityRequest,
  getAffectedFields,
  isCapabilityEffective,
  listProviderCapabilities,
  lookupProviderCapability,
  type CapabilityRequest,
  type ProviderCapability,
} from "./index";

const BASE_REQUEST: CapabilityRequest = {
  provider: "meta_ads",
  reportSurface: "ads_insights",
  reportType: "performance",
  granularity: "ad",
  since: "2026-08-01",
  until: "2026-08-31",
  asOf: "2026-09-13",
};

const SOURCE = {
  title: "Synthetic provider policy",
  url: "https://example.test/provider-policy",
  accessedOn: "2026-09-13",
  evidence: "Synthetic test fixture only.",
} as const;

function customRecord(overrides: Partial<ProviderCapability> = {}): ProviderCapability {
  return {
    registryVersion: "test-1",
    recordId: "example_ads.surface.performance.field.metric.2020-01-01",
    provider: "example_ads",
    reportSurface: "surface",
    reportType: "performance",
    kind: "field",
    capabilityId: "metric",
    lifecycle: "active",
    effectiveDate: "2020-01-01",
    granularities: ["ad"],
    attributionRestrictions: [],
    severity: "error",
    operatorExplanation: "Use the supported metric.",
    sourceReference: SOURCE,
    ...overrides,
  };
}

function customRequest(overrides: Partial<CapabilityRequest> = {}): CapabilityRequest {
  return {
    ...BASE_REQUEST,
    provider: "example_ads",
    reportSurface: "surface",
    fields: ["metric"],
    ...overrides,
  };
}

function customPolicy(records: readonly ProviderCapability[]) {
  return createProviderCapabilityRegistry([
    customRecord({
      recordId: "example_ads.surface.performance.report.standard_totals.2020-01-01",
      kind: "report",
      capabilityId: "standard_totals",
    }),
    ...records,
  ]);
}

describe("provider capability registry", () => {
  it("looks up capabilities deterministically and evaluates effective dates", () => {
    const retired = lookupProviderCapability({
      provider: "meta_ads",
      reportSurface: "ads_insights",
      reportType: "performance",
      kind: "field",
      capabilityId: "relevance_score",
    });

    assert.equal(retired?.registryVersion, PROVIDER_CAPABILITY_REGISTRY_VERSION);
    assert.equal(retired?.lifecycle, "retired");
    assert.equal(isCapabilityEffective(retired!, "2019-04-29"), false);
    assert.equal(isCapabilityEffective(retired!, "2019-04-30"), true);
    assert.equal(isCapabilityEffective(retired!, "not-a-date"), false);
  });

  it("uses exact matching by default, opt-in prefix matching, and exact precedence", () => {
    const policy = createProviderCapabilityRegistry([
      customRecord({
        recordId: "prefix",
        capabilityId: "actions_",
        identifierMatch: "prefix",
        lifecycle: "restricted",
      }),
      customRecord({
        recordId: "exact",
        capabilityId: "actions_total",
        lifecycle: "retired",
        effectiveDate: "2021-01-01",
      }),
    ]);

    assert.equal(
      policy.lookup({
        provider: "example_ads",
        reportSurface: "surface",
        reportType: "performance",
        kind: "field",
        capabilityId: "actions_total",
        asOf: "2026-09-13",
      })?.recordId,
      "exact",
    );
    assert.equal(
      policy.lookup({
        provider: "example_ads",
        reportSurface: "surface",
        reportType: "performance",
        kind: "field",
        capabilityId: "actions_video",
        asOf: "2026-09-13",
      })?.recordId,
      "prefix",
    );
    assert.equal(
      policy.lookup({
        provider: "example_ads",
        reportSurface: "surface",
        reportType: "performance",
        kind: "field",
        capabilityId: "actionable_total",
        asOf: "2026-09-13",
      }),
      undefined,
    );
  });

  it("filters future lifecycle entries before deterministic selection", () => {
    const policy = createProviderCapabilityRegistry([
      customRecord({ recordId: "current", lifecycle: "active", effectiveDate: "2020-01-01" }),
      customRecord({ recordId: "future", lifecycle: "retired", effectiveDate: "2030-01-01" }),
    ]);
    const lookup = (asOf: string) =>
      policy.lookup({
        provider: "example_ads",
        reportSurface: "surface",
        reportType: "performance",
        kind: "field",
        capabilityId: "metric",
        asOf,
      });

    assert.equal(lookup("2019-12-31"), undefined);
    assert.equal(lookup("2020-01-01")?.recordId, "current");
    assert.equal(lookup("2026-09-13")?.recordId, "current");
    assert.equal(lookup("2030-01-01")?.recordId, "future");
  });

  it("applies field retirement on its effective date with replacement guidance", () => {
    const before = evaluateCapabilityRequest({
      ...BASE_REQUEST,
      fields: ["relevance_score"],
      since: "2019-04-01",
      until: "2019-04-29",
      asOf: "2019-04-29",
    });
    const onDate = evaluateCapabilityRequest({
      ...BASE_REQUEST,
      fields: ["relevance_score"],
      since: "2019-04-01",
      until: "2019-04-30",
      asOf: "2019-04-30",
    });

    assert.equal(before.compatible, true);
    assert.equal(onDate.compatible, false);
    assert.deepEqual(onDate.affectedFields, ["relevance_score"]);
    assert.deepEqual(onDate.findings[0]?.replacement, [
      "conversion_rate_ranking",
      "engagement_rate_ranking",
      "quality_ranking",
    ]);
    assert.equal(onDate.findings[0]?.code, CAPABILITY_REASON_CODES.CAPABILITY_RETIRED);
  });

  it("uses severity to distinguish errors from compatible warnings and notices", () => {
    const warnings = customPolicy([
      customRecord({ lifecycle: "retired", severity: "warning" }),
    ]).evaluate(customRequest());
    const notices = customPolicy([
      customRecord({ lifecycle: "retired", severity: "info" }),
    ]).evaluate(customRequest());
    const errors = customPolicy([
      customRecord({ lifecycle: "retired", severity: "error" }),
    ]).evaluate(customRequest());

    assert.equal(warnings.compatible, true);
    assert.equal(warnings.findings[0]?.severity, "warning");
    assert.equal(notices.compatible, true);
    assert.equal(notices.findings[0]?.severity, "info");
    assert.equal(errors.compatible, false);
    assert.equal(errors.findings[0]?.severity, "error");
  });

  it("enforces source-backed 13-month limits for unique fields and both hourly breakdowns", () => {
    for (const capability of [
      { fields: ["unique_actions"] },
      { fields: ["cost_per_unique_action_type"] },
      { breakdowns: ["hourly_stats_aggregated_by_advertiser_time_zone"] },
      { breakdowns: ["hourly_stats_aggregated_by_audience_time_zone"] },
    ]) {
      const atBoundary = evaluateCapabilityRequest({
        ...BASE_REQUEST,
        ...capability,
        since: "2025-08-13",
        until: "2026-09-13",
        asOf: "2026-09-13",
      });
      const beforeBoundary = evaluateCapabilityRequest({
        ...BASE_REQUEST,
        ...capability,
        since: "2025-08-12",
        until: "2026-09-13",
        asOf: "2026-09-13",
      });
      assert.equal(atBoundary.compatible, true);
      assert.equal(beforeBoundary.compatible, false);
      assert.equal(
        beforeBoundary.findings.some(
          (finding) => finding.code === CAPABILITY_REASON_CODES.LOOKBACK_LIMIT_EXCEEDED,
        ),
        true,
      );
    }
  });

  it("clamps calendar-month lookbacks at month ends", () => {
    const result = evaluateCapabilityRequest({
      ...BASE_REQUEST,
      fields: ["unique_actions"],
      since: "2025-02-28",
      until: "2026-03-31",
      asOf: "2026-03-31",
    });
    assert.equal(result.compatible, true);
  });

  it("rejects ad-only relevance diagnostics at unsupported granularities", () => {
    const unsupported = evaluateCapabilityRequest({
      ...BASE_REQUEST,
      granularity: "account",
      fields: ["quality_ranking"],
    });
    assert.equal(unsupported.compatible, false);
    const finding = unsupported.findings.find(
      (candidate) => candidate.code === CAPABILITY_REASON_CODES.GRANULARITY_NOT_SUPPORTED,
    );
    assert.equal(finding?.capabilityId, "quality_ranking");
    assert.equal(finding?.severity, "error");
    assert.deepEqual(finding?.affectedFields, ["quality_ranking"]);

    const supported = evaluateCapabilityRequest({
      ...BASE_REQUEST,
      granularity: "ad",
      fields: ["quality_ranking"],
    });
    assert.equal(supported.compatible, true);
    assert.deepEqual(supported.findings, []);
  });

  it("evaluates allowed, retired, combination, and unknown attribution windows", () => {
    const allowed = evaluateCapabilityRequest({ ...BASE_REQUEST, attributionWindows: ["1d_view"] });
    const retired = evaluateCapabilityRequest({ ...BASE_REQUEST, attributionWindows: ["7d_view"] });
    const combination = evaluateCapabilityRequest({
      ...BASE_REQUEST,
      attributionWindows: ["7d_view", "28d_view"],
    });
    const unknown = evaluateCapabilityRequest({ ...BASE_REQUEST, attributionWindows: ["90d_view"] });

    assert.equal(allowed.compatible, true);
    assert.deepEqual(retired.findings.map((finding) => finding.code), [
      CAPABILITY_REASON_CODES.ATTRIBUTION_WINDOW_RETIRED,
    ]);
    assert.equal(
      combination.findings.some(
        (finding) => finding.code === CAPABILITY_REASON_CODES.ATTRIBUTION_WINDOW_FORBIDDEN_COMBINATION,
      ),
      true,
    );
    assert.equal(unknown.findings[0]?.code, CAPABILITY_REASON_CODES.UNKNOWN_ATTRIBUTION_WINDOW);
    assert.deepEqual(
      evaluateAttributionWindows({ ...BASE_REQUEST, attributionWindows: ["1d_view"] }),
      [],
    );
  });

  it("orders findings and affected fields deterministically", () => {
    const first = evaluateCapabilityRequest({
      ...BASE_REQUEST,
      fields: ["relevance_score", "unknown_metric"],
      attributionWindows: ["28d_view", "7d_view"],
    });
    const second = evaluateCapabilityRequest({
      ...BASE_REQUEST,
      fields: ["unknown_metric", "relevance_score"],
      attributionWindows: ["7d_view", "28d_view"],
    });
    assert.deepEqual(first, second);
    assert.deepEqual(first.affectedFields, getAffectedFields(first.findings));
  });

  it("deep-freezes default data and evaluation values", () => {
    const result = evaluateCapabilityRequest({ ...BASE_REQUEST, fields: ["relevance_score"] });
    assert.equal(Object.isFrozen(PROVIDER_CAPABILITY_REGISTRY), true);
    assert.equal(Object.isFrozen(PROVIDER_CAPABILITY_REGISTRY[0]), true);
    assert.equal(Object.isFrozen(PROVIDER_CAPABILITY_REGISTRY[0]?.granularities), true);
    assert.equal(Object.isFrozen(PROVIDER_CAPABILITY_REGISTRY[0]?.sourceReference), true);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.findings), true);
    assert.equal(Object.isFrozen(result.findings[0]), true);
    assert.equal(Reflect.set(PROVIDER_CAPABILITY_REGISTRY[0]!, "lifecycle", "active"), false);
  });

  it("isolates caller-owned registries without mutating callers or the default", () => {
    const firstInput = [customRecord({ recordId: "first", lifecycle: "retired" })];
    const secondInput = [customRecord({ recordId: "second", lifecycle: "active" })];
    const defaultBefore = listProviderCapabilities();
    const first = customPolicy(firstInput);
    const second = customPolicy(secondInput);

    assert.equal(first.evaluate(customRequest()).compatible, false);
    assert.equal(second.evaluate(customRequest()).compatible, true);
    assert.equal(Object.isFrozen(firstInput), false);
    assert.equal(Object.isFrozen(firstInput[0]), false);
    firstInput[0] = customRecord({ recordId: "changed", lifecycle: "active" });
    assert.equal(first.evaluate(customRequest()).compatible, false);
    assert.deepEqual(listProviderCapabilities(), defaultBefore);
  });

  it("fails closed for unknown values without reflecting input and makes zero network calls", () => {
    const unknown = "<script>alert(1)</script>\u0000";
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("The pure registry must not call fetch.");
    };
    try {
      const result = evaluateCapabilityRequest({ ...BASE_REQUEST, fields: [unknown] });
      const provider = evaluateCapabilityRequest({ ...BASE_REQUEST, provider: "future_provider" });

      assert.equal(result.compatible, false);
      assert.equal(result.findings[0]?.code, CAPABILITY_REASON_CODES.UNKNOWN_CAPABILITY);
      assert.equal(result.findings[0]?.operatorGuidance.includes("script"), false);
      assert.equal(/[\u0000-\u001f\u007f]/.test(result.findings[0]?.operatorGuidance ?? ""), false);
      assert.equal(provider.findings[0]?.code, CAPABILITY_REASON_CODES.UNKNOWN_PROVIDER);
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("accepts future provider identifiers at type level and validates malformed custom data at runtime", () => {
    const policy = createProviderCapabilityRegistry([customRecord({ provider: "future_provider" })]);
    assert.equal(policy.list()[0]?.provider, "future_provider");
    assert.throws(
      () => createProviderCapabilityRegistry([{ ...customRecord(), effectiveDate: "not-a-date" }]),
      /Invalid provider capability registry record/,
    );
  });
});

describe("provider capability registry report-rule lifecycle (PR #165 review)", () => {
  const baseField = customRecord();

  const olderReport = customRecord({
    recordId: "example_ads.surface.performance.report.standard_totals.2020-01-01",
    kind: "report",
    capabilityId: "standard_totals",
    effectiveDate: "2020-01-01",
    granularities: ["account", "campaign", "adset", "ad"],
    attributionRestrictions: [
      {
        allowedWindows: ["1d_view"],
        unavailableWindows: ["7d_view"],
        forbiddenCombinations: [["7d_view", "28d_view"]],
        explanation: "older policy: seven-day view-through is retired",
      },
    ],
  });

  const replacedNewerReport = customRecord({
    recordId: "example_ads.surface.performance.report.standard_totals.2026-06-01",
    kind: "report",
    capabilityId: "standard_totals",
    effectiveDate: "2026-06-01",
    granularities: ["account", "campaign", "adset", "ad"],
    attributionRestrictions: [
      {
        allowedWindows: ["1d_view", "7d_view"],
        explanation: "newer policy restores seven-day view-through",
      },
    ],
  });

  const liftedNewerReport = customRecord({
    recordId: "example_ads.surface.performance.report.standard_totals.2026-06-01",
    kind: "report",
    capabilityId: "standard_totals",
    effectiveDate: "2026-06-01",
    granularities: ["account", "campaign", "adset", "ad"],
    attributionRestrictions: [],
  });

  it("applies the older report policy until the newer lifecycle record is effective", () => {
    const policy = createProviderCapabilityRegistry([baseField, olderReport, replacedNewerReport]);
    const retired = policy.evaluate(
      customRequest({ since: "2026-05-01", until: "2026-05-31", asOf: "2026-05-31", attributionWindows: ["7d_view"] }),
    );
    assert.equal(retired.compatible, false);
    assert.equal(
      retired.findings.some((finding) => finding.code === CAPABILITY_REASON_CODES.ATTRIBUTION_WINDOW_RETIRED),
      true,
    );
    assert.deepEqual(
      policy.evaluate(
        customRequest({ since: "2026-05-01", until: "2026-05-31", asOf: "2026-05-31", attributionWindows: ["1d_view"] }),
      ).findings,
      [],
    );
  });

  it("applies only the newer report policy on its effective date instead of merging the old one", () => {
    const policy = createProviderCapabilityRegistry([baseField, olderReport, replacedNewerReport]);
    const lifted = policy.evaluate(
      customRequest({ since: "2026-06-01", until: "2026-06-01", asOf: "2026-06-01", attributionWindows: ["7d_view"] }),
    );
    assert.deepEqual(lifted.findings, []);
    const unlisted = policy.evaluate(
      customRequest({ since: "2026-06-01", until: "2026-06-01", asOf: "2026-06-01", attributionWindows: ["28d_view"] }),
    );
    assert.equal(unlisted.findings[0]?.code, CAPABILITY_REASON_CODES.UNKNOWN_ATTRIBUTION_WINDOW);
  });

  it("lets a newer empty report restriction list lift an older restriction", () => {
    const policy = createProviderCapabilityRegistry([baseField, olderReport, liftedNewerReport]);
    const lifted = policy.evaluate(
      customRequest({ since: "2026-06-01", until: "2026-06-01", asOf: "2026-06-01", attributionWindows: ["7d_view"] }),
    );
    assert.deepEqual(lifted.findings, []);
    const before = policy.evaluate(
      customRequest({ since: "2026-05-01", until: "2026-05-31", asOf: "2026-05-31", attributionWindows: ["7d_view"] }),
    );
    assert.equal(
      before.findings.some((finding) => finding.code === CAPABILITY_REASON_CODES.ATTRIBUTION_WINDOW_RETIRED),
      true,
    );
  });

  it("keeps future report lifecycle records ineffective before their effective date", () => {
    const futureReport = customRecord({
      recordId: "example_ads.surface.performance.report.standard_totals.2030-01-01",
      kind: "report",
      capabilityId: "standard_totals",
      effectiveDate: "2030-01-01",
      granularities: ["account", "campaign", "adset", "ad"],
      attributionRestrictions: [
        {
          allowedWindows: ["9d_view"],
          unavailableWindows: ["1d_view"],
          explanation: "future policy",
        },
      ],
    });
    const policy = createProviderCapabilityRegistry([baseField, olderReport, futureReport]);

    const current = policy.evaluate(
      customRequest({ attributionWindows: ["1d_view", "7d_view"] }),
    );
    assert.deepEqual(
      current.findings.map((finding) => finding.code),
      [CAPABILITY_REASON_CODES.ATTRIBUTION_WINDOW_RETIRED],
    );

    const future = policy.evaluate(
      customRequest({ since: "2030-01-01", until: "2030-01-01", asOf: "2030-01-01", attributionWindows: ["1d_view", "9d_view"] }),
    );
    assert.deepEqual(
      future.findings.map((finding) => finding.code),
      [CAPABILITY_REASON_CODES.ATTRIBUTION_WINDOW_RETIRED],
    );
    assert.equal(future.findings[0]?.capabilityId, "1d_view");
  });

  it("selects the same report rule regardless of registry input order", () => {
    for (const asOf of ["2026-05-31", "2026-06-01"]) {
      const forward = createProviderCapabilityRegistry([baseField, olderReport, replacedNewerReport]).evaluate(
        customRequest({ since: asOf, until: asOf, asOf, attributionWindows: ["7d_view"] }),
      );
      const backward = createProviderCapabilityRegistry([baseField, replacedNewerReport, olderReport]).evaluate(
        customRequest({ since: asOf, until: asOf, asOf, attributionWindows: ["7d_view"] }),
      );
      assert.deepEqual(forward.findings, backward.findings);
    }
  });

  it("keeps standalone attribution evaluation consistent with full request evaluation", () => {
    const policy = createProviderCapabilityRegistry([baseField, olderReport, replacedNewerReport]);
    const request = customRequest({
      since: "2026-06-01",
      until: "2026-06-01",
      asOf: "2026-06-01",
      attributionWindows: ["7d_view", "28d_view"],
    });
    assert.deepEqual(
      policy.evaluateAttributionWindows(request).map((finding) => finding.code),
      policy.evaluate(request).findings.map((finding) => finding.code),
    );
  });

  it("keeps advisory attribution severity compatible while errors stay incompatible", () => {
    const advisory = customRecord({
      recordId: "example_ads.surface.performance.report.standard_totals.2020-01-01",
      kind: "report",
      capabilityId: "standard_totals",
      effectiveDate: "2020-01-01",
      granularities: ["account", "campaign", "adset", "ad"],
      severity: "warning",
      attributionRestrictions: [{ unavailableWindows: ["7d_view"], explanation: "advisory retirement" }],
    });
    const warnings = createProviderCapabilityRegistry([baseField, advisory]).evaluate(
      customRequest({ attributionWindows: ["7d_view"] }),
    );
    assert.equal(warnings.compatible, true);
    assert.equal(warnings.findings[0]?.severity, "warning");

    const blocking = createProviderCapabilityRegistry([baseField, { ...advisory, severity: "error" }]).evaluate(
      customRequest({ attributionWindows: ["7d_view"] }),
    );
    assert.equal(blocking.compatible, false);
    assert.equal(blocking.findings[0]?.severity, "error");
  });
});

