import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateSecurityPosture } from "./security-posture";

describe("security posture SLO evaluation", () => {
  const now = new Date("2026-09-20T12:00:00Z");

  it("passes below thresholds with current retention evidence", () => {
    assert.deepEqual(evaluateSecurityPosture({
      now,
      authFailures15m: 19,
      pinRejections15m: 4,
      cronFailures30m: 0,
      lastRetentionSuccessAt: new Date("2026-09-20T11:00:00Z"),
    }), []);
  });

  it("reports every independent breach at the boundary", () => {
    assert.deepEqual(evaluateSecurityPosture({
      now,
      authFailures15m: 20,
      pinRejections15m: 5,
      cronFailures30m: 1,
      lastRetentionSuccessAt: null,
    }).map((breach) => breach.code), [
      "AUTH_FAILURE_SPIKE",
      "API_KEY_PIN_REJECTION_SPIKE",
      "CRON_FAILURE",
      "RETENTION_LAG",
    ]);
  });
});
