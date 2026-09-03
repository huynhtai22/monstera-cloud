import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dashboardReviewAuditId,
  derivePilotActivation,
  pilotActivationSortRank,
  trialDaysRemaining,
} from "./pilot-activation";

const trialEnd = new Date("2026-09-10T00:00:00.000Z");
const freshSource = {
  id: "source-1",
  state: "fresh" as const,
  lastSyncAt: new Date("2026-09-03T00:00:00.000Z"),
};

function derive(overrides: Partial<Parameters<typeof derivePilotActivation>[0]> = {}) {
  return derivePilotActivation({
    workspaceStatus: "PILOT",
    subscriptionEndsAt: trialEnd,
    sources: [],
    rows7d: 0,
    dataThroughDate: null,
    dashboardReviewedAt: null,
    latestImport: null,
    ...overrides,
  });
}

describe("pilot activation state", () => {
  it("starts with a workspace-scoped source connection step", () => {
    const state = derive();
    assert.equal(state.status, "not_started");
    assert.equal(state.currentStep, "connect_source");
    assert.equal(state.sourceConnectionId, null);
  });

  it("requires at least one metric row dated within the seven-day summary window", () => {
    const importing = derive({ sources: [{ ...freshSource, lastSyncAt: null }] });
    assert.equal(importing.status, "in_progress");
    assert.equal(importing.currentStep, "import_data");

    const zeroRows = derive({
      sources: [freshSource],
      latestImport: { status: "completed", approximateRows: 0 },
    });
    assert.equal(zeroRows.status, "blocked");
    assert.deepEqual(zeroRows.blockers, ["zero_recent_rows"]);

    const ready = derive({
      sources: [freshSource],
      rows7d: 1,
      dataThroughDate: new Date("2026-09-03T00:00:00.000Z"),
    });
    assert.equal(ready.status, "ready_to_review");
    assert.equal(ready.currentStep, "review_dashboard");
  });

  it("gives source recovery precedence while no recent data is available", () => {
    const state = derive({
      sources: [freshSource, { id: "source-broken", state: "error", lastSyncAt: null }],
      latestImport: { status: "failed", approximateRows: 0 },
    });
    assert.equal(state.status, "blocked");
    assert.equal(state.currentStep, "fix_source");
    assert.equal(state.sourceConnectionId, "source-broken");
    assert.deepEqual(state.blockers, ["source_authorization_failed"]);
  });

  it("allows one successful source to reach review even if a secondary source needs attention", () => {
    const state = derive({
      sources: [freshSource, { id: "source-broken", state: "error", lastSyncAt: null }],
      rows7d: 12,
    });
    assert.equal(state.status, "ready_to_review");
    assert.equal(state.currentStep, "review_dashboard");
    assert.deepEqual(state.blockers, []);
  });

  it("surfaces failed, partial, and stale source recovery paths", () => {
    assert.deepEqual(
      derive({ sources: [{ id: "s", state: "pending", lastSyncAt: null }], latestImport: { status: "failed", approximateRows: 0 } }).blockers,
      ["import_failed"],
    );
    assert.deepEqual(derive({ sources: [{ id: "s", state: "partial" }] }).blockers, ["partial_import"]);
    assert.deepEqual(derive({ sources: [{ id: "s", state: "stale" }] }).blockers, ["stale_data"]);
  });

  it("activates only when recent rows and the durable review event both exist", () => {
    const reviewedWithoutRows = derive({
      sources: [{ ...freshSource, lastSyncAt: null }],
      dashboardReviewedAt: new Date("2026-09-03T01:00:00.000Z"),
    });
    assert.notEqual(reviewedWithoutRows.status, "activated");

    const activated = derive({
      sources: [freshSource],
      rows7d: 5,
      dashboardReviewedAt: new Date("2026-09-03T01:00:00.000Z"),
    });
    assert.equal(activated.status, "activated");
    assert.equal(activated.currentStep, "complete");
    assert.deepEqual(activated.blockers, []);
  });

  it("handles trial countdowns and legacy undated workspaces", () => {
    assert.equal(trialDaysRemaining(trialEnd.toISOString(), new Date("2026-09-03T12:00:00.000Z")), 7);
    assert.equal(trialDaysRemaining(trialEnd.toISOString(), new Date("2026-09-11T00:00:00.000Z")), 0);
    assert.equal(derive({ subscriptionEndsAt: null }).trialEndsAt, null);
    assert.equal(derive({ workspaceStatus: "ACTIVE" }).trialEndsAt, null);
  });

  it("uses a deterministic audit id and prioritizes blocked or expired pilots", () => {
    assert.equal(dashboardReviewAuditId("workspace-1"), "pilot-dashboard-reviewed-workspace-1");
    const blocked = derive({ sources: [{ id: "s", state: "error" }] });
    const ready = derive({ sources: [freshSource], rows7d: 1 });
    assert.ok(pilotActivationSortRank(blocked) < pilotActivationSortRank(ready));
  });
});
