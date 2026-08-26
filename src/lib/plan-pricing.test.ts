import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPlanPrice, PLAN_PRICING } from "./plan-config";

describe("public plan pricing source of truth", () => {
  it("formats monthly and annual display values from PLAN_PRICING", () => {
    for (const plan of ["free", "starter", "professional", "enterprise"] as const) {
      assert.equal(formatPlanPrice(plan, "USD", false).amount, PLAN_PRICING[plan].usdMonthly);
      assert.equal(formatPlanPrice(plan, "USD", true).amount, PLAN_PRICING[plan].usdAnnualMonthly);
      assert.equal(formatPlanPrice(plan, "VND", false).amount, PLAN_PRICING[plan].vndMonthly);
      assert.equal(formatPlanPrice(plan, "VND", true).amount, PLAN_PRICING[plan].vndAnnualMonthly);
    }
  });

  it("uses Studio $49 annual / $59 MoM and Agency $129 annual / $149 MoM", () => {
    assert.equal(formatPlanPrice("starter", "USD", true).formatted, "$49");
    assert.equal(formatPlanPrice("starter", "USD", false).formatted, "$59");
    assert.equal(formatPlanPrice("professional", "USD", true).formatted, "$129");
    assert.equal(formatPlanPrice("professional", "USD", false).formatted, "$149");
  });
});
