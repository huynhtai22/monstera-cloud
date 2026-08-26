import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLegacyPerformanceSummaryRetired } from "./legacy-performance-summary";

describe("isLegacyPerformanceSummaryRetired", () => {
  it("is retired in production even if ENABLE_AI_SUMMARIES would have been on", () => {
    assert.equal(isLegacyPerformanceSummaryRetired("production"), true);
  });

  it("is not retired in local/dev so the debug path still works", () => {
    assert.equal(isLegacyPerformanceSummaryRetired("development"), false);
    assert.equal(isLegacyPerformanceSummaryRetired("test"), false);
  });
});
