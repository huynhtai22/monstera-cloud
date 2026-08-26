import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PLAN_LIMITS, PLAN_PRICING, defaultSignupWorkspacePlan } from "./plan-config";
import { billingGateForCurrency, resolvePricingGeo } from "./pricing-geo";
import { getCheckoutApiPath, pilotSupportHref } from "./checkout-api-path";
import { assertPaddleUsdCurrency, planForPriceId, priceIdForPlan } from "./paddle";
import { vietQrAmountForPlan } from "./vietqr-gateway";
import { evaluateLookerAccess, evaluateScheduledRefresh } from "./plan-entitlements";

describe("signup defaults to Start (free)", () => {
  it("creates Workspace.plan = free for a normal signup email", () => {
    const signup = defaultSignupWorkspacePlan("buyer@example.com");
    assert.equal(signup.plan, "free");
  });

  it("keeps PRO_WHITELIST_EMAILS on professional", () => {
    assert.equal(defaultSignupWorkspacePlan("huynhtai@monsteracloud.com").plan, "professional");
  });
});

describe("geo currency split", () => {
  it("maps country VN → VND and country US → USD", () => {
    assert.deepEqual(resolvePricingGeo({ vercelCountry: "VN" }), {
      country: "VN",
      currency: "VND",
      isVietnam: true,
    });
    assert.deepEqual(resolvePricingGeo({ vercelCountry: "US" }), {
      country: "US",
      currency: "USD",
      isVietnam: false,
    });
    assert.equal(billingGateForCurrency("VND"), "vietqr_domestic");
    assert.equal(billingGateForCurrency("USD"), "paddle");
  });
});

describe("payment gates never mix", () => {
  it("createVietQrOrder amount comes from PLAN_PRICING VND, never usdMonthly", () => {
    const monthly = vietQrAmountForPlan("starter", "monthly");
    const annual = vietQrAmountForPlan("starter", "annual");
    assert.equal(monthly, PLAN_PRICING.starter.vndMonthly);
    assert.equal(annual, PLAN_PRICING.starter.vndAnnualMonthly * 12);
    assert.notEqual(monthly, PLAN_PRICING.starter.usdMonthly);
    assert.notEqual(annual, PLAN_PRICING.starter.usdAnnualMonthly);
  });

  it("Paddle helpers never receive VND and never map PayOS order codes", () => {
    assert.throws(() => priceIdForPlan("starter", "monthly", "VND"), /USD-only/);
    assert.throws(() => assertPaddleUsdCurrency("VND"), /USD-only/);
    assert.equal(planForPriceId("183920"), null);
    assert.equal(planForPriceId("990000"), null);
    const previous = process.env.PADDLE_PRICE_STARTER_MONTHLY;
    process.env.PADDLE_PRICE_STARTER_MONTHLY = "pri_starter_monthly_test";
    try {
      assert.equal(priceIdForPlan("starter", "monthly", "USD"), "pri_starter_monthly_test");
      assert.equal(planForPriceId("pri_starter_monthly_test"), "starter");
    } finally {
      if (previous === undefined) delete process.env.PADDLE_PRICE_STARTER_MONTHLY;
      else process.env.PADDLE_PRICE_STARTER_MONTHLY = previous;
    }
  });

  it("checkout path is Paddle for USD and PayOS/VietQR for VND; CheckoutButton still does not charge", () => {
    assert.equal(getCheckoutApiPath("USD"), "/api/checkout/paddle");
    assert.equal(getCheckoutApiPath("VND"), "/api/payments/vietqr/create");
    const href = pilotSupportHref({ plan: "starter", invoiceCurrency: "VND" });
    assert.match(href, /^\/support\?/);
    assert.match(href, /currency=VND/);
    assert.match(href, /plan=starter/);
    assert.doesNotMatch(href, /paddle|payos|vietqr/i);
  });
});

describe("entitlements and Agency copy", () => {
  it("blocks Looker API-key on free, allows Sheets, skips scheduled refresh", () => {
    assert.equal(evaluateLookerAccess("free", "jwt-sheets"), true);
    assert.equal(evaluateLookerAccess("free", "api-key-looker"), false);
    assert.equal(evaluateScheduledRefresh("free"), false);
  });

  it("allows Sheets + Looker on Studio with no destination upsell", () => {
    assert.equal(evaluateLookerAccess("starter", "jwt-sheets"), true);
    assert.equal(evaluateLookerAccess("starter", "api-key-looker"), true);
    assert.equal(PLAN_LIMITS.starter.allowLooker, true);
  });

  it("Agency feature list says Daily, not Hourly, in user-visible strings", () => {
    assert.equal(PLAN_LIMITS.professional.syncLabel, "Daily + on-demand");
    assert.doesNotMatch(PLAN_LIMITS.professional.syncLabel, /hourly/i);
    assert.equal(PLAN_LIMITS.professional.scheduledRefresh, "hourly");
  });
});
