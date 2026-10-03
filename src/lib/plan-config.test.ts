import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PLAN_LIMITS, PLAN_PRICING, PLAN_VND_ANNUAL_TOTALS } from "./plan-config";
import { FREE_PILOT_DAYS, freePilotEndsAt } from "./free-pilot";

describe("published plan configuration", () => {
  it("uses the agreed Agency Pro Vietnam prices", () => {
    assert.equal(PLAN_PRICING.professional.vndMonthly, 1_490_000);
    assert.equal(PLAN_VND_ANNUAL_TOTALS.professional, 14_900_000);
  });

  it("sets the free trial to seven days", () => {
    const start = new Date("2026-09-02T00:00:00.000Z");
    assert.equal(FREE_PILOT_DAYS, 7);
    assert.equal(freePilotEndsAt(start).toISOString(), "2026-09-09T00:00:00.000Z");
  });

  it("enforces a 24-hour free-plan sync cooldown", () => {
    assert.equal(PLAN_LIMITS.free.syncIntervalMs, 24 * 60 * 60 * 1000);
    assert.equal(PLAN_LIMITS.free.syncLabel, "Daily");
  });
});
