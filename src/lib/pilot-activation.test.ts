import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dashboardReviewAuditId,
  derivePilotActivation,
  pilotActivationSortRank,
  trialDaysRemaining,
} from "./pilot-activation";

const trialEnd = new Date("2026-09-10T00:00:00.000Z");
// Frozen evaluation clock for every rank/countdown check below. All fixtures
// are anchored to it and every time-sensitive assertion passes it explicitly,
// so this suite is independent of the real system date. Do not reintroduce
// `new Date()` / `Date.now()` defaults here: the trial end above is only five
// days after NOW, and any evaluation using the real clock would flip once the
// calendar passes it.
const NOW = new Date("2026-09-05T12:00:00.000Z");
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
    assert.ok(pilotActivationSortRank(blocked, NOW) < pilotActivationSortRank(ready, NOW));
  });

  it("orders operator view as blocked < expiring < ready_to_review < activated", () => {
    const blocked = derive({ sources: [{ id: "s", state: "error" }] });
    const expiring = derive({
      sources: [freshSource],
      rows7d: 1,
      subscriptionEndsAt: new Date(NOW.getTime() - 1000).toISOString(),
    });
    const ready = derive({ sources: [freshSource], rows7d: 1 });
    const activated = derive({
      sources: [freshSource],
      rows7d: 5,
      dashboardReviewedAt: new Date("2026-09-03T01:00:00.000Z"),
    });
    // Expired trial is treated as blocked priority (rank 0)
    assert.equal(pilotActivationSortRank(expiring, NOW), 0);
    assert.equal(pilotActivationSortRank(blocked, NOW), 0);
    assert.equal(pilotActivationSortRank(ready, NOW), 2);
    assert.equal(pilotActivationSortRank(activated, NOW), 3);
    assert.ok(pilotActivationSortRank(blocked, NOW) < pilotActivationSortRank(ready, NOW));
    assert.ok(pilotActivationSortRank(ready, NOW) < pilotActivationSortRank(activated, NOW));
    assert.ok(pilotActivationSortRank(expiring, NOW) < pilotActivationSortRank(ready, NOW));
  });

  it("keeps trial duration server-controlled and ignores browser offer param", () => {
    // The offer param only affects client copy, never entitlement.
    // Server derives trialEndsAt solely from workspaceStatus and subscriptionEndsAt.
    const withOffer = derive({ workspaceStatus: "PILOT", subscriptionEndsAt: trialEnd });
    const withoutOffer = derive({ workspaceStatus: "PILOT", subscriptionEndsAt: trialEnd });
    assert.equal(withOffer.trialEndsAt, withoutOffer.trialEndsAt);
    assert.equal(withOffer.trialEndsAt, trialEnd.toISOString());
  });
});

describe("pilot activation trial-window boundaries", () => {
  const readyLike = () => derive({ sources: [freshSource], rows7d: 1 });
  const endMs = trialEnd.getTime();

  it("ranks active strictly before the exact end instant", () => {
    const justBeforeEnd = new Date(endMs - 1);
    assert.equal(pilotActivationSortRank(readyLike(), justBeforeEnd), 2);
    assert.equal(trialDaysRemaining(trialEnd.toISOString(), justBeforeEnd), 1);
  });

  it("treats the exact end instant as expired (inclusive boundary)", () => {
    assert.equal(pilotActivationSortRank(readyLike(), trialEnd), 0);
    assert.equal(trialDaysRemaining(trialEnd.toISOString(), trialEnd), 0);
  });

  it("stays expired immediately after the end instant", () => {
    const justAfterEnd = new Date(endMs + 1);
    assert.equal(pilotActivationSortRank(readyLike(), justAfterEnd), 0);
    assert.equal(trialDaysRemaining(trialEnd.toISOString(), justAfterEnd), 0);
  });

  it("reports full remaining time well inside the window", () => {
    assert.equal(pilotActivationSortRank(readyLike(), NOW), 2);
    assert.equal(trialDaysRemaining(trialEnd.toISOString(), NOW), 5);
  });

  it("clamps inverted windows to zero and rejects invalid input", () => {
    assert.equal(trialDaysRemaining("2026-09-01T00:00:00.000Z", NOW), 0);
    assert.equal(trialDaysRemaining(null, NOW), null);
    assert.equal(trialDaysRemaining("not-a-date", NOW), null);
  });

  it("treats equivalent UTC instants identically regardless of offset notation", () => {
    const zulu = "2026-09-10T00:00:00.000Z";
    const offset = "2026-09-10T02:00:00+02:00";
    assert.equal(new Date(offset).getTime(), new Date(zulu).getTime());
    assert.equal(
      pilotActivationSortRank(readyLike(), new Date(offset)),
      pilotActivationSortRank(readyLike(), new Date(zulu)),
    );
    assert.equal(
      trialDaysRemaining(offset, NOW),
      trialDaysRemaining(zulu, NOW),
    );
  });

  it("depends only on the injected clock, never on the real system date", () => {
    // Same fixtures evaluated twice must agree exactly; advancing the real
    // calendar cannot change these outcomes because no call site reads it.
    const first = {
      rank: pilotActivationSortRank(readyLike(), NOW),
      remaining: trialDaysRemaining(trialEnd.toISOString(), NOW),
    };
    const second = {
      rank: pilotActivationSortRank(readyLike(), new Date(NOW.getTime())),
      remaining: trialDaysRemaining(trialEnd.toISOString(), new Date(NOW.getTime())),
    };
    assert.deepEqual(first, second);
    assert.deepEqual(first, { rank: 2, remaining: 5 });
    // The same fixtures under a far-future clock flip deterministically,
    // proving the injected instant (not the wall clock) drives the outcome.
    const future = new Date("2030-01-01T00:00:00.000Z");
    assert.equal(pilotActivationSortRank(readyLike(), future), 0);
    assert.equal(trialDaysRemaining(trialEnd.toISOString(), future), 0);
  });
});
