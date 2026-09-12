import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CAPABILITY_REASON_CODES,
  PROVIDER_CAPABILITY_REGISTRY,
  PROVIDER_CAPABILITY_REGISTRY_VERSION,
  evaluateCapabilityRequest,
  isCapabilityEffective,
  listProviderCapabilities,
  lookupProviderCapability,
  type CapabilityRequest,
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
    assert.deepEqual(onDate.reasons[0]?.replacement, [
      "conversion_rate_ranking",
      "engagement_rate_ranking",
      "quality_ranking",
    ]);
    assert.equal(onDate.reasons[0]?.code, CAPABILITY_REASON_CODES.CAPABILITY_RETIRED);
  });

  it("enforces ad-only relevance diagnostics", () => {
    const result = evaluateCapabilityRequest({
      ...BASE_REQUEST,
      granularity: "campaign",
      fields: ["quality_ranking"],
    });

    assert.equal(result.compatible, false);
    assert.deepEqual(result.affectedFields, ["quality_ranking"]);
    assert.equal(
      result.reasons[0]?.code,
      CAPABILITY_REASON_CODES.GRANULARITY_NOT_SUPPORTED,
    );
  });

  it("uses inclusive calendar-month boundaries for historical limits", () => {
    const atBoundary = evaluateCapabilityRequest({
      ...BASE_REQUEST,
      fields: ["unique_actions"],
      since: "2025-08-13",
      until: "2026-09-13",
      asOf: "2026-09-13",
    });
    const beyondBoundary = evaluateCapabilityRequest({
      ...BASE_REQUEST,
      fields: ["unique_actions"],
      since: "2025-08-12",
      until: "2026-09-13",
      asOf: "2026-09-13",
    });

    assert.equal(atBoundary.compatible, true);
    assert.equal(beyondBoundary.compatible, false);
    assert.deepEqual(
      beyondBoundary.reasons.map((reason) => reason.code),
      [CAPABILITY_REASON_CODES.LOOKBACK_LIMIT_EXCEEDED],
    );
    assert.deepEqual(beyondBoundary.affectedFields, ["unique_actions"]);
  });

  it("enforces the report-level 37-month history ceiling", () => {
    const result = evaluateCapabilityRequest({
      ...BASE_REQUEST,
      since: "2023-08-12",
    });

    assert.equal(result.compatible, false);
    assert.equal(result.reasons[0]?.code, CAPABILITY_REASON_CODES.LOOKBACK_LIMIT_EXCEEDED);
    assert.equal(result.reasons[0]?.kind, "report");
    assert.equal(result.reasons[0]?.capabilityId, "standard_totals");
  });

  it("enforces the six-month frequency-breakdown limit", () => {
    const result = evaluateCapabilityRequest({
      ...BASE_REQUEST,
      breakdowns: ["frequency_value"],
      since: "2026-03-12",
    });

    assert.equal(result.compatible, false);
    assert.equal(result.reasons[0]?.code, CAPABILITY_REASON_CODES.LOOKBACK_LIMIT_EXCEEDED);
    assert.equal(result.reasons[0]?.kind, "breakdown");
  });

  it("retires longer view-through attribution windows from the effective date", () => {
    const result = evaluateCapabilityRequest({
      ...BASE_REQUEST,
      attributionWindows: ["7d_view"],
    });

    assert.equal(result.compatible, false);
    assert.equal(
      result.reasons[0]?.code,
      CAPABILITY_REASON_CODES.ATTRIBUTION_WINDOW_RETIRED,
    );
    assert.deepEqual(result.reasons[0]?.replacement, ["1d_view"]);
  });

  it("orders capabilities and reasons independently of input order", () => {
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
    assert.deepEqual(
      listProviderCapabilities().map((item) => item.recordId),
      [...listProviderCapabilities()].map((item) => item.recordId).sort(),
    );
  });

  it("deep-freezes registry data and returned evaluations", () => {
    const result = evaluateCapabilityRequest({
      ...BASE_REQUEST,
      fields: ["relevance_score"],
    });

    assert.equal(Object.isFrozen(PROVIDER_CAPABILITY_REGISTRY), true);
    assert.equal(Object.isFrozen(PROVIDER_CAPABILITY_REGISTRY[0]), true);
    assert.equal(Object.isFrozen(PROVIDER_CAPABILITY_REGISTRY[0]?.granularities), true);
    assert.equal(Object.isFrozen(PROVIDER_CAPABILITY_REGISTRY[0]?.sourceReference), true);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.reasons), true);
    assert.equal(Object.isFrozen(result.reasons[0]), true);
    assert.equal(Reflect.set(PROVIDER_CAPABILITY_REGISTRY[0]!, "lifecycle", "active"), false);
  });

  it("fails closed for unknown capabilities without reflecting input in guidance", () => {
    const unknown = "<script>alert(1)</script>\u0000";
    const lookup = lookupProviderCapability({
      provider: "meta_ads",
      reportSurface: "ads_insights",
      reportType: "performance",
      kind: "field",
      capabilityId: unknown,
    });
    const result = evaluateCapabilityRequest({ ...BASE_REQUEST, fields: [unknown] });

    assert.equal(lookup, undefined);
    assert.equal(result.compatible, false);
    assert.equal(result.reasons[0]?.code, CAPABILITY_REASON_CODES.UNKNOWN_CAPABILITY);
    assert.equal(result.reasons[0]?.operatorGuidance.includes("script"), false);
    assert.equal(/[\u0000-\u001f\u007f]/.test(result.reasons[0]?.operatorGuidance ?? ""), false);
  });

  it("reports invalid dates and unknown providers with stable reason codes", () => {
    const result = evaluateCapabilityRequest({
      ...BASE_REQUEST,
      provider: "future_provider",
      since: "2026-09-02",
      until: "2026-09-01",
    });

    assert.deepEqual(
      result.reasons.map((reason) => reason.code),
      [CAPABILITY_REASON_CODES.INVALID_DATE_RANGE, CAPABILITY_REASON_CODES.UNKNOWN_PROVIDER],
    );
  });
});
