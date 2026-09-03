import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PLAN_LIMITS, PLAN_PRICING, workspaceAllowsScheduledRefresh } from "./plan-config";
import {
  evaluateApiKeyCreate,
  evaluateCsvExport,
  evaluateLookerAccess,
  evaluateScheduledRefresh,
  evaluateSeatLimit,
  evaluateSourceConnectLimit,
  evaluateWorkspaceCreateLimit,
  PLAN_LIMIT_CODES,
} from "./plan-entitlements";

describe("self-serve plan catalog (Start / Studio / Agency)", () => {
  it("maps Studio to starter $59/$49 and Agency to professional $149/$129", () => {
    assert.equal(PLAN_LIMITS.starter.displayName, "Studio");
    assert.equal(PLAN_LIMITS.professional.displayName, "Agency");
    assert.equal(PLAN_LIMITS.free.displayName, "Start");
    assert.equal(PLAN_PRICING.starter.usdMonthly, 59);
    assert.equal(PLAN_PRICING.starter.usdAnnualMonthly, 49);
    assert.equal(PLAN_PRICING.professional.usdMonthly, 149);
    assert.equal(PLAN_PRICING.professional.usdAnnualMonthly, 129);
  });

  it("meters workspace-total source connections, not destinations", () => {
    assert.equal(PLAN_LIMITS.free.maxConnections, 1);
    assert.equal(PLAN_LIMITS.starter.maxConnections, 6);
    assert.equal(PLAN_LIMITS.professional.maxConnections, 15);
    assert.equal(PLAN_LIMITS.starter.maxSourceProviders, 2);
    assert.equal(PLAN_LIMITS.professional.maxSourceProviders, 4);
    assert.equal(PLAN_LIMITS.professional.maxWorkspaces, 3);
  });
});

describe("source / account limit enforcement", () => {
  it("blocks a second source connection on free", () => {
    const decision = evaluateSourceConnectLimit({
      plan: "free",
      existingSources: [{ provider: "meta_ads", remoteAccountId: "act_1" }],
      provider: "google_ads",
      remoteAccountId: "123-456-7890",
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.code, PLAN_LIMIT_CODES.ACCOUNT);
  });

  it("allows reconnecting the same identity without consuming a slot", () => {
    const decision = evaluateSourceConnectLimit({
      plan: "free",
      existingSources: [{ provider: "meta_ads", remoteAccountId: "act_999" }],
      provider: "meta_ads",
      remoteAccountId: "999",
      credentials: { adAccounts: [{ id: "act_999" }] },
    });
    assert.equal(decision.ok, true);
    if (decision.ok) assert.equal(decision.reason, "reconnect");
  });

  it("blocks a 7th source connection on Studio (6 = 2 sources × 3 accounts)", () => {
    const existing = Array.from({ length: 6 }, (_, i) => ({
      provider: i < 3 ? "meta_ads" : "google_ads",
      remoteAccountId: `acct_${i}`,
    }));
    const decision = evaluateSourceConnectLimit({
      plan: "starter",
      existingSources: existing,
      provider: "meta_ads",
      remoteAccountId: "acct_new",
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.code, PLAN_LIMIT_CODES.ACCOUNT);
  });

  it("blocks a third source provider on Studio", () => {
    const decision = evaluateSourceConnectLimit({
      plan: "starter",
      existingSources: [
        { provider: "meta_ads", remoteAccountId: "a" },
        { provider: "google_ads", remoteAccountId: "b" },
      ],
      provider: "tiktok_business",
      remoteAccountId: "c",
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.code, PLAN_LIMIT_CODES.SOURCE);
  });

  it("allows 15 source connections per Agency workspace", () => {
    const existing = Array.from({ length: 14 }, (_, i) => ({
      provider: "meta_ads",
      remoteAccountId: `acct_${i}`,
    }));
    const ok = evaluateSourceConnectLimit({
      plan: "professional",
      existingSources: existing,
      provider: "shopee",
      remoteAccountId: "shop_1",
    });
    assert.equal(ok.ok, true);
    const over = evaluateSourceConnectLimit({
      plan: "professional",
      existingSources: [...existing, { provider: "shopee", remoteAccountId: "shop_1" }],
      provider: "google_ads",
      remoteAccountId: "mcc",
    });
    assert.equal(over.ok, false);
  });
});

describe("destination entitlements — no second-destination fee", () => {
  it("blocks Looker (API-key path) on free and allows Sheets JWT", () => {
    assert.equal(evaluateLookerAccess("free", "jwt-sheets"), true);
    assert.equal(evaluateLookerAccess("free", "api-key-looker"), false);
  });

  it("allows Sheets JWT and Looker API-key on Studio with no destination upsell", () => {
    assert.equal(evaluateLookerAccess("starter", "jwt-sheets"), true);
    assert.equal(evaluateLookerAccess("starter", "api-key-looker"), true);
    assert.equal(PLAN_LIMITS.starter.allowLooker, true);
  });

  it("allows both destinations on Agency", () => {
    assert.equal(evaluateLookerAccess("professional", "jwt-sheets"), true);
    assert.equal(evaluateLookerAccess("professional", "api-key-looker"), true);
  });
});

describe("refresh, API keys, CSV, seats, workspaces", () => {
  it("allows one daily scheduled warehouse refresh on free", () => {
    assert.equal(evaluateScheduledRefresh("free"), true);
    assert.equal(workspaceAllowsScheduledRefresh("free"), true);
    assert.equal(evaluateScheduledRefresh("starter"), true);
    assert.equal(evaluateScheduledRefresh("professional"), true);
    assert.equal(PLAN_LIMITS.professional.syncLabel, "Daily + on-demand");
  });

  it("blocks API keys on free; Studio may create keys for Looker; CSV is Agency+", () => {
    assert.equal(evaluateApiKeyCreate("free"), false);
    assert.equal(evaluateApiKeyCreate("starter"), true);
    assert.equal(evaluateCsvExport("free"), false);
    assert.equal(evaluateCsvExport("starter"), false);
    assert.equal(evaluateCsvExport("professional"), true);
  });

  it("enforces a high seat cap even when copy says unlimited", () => {
    const ok = evaluateSeatLimit({ plan: "starter", memberCount: 1, pendingInvitationCount: 0 });
    assert.equal(ok.ok, true);
    const over = evaluateSeatLimit({ plan: "starter", memberCount: 50, pendingInvitationCount: 0 });
    assert.equal(over.ok, false);
    const freeOver = evaluateSeatLimit({ plan: "free", memberCount: 1, pendingInvitationCount: 0 });
    assert.equal(freeOver.ok, false);
  });

  it("caps Start/Studio at 1 workspace and Agency at 3", () => {
    assert.equal(evaluateWorkspaceCreateLimit({ plan: "free", ownedWorkspaceCount: 1 }).ok, false);
    assert.equal(evaluateWorkspaceCreateLimit({ plan: "starter", ownedWorkspaceCount: 1 }).ok, false);
    assert.equal(evaluateWorkspaceCreateLimit({ plan: "professional", ownedWorkspaceCount: 2 }).ok, true);
    assert.equal(evaluateWorkspaceCreateLimit({ plan: "professional", ownedWorkspaceCount: 3 }).ok, false);
  });
});
