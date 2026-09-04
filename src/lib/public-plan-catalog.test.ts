import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agencyProAmount, canPurchaseAgencyPro, planName, PUBLIC_PLAN_IDS, publicPlanFeatures, publicPlanPrice } from "./public-plan-catalog";
import { getPlanLimits, PLAN_PRICING, PLAN_VND_ANNUAL_TOTALS } from "./plan-config";

describe("canonical public billing catalog", () => {
  it("uses the exact same VND amounts as server-created orders", () => {
    assert.equal(agencyProAmount("monthly"), 1_490_000);
    assert.equal(agencyProAmount("annual"), 14_900_000);
    assert.equal(publicPlanPrice("professional", "VND", "monthly").amount, PLAN_PRICING.professional.vndMonthly);
    assert.equal(publicPlanPrice("professional", "VND", "annual").amount, PLAN_VND_ANNUAL_TOTALS.professional);
    assert.match(publicPlanPrice("professional", "VND", "annual").detail, /365 days/);
  });
  it("keeps existing USD public quotes sales-only and Enterprise unpriced", () => {
    assert.equal(publicPlanPrice("professional", "USD", "monthly").amount, 79);
    assert.equal(publicPlanPrice("professional", "USD", "annual").amount, 64);
    assert.match(publicPlanPrice("professional", "USD", "annual").detail, /768 per year.*contact sales/);
    for (const currency of ["VND", "USD"] as const) for (const cycle of ["monthly", "annual"] as const) assert.equal(publicPlanPrice("enterprise", currency, cycle).amount, null);
    assert.deepEqual(PUBLIC_PLAN_IDS, ["professional", "enterprise"]);
  });
  it("uses enforced limits without confusing sources with ad accounts", () => {
    const features = publicPlanFeatures("professional");
    const limits = getPlanLimits("professional");
    assert.ok(features.includes(`${limits.maxConnections} source connections per workspace`));
    assert.ok(features.some(value => value.includes(`${limits.maxSeats} seats per workspace`)));
    assert.equal(planName("starter"), "Studio (legacy)");
  });
  it("allows upgrades from Free and same-tier renewals but not unquoted paid tier changes", () => {
    assert.equal(canPurchaseAgencyPro("free", "ACTIVE"), true);
    assert.equal(canPurchaseAgencyPro("professional", "PILOT"), true);
    assert.equal(canPurchaseAgencyPro("professional", "ACTIVE", { provider: "vietqr_domestic", endsAt: "2026-10-01" }), true);
    assert.equal(canPurchaseAgencyPro("professional", "ACTIVE"), false);
    assert.equal(canPurchaseAgencyPro("professional", "ACTIVE", { provider: "paddle", endsAt: "2026-10-01" }), false);
    assert.equal(canPurchaseAgencyPro("professional", "ACTIVE", { endsAt: "invalid" }), false);
    for (const plan of ["starter", "enterprise", "unknown"]) assert.equal(canPurchaseAgencyPro(plan, "ACTIVE"), false);
    assert.equal(canPurchaseAgencyPro("professional", "SUSPENDED"), false);
  });
});
