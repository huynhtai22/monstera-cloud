import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isStaleTimestamp, STALE_AFTER_MS } from "./stale-health";

describe("stale timestamp window", () => {
  it("treats a 26h-old last sync as stale and a fresh sync as not", () => {
    const now = new Date("2026-08-19T12:00:00.000Z");
    const created = new Date("2026-08-01T00:00:00.000Z");
    assert.equal(isStaleTimestamp(new Date(now.getTime() - STALE_AFTER_MS - 1), created, now), true);
    assert.equal(isStaleTimestamp(new Date(now.getTime() - 60 * 60 * 1000), created, now), false);
    assert.equal(isStaleTimestamp(null, now, now), false);
    assert.equal(isStaleTimestamp(null, new Date(now.getTime() - STALE_AFTER_MS - 1), now), true);
  });
});
