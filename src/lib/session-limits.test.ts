import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deviceLabelFromRequest,
  maxConcurrentSessionsForPlan,
  selectExpiredGraceSessionsToRevoke,
  selectSessionsToRevoke,
  sessionRegistrationPolicy,
  SESSION_GRACE_DURATION_MS,
} from "./session-limits";
import { PLAN_LIMITS } from "./plan-config";

function slot(id: string, lastSeenAt: string): { id: string; lastSeenAt: Date } {
  return { id, lastSeenAt: new Date(lastSeenAt) };
}

describe("session caps per plan (P1)", () => {
  it("exposes flexible concurrent-session allowances", () => {
    assert.equal(maxConcurrentSessionsForPlan("free"), 3);
    assert.equal(maxConcurrentSessionsForPlan("starter"), 4);
    assert.equal(maxConcurrentSessionsForPlan("professional"), 8);
    assert.equal(maxConcurrentSessionsForPlan("pilot"), 8);
    assert.equal(maxConcurrentSessionsForPlan("enterprise"), 15);
    assert.equal(maxConcurrentSessionsForPlan("unknown-plan"), PLAN_LIMITS.free.maxConcurrentSessions);
  });
});

describe("selectSessionsToRevoke (P1)", () => {
  it("revokes nothing when under the cap", () => {
    assert.deepEqual(selectSessionsToRevoke([slot("a", "2026-09-01")], 2), []);
    assert.deepEqual(selectSessionsToRevoke([], 2), []);
  });

  it("revokes the least-recently-seen sessions first (revoke-oldest)", () => {
    const existing = [
      slot("newest", "2026-09-10"),
      slot("oldest", "2026-09-01"),
      slot("middle", "2026-09-05"),
    ];
    // Cap of 2 total including the incoming login => keep 1 existing + new.
    assert.deepEqual(selectSessionsToRevoke(existing, 2), ["oldest", "middle"]);
  });

  it("revokes exactly the overflow on a full house", () => {
    const existing = [slot("a", "2026-09-01"), slot("b", "2026-09-02")];
    // Cap 2 total => 1 slot left for existing => revoke oldest 1.
    assert.deepEqual(selectSessionsToRevoke(existing, 2), ["a"]);
  });
});

describe("24-hour flexible overflow allowance", () => {
  const now = new Date("2026-09-20T00:00:00.000Z");

  it("does not use grace below the normal allowance", () => {
    const decision = sessionRegistrationPolicy([
      slot("a", "2026-09-19T10:00:00.000Z"),
    ], 3, now);
    assert.deepEqual(decision, { revokeIds: [], graceEndsAt: null });
  });

  it("grants one extra browser for exactly 24 hours", () => {
    const decision = sessionRegistrationPolicy([
      slot("a", "2026-09-19T10:00:00.000Z"),
      slot("b", "2026-09-19T11:00:00.000Z"),
      slot("c", "2026-09-19T12:00:00.000Z"),
    ], 3, now);
    assert.deepEqual(decision.revokeIds, []);
    assert.equal(decision.graceEndsAt?.getTime(), now.getTime() + SESSION_GRACE_DURATION_MS);
  });

  it("preserves the existing deadline and revokes only the oldest above the hard ceiling", () => {
    const liveGrace = new Date("2026-09-20T12:00:00.000Z");
    const decision = sessionRegistrationPolicy([
      { ...slot("oldest", "2026-09-19T09:00:00.000Z"), graceEndsAt: liveGrace },
      slot("b", "2026-09-19T10:00:00.000Z"),
      slot("c", "2026-09-19T11:00:00.000Z"),
      slot("d", "2026-09-19T12:00:00.000Z"),
    ], 3, now);
    assert.deepEqual(decision.revokeIds, ["oldest"]);
    assert.equal(decision.graceEndsAt?.getTime(), liveGrace.getTime());
  });

  it("returns to the normal allowance after grace and preserves the current browser when possible", () => {
    const rows = [
      { ...slot("oldest", "2026-09-19T09:00:00.000Z"), jti: "oldest-jti", graceEndsAt: new Date("2026-09-19T23:00:00.000Z") },
      { ...slot("middle", "2026-09-19T10:00:00.000Z"), jti: "middle-jti" },
      { ...slot("new", "2026-09-19T11:00:00.000Z"), jti: "new-jti" },
      { ...slot("current", "2026-09-19T08:00:00.000Z"), jti: "current-jti" },
    ];
    assert.deepEqual(
      selectExpiredGraceSessionsToRevoke(rows, 3, now, "current-jti"),
      ["oldest"],
    );
  });

  it("does not clean up while a grace deadline is live", () => {
    const rows = [
      { ...slot("a", "2026-09-19T09:00:00.000Z"), jti: "a", graceEndsAt: new Date("2026-09-20T01:00:00.000Z") },
      { ...slot("b", "2026-09-19T10:00:00.000Z"), jti: "b" },
      { ...slot("c", "2026-09-19T11:00:00.000Z"), jti: "c" },
      { ...slot("d", "2026-09-19T12:00:00.000Z"), jti: "d" },
    ];
    assert.deepEqual(selectExpiredGraceSessionsToRevoke(rows, 3, now, "d"), []);
  });
});

describe("privacy-safe device labels", () => {
  it("stores a coarse label instead of the raw user agent", () => {
    const request = new Request("https://example.test", {
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36",
      },
    });
    assert.equal(deviceLabelFromRequest(request), "Chrome on Mac");
    assert.equal(deviceLabelFromRequest(null), null);
  });
});
