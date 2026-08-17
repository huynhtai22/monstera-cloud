import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateRule,
  recordViolation,
  isAlertInCooldown,
  type DataQualityRuleType,
  type DataQualityMetric,
  type DataQualityOperator,
  type DataQualitySeverity,
} from "./data-quality";
import prisma from "@/lib/prisma";

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

  it("detects exact equality threshold checks", async () => {
    const rule = {
      id: "rule-eq",
      name: "Zero Conversions Alert",
      ruleType: "threshold" as DataQualityRuleType,
      metric: "conversions" as DataQualityMetric,
      operator: "eq" as DataQualityOperator,
      threshold: 0,
      severity: "warning" as DataQualitySeverity,
    };

    const matchResult = await evaluateRule(rule, {
      metric: "conversions",
      current: 0,
      timestamp: new Date(),
    });
    assert.equal(matchResult.violated, true);

    const nonMatchResult = await evaluateRule(rule, {
      metric: "conversions",
      current: 25,
      timestamp: new Date(),
    });
    assert.equal(nonMatchResult.violated, false);
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

  it("evaluates schema check rules and catches schema drift", async () => {
    const rule = {
      id: "rule-schema",
      name: "Order Schema Check",
      ruleType: "schema_check" as DataQualityRuleType,
      metric: "orders" as DataQualityMetric,
      operator: "schema_check" as DataQualityOperator,
      severity: "critical" as DataQualitySeverity,
    };

    const schemaDrift = await evaluateRule(rule, {
      metric: "orders",
      current: 100,
      schemaValid: false,
      missingColumns: ["total_price", "currency"],
      timestamp: new Date(),
    });
    assert.equal(schemaDrift.violated, true);
    assert.match(schemaDrift.message, /Schema drift detected/);

    const schemaValid = await evaluateRule(rule, {
      metric: "orders",
      current: 100,
      schemaValid: true,
      timestamp: new Date(),
    });
    assert.equal(schemaValid.violated, false);
  });

  it("enforces cooldown deduplication across recent violations", async () => {
    // First check should allow alert and start cooldown window
    const firstCheck = await isAlertInCooldown("workspace-test-cd", "rule-test-1");
    assert.equal(firstCheck, false);

    // Immediate second check should be suppressed by cooldown
    const secondCheck = await isAlertInCooldown("workspace-test-cd", "rule-test-1");
    assert.equal(secondCheck, true);

    // Different rule in same workspace is not blocked
    const differentRuleCheck = await isAlertInCooldown("workspace-test-cd", "rule-test-2");
    assert.equal(differentRuleCheck, false);
  });

  it("keeps warnings audit-only and respects notifyTelegram flags", async () => {
    let createdViolation: any = null;
    (prisma as any).dataQualityViolation = {
      create: async ({ data }: any) => {
        createdViolation = data;
        return { id: "viol-1", ...data };
      },
      findMany: async () => [],
    };

    // Warning severity rule (audit log only)
    const warningRule = {
      id: "rule-warn",
      workspaceId: "ws-test",
      name: "Low Volume Warning",
      ruleType: "threshold",
      metric: "spend",
      operator: "lt",
      severity: "warning",
      notifyTelegram: true,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      description: null,
      threshold: 10,
      pctThreshold: null,
      pipelineId: null,
      connectionId: null,
      notifyEmail: false,
    };

    await recordViolation(warningRule as any, "ws-test", {
      actualValue: 5,
      expectedValue: 10,
    });
    assert.equal(createdViolation.ruleId, "rule-warn");
    assert.equal(createdViolation.status, "open");

    // Critical rule with notifyTelegram disabled
    const silentCriticalRule = {
      ...warningRule,
      id: "rule-silent-crit",
      severity: "critical",
      notifyTelegram: false,
    };

    await recordViolation(silentCriticalRule as any, "ws-test", {
      actualValue: 0,
      expectedValue: 10,
    });
    assert.equal(createdViolation.ruleId, "rule-silent-crit");
  });
});
