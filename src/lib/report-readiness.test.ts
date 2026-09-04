import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateReportReadiness, defaultReportingWindow, type SourceEvidence } from "./report-readiness";
import { parseReadinessRequest } from "./report-readiness-request";

const now = new Date("2026-09-04T12:00:00Z");
const window = { start: "2026-09-01", end: "2026-09-03" };
function source(): SourceEvidence {
  return { connectionId: "source", provider: "meta_ads", connectionStatus: "connected", lastError: null,
    lastSyncAt: now.toISOString(), latestDataDate: window.end, timezone: "Asia/Ho_Chi_Minh",
    accounts: [{ accountId: "a", status: "healthy", lastSuccessAt: now.toISOString() }],
    contexts: [{ accountId: "a", providerTimezone: "Asia/Ho_Chi_Minh", providerCurrency: "VND", providerObservedAt: now.toISOString(), overrideTimezone: null, overrideCurrency: null, overrideAt: null }],
    days: [1,2,3].map(day => ({ accountId: "a", date: `2026-09-0${day}`, currency: "VND", rows: 1 })), syncs: [] };
}
function evaluate(s = source(), extra: Partial<Parameters<typeof evaluateReportReadiness>[0]> = {}) {
  return evaluateReportReadiness({ workspaceId: "w", clientId: "c", now, window,
    sources: [s], requiredProviders: ["meta_ads"], requiredProvidersBasis: "explicit",
    destination: { state: "verified", configuredCount: 1, required: ["google_sheets"] }, ...extra });
}
describe("Report Readiness v1 deterministic decisions", () => {
  it("READY requires complete evidence, not just connected", () => {
    assert.equal(evaluate().status, "READY");
    assert.equal(evaluate({ ...source(), days: [], lastSyncAt: null, accounts: [] }).status, "NOT_READY");
  });
  it("NOT_READY wins over missing context", () => {
    const result = evaluate({ ...source(), connectionStatus: "disconnected", timezone: null });
    assert.equal(result.status, "NOT_READY");
    assert.ok(result.blockers.some(i => i.code === "SOURCE_DISCONNECTED"));
  });
  it("WARNING for unverified destination or inferred requirements", () => {
    const result = evaluate(source(), { destination: { state: "unverified", configuredCount: 1 } });
    assert.equal(result.status, "WARNING");
    assert.ok(result.warnings.some(i => i.code === "DESTINATION_UNVERIFIED"));
    assert.equal(evaluate(source(), { requiredProvidersBasis: "assigned_sources" }).status, "WARNING");
  });
  it("UNKNOWN for missing currency or timezone, never defaults to USD/UTC", () => {
    for (const s of [{ ...source(), contexts: [] }, { ...source(), days: source().days.map(d => ({ ...d, currency: null })) }]) {
      assert.equal(evaluate(s).status, "UNKNOWN");
    }
    const s = source(); s.days[1].currency = null;
    assert.equal(evaluate(s).status, "UNKNOWN", "one known currency does not mask a null currency row");
  });
  it("requires every declared provider", () => {
    const result = evaluate(source(), { requiredProviders: ["meta_ads", "google_ads"] });
    assert.ok(result.blockers.some(i => i.code === "SOURCE_MISSING" && i.provider === "google_ads"));
    assert.equal(evaluate(source(), { sources: [], requiredProviders: [] }).status, "NOT_READY");
  });
  it("blocks stale connection/account even when another success is fresh", () => {
    const s = source(); s.accounts.push({ accountId: "b", status: "healthy", lastSuccessAt: "2026-08-01T00:00:00Z" });
    assert.ok(evaluate(s).blockers.some(i => i.code === "DATA_STALE"));
    assert.equal(evaluate({ ...source(), lastSyncAt: "2026-08-01T00:00:00Z" }).status, "NOT_READY");
  });
  it("blocks partial, reconnect and quarantined states despite top-level connection success", () => {
    for (const [status,code] of [["degraded","SYNC_PARTIAL"],["reconnect_required","SOURCE_RECONNECT_REQUIRED"],["quarantined","SOURCE_QUARANTINED"]]) {
      const s = source(); s.accounts[0].status = status;
      assert.ok(evaluate(s).blockers.some(i => i.code === code));
    }
    assert.ok(evaluate({ ...source(), lastError: "[partial] SECRET_ERROR" }).blockers.some(i => i.code === "SYNC_PARTIAL"));
  });
  it("checks holes in every account's dates, not only the MAX date", () => {
    const s = source(); s.days.splice(1,1);
    const result = evaluate(s);
    assert.equal(result.status, "NOT_READY");
    assert.deepEqual(result.providers[0].evidence.accounts[0].missingDates, ["2026-09-02"]);
    s.accounts.push({ accountId: "missing", status: "healthy", lastSuccessAt: now.toISOString() });
    assert.equal(evaluate(s).providers[0].evidence.accounts[1].presentDays, 0);
  });
  it("latest success cannot clear a different account/endpoint failure", () => {
    const s = source();
    s.syncs = [
      { id: "failed", kind: "import", target: "a", at: "2026-09-03T01:00:00Z", status: "partial" },
      { id: "success", kind: "import", target: "b", at: now.toISOString(), status: "success" },
    ];
    assert.equal(evaluate(s).status, "NOT_READY");
    s.syncs.push({ id: "recovered", kind: "import", target: "a", at: now.toISOString(), status: "success" });
    assert.equal(evaluate(s).status, "READY");
    s.syncs.push({ id: "endpoint", kind: "endpoint", target: "/ads", at: now.toISOString(), status: "failed" });
    assert.equal(evaluate(s).status, "NOT_READY");
  });
  it("pending import, mixed currencies and query truncation are never READY", () => {
    const s = source(); s.syncs.push({ id: "pending", kind: "import", target: "a", at: now.toISOString(), status: "pending" });
    assert.equal(evaluate(s).status, "WARNING");
    s.days[0].currency = "USD";
    assert.ok(evaluate(s).warnings.some(i => i.code === "MIXED_CURRENCY"));
    assert.equal(evaluate(source(), { limited: true }).status, "UNKNOWN");
    assert.equal(evaluate({ ...source(), days: [] }, { limited: true }).status, "UNKNOWN", "truncation does not prove dates are missing");
    assert.equal(evaluate(source(), { sources: [], requiredProviders: [], limited: true }).status, "UNKNOWN");
  });
  it("conflicting outcomes with the same timestamp prefer failure", () => {
    const s = source();
    s.syncs = [
      { id:"a-success",kind:"import",target:"a",at:now.toISOString(),status:"success" },
      { id:"z-failure",kind:"import",target:"a",at:now.toISOString(),status:"failed" },
    ];
    assert.equal(evaluate(s).status,"NOT_READY");
  });
  it("destination failure blocks and raw errors are not serialized", () => {
    const result = evaluate({ ...source(), lastError: "SECRET_TOKEN provider payload" }, { destination: { state: "unavailable", configuredCount: 1 } });
    assert.ok(result.blockers.some(i => i.code === "DESTINATION_UNAVAILABLE"));
    assert.ok(!JSON.stringify(result).includes("SECRET_TOKEN"));
    assert.ok(!JSON.stringify(result).includes("lastError"));
  });
  it("defaults to seven completed dates and validates all bounded inputs", () => {
    assert.deepEqual(defaultReportingWindow(now), { start: "2026-08-28", end: "2026-09-03" });
    for (const extra of [
      { start: "2026-02-30", end: "2026-03-01" }, { start: "2026-01-01" },
      { start: "2026-04-02", end: "2026-04-01" }, { start: "2026-01-01", end: "2026-08-31" },
      { start: "2999-01-01", end: "2999-01-02" }, { limit: 0 }, { limit: 51 }, { timezone: "UTC" },
      { clientId: "foreign", after: "cursor" },
    ]) assert.equal(parseReadinessRequest({ workspaceId: "w", ...extra }), null);
    assert.ok(parseReadinessRequest({ workspaceId: "w", start: "2026-01-01", end: "2026-01-01" }));
  });
});
