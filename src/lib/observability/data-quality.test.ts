import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateRule, type DataQualityRuleType, type DataQualityMetric, type DataQualityOperator, type DataQualitySeverity } from "./data-quality";

describe("Data Quality Rule Evaluation", () => {
  it("detects threshold violations for greater-than operator", async () => {
    const rule = {
      id: "rule-1",
      name: "Ad Spend Cap Alert",
      ruleType: "threshold" as DataQualityRuleType,
      metric: "spend" as DataQualityMetric,
      operator: "gt" as DataQualityOperator,
      threshold: 1000,
      severity: "critical" as DataQualitySeverity,
    };

    const violatedResult = await evaluateRule(rule, {
      metric: "spend",
      current: 1250,
      timestamp: new Date(),
    });
    assert.equal(violatedResult.violated, true);
    assert.equal(violatedResult.actualValue, 1250);

    const normalResult = await evaluateRule(rule, {
      metric: "spend",
      current: 850,
      timestamp: new Date(),
    });
    assert.equal(normalResult.violated, false);
  });

  it("detects threshold violations for less-than operator (zero row sync)", async () => {
    const rule = {
      id: "rule-2",
      name: "Minimum Row Count Check",
      ruleType: "threshold" as DataQualityRuleType,
      metric: "row_count" as DataQualityMetric,
      operator: "lt" as DataQualityOperator,
      threshold: 1,
      severity: "critical" as DataQualitySeverity,
    };

    const violatedResult = await evaluateRule(rule, {
      metric: "row_count",
      current: 0,
      timestamp: new Date(),
    });
    assert.equal(violatedResult.violated, true);
    assert.equal(violatedResult.actualValue, 0);

    const normalResult = await evaluateRule(rule, {
      metric: "row_count",
      current: 450,
      timestamp: new Date(),
    });
    assert.equal(normalResult.violated, false);
  });

  it("detects significant drop percentage anomalies", async () => {
    const rule = {
      id: "rule-3",
      name: "Revenue Drop Alert",
      ruleType: "comparison" as DataQualityRuleType,
      metric: "revenue" as DataQualityMetric,
      operator: "drop_pct" as DataQualityOperator,
      pctThreshold: 0.3, // 30% drop
      severity: "warning" as DataQualitySeverity,
    };

    const violatedResult = await evaluateRule(rule, {
      metric: "revenue",
      current: 500,
      previous: 1000, // 50% drop
      timestamp: new Date(),
    });
    assert.equal(violatedResult.violated, true);
    assert.equal(violatedResult.pctChange, -0.5);

    const normalResult = await evaluateRule(rule, {
      metric: "revenue",
      current: 850,
      previous: 1000, // 15% drop, below threshold
      timestamp: new Date(),
    });
    assert.equal(normalResult.violated, false);
  });
});
