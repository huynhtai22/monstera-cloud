import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateRule } from "@/lib/observability/data-quality";

describe("Data Quality Rule Operations", () => {
  it("validates threshold rule constraints correctly", async () => {
    const rule = {
      id: "rule-spend-test",
      name: "Daily Spend Limit",
      ruleType: "threshold" as const,
      metric: "spend" as const,
      operator: "gt" as const,
      threshold: 500,
      severity: "critical" as const,
    };

    const res = await evaluateRule(rule, {
      metric: "spend",
      current: 650,
      timestamp: new Date(),
    });

    assert.equal(res.violated, true);
    assert.equal(res.actualValue, 650);
    assert.equal(res.expectedValue, 500);
  });

  it("handles comparison percentage rules with previous day benchmark", async () => {
    const rule = {
      id: "rule-pct-test",
      name: "Conversion Drop Alert",
      ruleType: "comparison" as const,
      metric: "conversions" as const,
      operator: "drop_pct" as const,
      pctThreshold: 0.25,
      severity: "critical" as const,
    };

    const res = await evaluateRule(rule, {
      metric: "conversions",
      current: 70,
      previous: 100,
      timestamp: new Date(),
    });

    assert.equal(res.violated, true);
    assert.equal(res.pctChange, -0.3);
  });
});
