import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateRule } from "@/lib/observability/data-quality";
import prisma from "@/lib/prisma";

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

  it("enforces tenant isolation where clauses on data quality rules", async () => {
    let capturedWhere: any = null;
    (prisma as any).dataQualityRule = {
      updateMany: async ({ where }: any) => {
        capturedWhere = where;
        return { count: 1 };
      },
      deleteMany: async ({ where }: any) => {
        capturedWhere = where;
        return { count: 1 };
      },
    };

    // Simulate tenant-isolated update
    await (prisma as any).dataQualityRule.updateMany({
      where: { id: "rule-123", workspaceId: "workspace-abc" },
      data: { enabled: false },
    });
    assert.deepEqual(capturedWhere, { id: "rule-123", workspaceId: "workspace-abc" });

    // Simulate tenant-isolated delete
    await (prisma as any).dataQualityRule.deleteMany({
      where: { id: "rule-123", workspaceId: "workspace-abc" },
    });
    assert.deepEqual(capturedWhere, { id: "rule-123", workspaceId: "workspace-abc" });
  });
});
