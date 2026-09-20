import assert from "node:assert/strict";
import { it } from "node:test";
import { evaluateReportReadiness, type SourceEvidence } from "./report-readiness";
import { buildFreshnessJourney, freshnessIncidentKey } from "./freshness-journey";
import { freshnessMonitorPage } from "./ingestion/report-freshness-monitor";

const now = new Date("2026-09-21T12:00:00Z");
function evaluation(overrides: Partial<Parameters<typeof evaluateReportReadiness>[0]> = {}) {
  const source: SourceEvidence = {
    connectionId: "connection", provider: "google_ads", connectionStatus: "connected", lastError: null,
    lastSyncAt: now.toISOString(), latestDataDate: "2026-09-20", timezone: "Asia/Ho_Chi_Minh",
    accounts: [{ accountId: "123", status: "healthy", lastSuccessAt: now.toISOString() }],
    contexts: [{ accountId: "123", providerTimezone: "Asia/Ho_Chi_Minh", providerCurrency: "VND", providerObservedAt: now.toISOString(), overrideTimezone: null, overrideCurrency: null, overrideAt: null }],
    days: [{ accountId: "123", date: "2026-09-20", currency: "VND", rows: 1 }], syncs: [],
  };
  return evaluateReportReadiness({ workspaceId: "workspace", clientId: "client", now,
    window: { start: "2026-09-20", end: "2026-09-20" }, sources: [source], requiredProviders: ["google_ads"],
    requiredProvidersBasis: "explicit", destination: { state: "verified", configuredCount: 1, required: ["google_sheets"] }, ...overrides });
}
it("uses canonical READY only with complete evidence", () => {
  const journey = buildFreshnessJourney(evaluation());
  assert.equal(journey.status, "READY");
  assert.ok(journey.stages.every(s => s.state === "passed"));
  assert.equal(journey.deliveredAt, null, "never invent a receipt timestamp");
});
it("routes missing sources to source and does not paint downstream stages green", () => {
  const journey = buildFreshnessJourney(evaluation({ sources: [] }));
  assert.equal(journey.status, "NOT_READY");
  assert.equal(journey.stages[0].state, "attention");
  assert.notEqual(journey.stages[3].state, "passed");
});
it("a stale destination cannot be hidden by successful upstream checks", () => {
  const journey = buildFreshnessJourney(evaluation({ destination: { state: "stale", configuredCount: 1, required: ["google_sheets"] } }));
  assert.notEqual(journey.status, "READY");
  assert.equal(journey.stages[3].state, "attention");
  assert.ok(journey.stages[3].codes.includes("DESTINATION_STALE"));
});
it("capped evidence is unknown at every stage", () => {
  const journey = buildFreshnessJourney(evaluation({ limited: true }));
  assert.ok(journey.stages.every(s => s.state === "unknown"));
});
it("identical state at another observation time has the same incident key", () => {
  const first = buildFreshnessJourney(evaluation());
  assert.equal(freshnessIncidentKey(first), freshnessIncidentKey({ ...first, evaluatedAt: "2026-09-21T13:00:00Z" }));
});
it("rotates all client pages within a bounded sweep", () => {
  assert.deepEqual([0, 1, 2, 3].map(tick => freshnessMonitorPage(8, new Date(tick * 900_000))), [0, 3, 6, 0]);
  assert.equal(freshnessMonitorPage(0, now), 0);
});
