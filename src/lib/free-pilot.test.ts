import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FREE_PILOT_DAYS, freePilotEndsAt } from "./free-pilot";

describe("free pilot", () => {
  it("provides exactly seven days of Agency Pro trial time", () => {
    const start = new Date("2026-09-02T00:00:00.000Z");
    assert.equal(FREE_PILOT_DAYS, 7);
    assert.equal(freePilotEndsAt(start).toISOString(), "2026-09-09T00:00:00.000Z");
  });
});
