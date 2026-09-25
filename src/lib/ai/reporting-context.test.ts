import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateReportingWindows } from "./reporting-context";
import { REPORTING_METRIC_CATALOG } from "./reporting-contracts";

describe("calculateReportingWindows", () => {
  it("calculates 7 completed reporting days excluding today", () => {
    // Simulated Wednesday 2026-09-24T12:00:00Z
    const fakeNow = new Date("2026-09-24T12:00:00.000Z");
    const windows = calculateReportingWindows("last_7d", fakeNow);

    // Current: 7 completed days through yesterday (2026-09-23)
    // 2026-09-17 through 2026-09-23
    assert.equal(windows.current.end, "2026-09-23");
    assert.equal(windows.current.start, "2026-09-17");

    // Prior: immediately preceding 7 days
    // 2026-09-10 through 2026-09-16
    assert.equal(windows.prior.end, "2026-09-16");
    assert.equal(windows.prior.start, "2026-09-10");
    assert.equal(windows.daysCount, 7);
  });

  it("calculates 30 completed reporting days excluding today", () => {
    const fakeNow = new Date("2026-09-24T12:00:00.000Z");
    const windows = calculateReportingWindows("last_30d", fakeNow);

    assert.equal(windows.current.end, "2026-09-23");
    // 30 days ending on Sept 23 (Sept 23 - 29 days = Aug 25)
    assert.equal(windows.current.start, "2026-08-25");
    assert.equal(windows.prior.end, "2026-08-24");
    assert.equal(windows.daysCount, 30);
  });

  it("uses Asia/Ho_Chi_Minh wall-clock date (UTC+7)", () => {
    // At 2026-09-24T00:30:00Z, UTC date is 2026-09-24 but VN date is 2026-09-24T07:30:00+07:00
    // 'today' in VN = 2026-09-24, so 'yesterday' = 2026-09-23 (same as UTC here)
    const fakeNow = new Date("2026-09-24T00:30:00.000Z");
    const windows = calculateReportingWindows("last_7d", fakeNow, "Asia/Ho_Chi_Minh", "verified");
    assert.equal(windows.timezone, "Asia/Ho_Chi_Minh");
    assert.equal(windows.timezoneSource, "verified");
    assert.equal(windows.current.end, "2026-09-23");
    assert.equal(windows.daysCount, 7);

    // At 2026-09-23T17:30:00Z (just before midnight UTC), VN date is 2026-09-24T00:30 which is still Sep 24
    // This validates that for VN the cutoff is UTC+7 midnight, not UTC midnight
    const fakeNowEarlyUtc = new Date("2026-09-23T17:30:00.000Z"); // 00:30 Sep 24 VN
    const w2 = calculateReportingWindows("last_7d", fakeNowEarlyUtc, "Asia/Ho_Chi_Minh", "verified");
    assert.equal(w2.current.end, "2026-09-23");

    // 2026-09-23T16:30:00Z (23:30 Sep 23 VN) — today in VN is still Sep 23, yesterday is Sep 22
    const fakeNowBeforeMidnight = new Date("2026-09-23T16:30:00.000Z"); // 23:30 Sep 23 VN
    const w3 = calculateReportingWindows("last_7d", fakeNowBeforeMidnight, "Asia/Ho_Chi_Minh", "verified");
    assert.equal(w3.current.end, "2026-09-22");
  });

  it("uses America/New_York DST timezone correctly", () => {
    // Summer (EDT = UTC-4): 2026-07-15T03:30:00Z = Jul 14 23:30 EDT — today=Jul 14, yesterday=Jul 13
    const summerMidnight = new Date("2026-07-15T03:30:00.000Z");
    const wSummer = calculateReportingWindows("last_7d", summerMidnight, "America/New_York", "verified");
    assert.equal(wSummer.current.end, "2026-07-13");
    assert.equal(wSummer.timezone, "America/New_York");

    // Winter (EST = UTC-5): 2026-01-15T04:30:00Z = Jan 14 23:30 EST — today=Jan 14, yesterday=Jan 13
    const winterMidnight = new Date("2026-01-15T04:30:00.000Z");
    const wWinter = calculateReportingWindows("last_7d", winterMidnight, "America/New_York", "verified");
    assert.equal(wWinter.current.end, "2026-01-13");
  });

  it("falls back to UTC and timezoneSource=inferred for invalid/unknown timezone", () => {
    const fakeNow = new Date("2026-09-24T12:00:00.000Z");
    const windows = calculateReportingWindows("last_7d", fakeNow, "Invalid/Timezone", "verified");
    // Should degrade gracefully
    assert.equal(windows.timezone, "UTC");
    assert.equal(windows.timezoneSource, "inferred");
    assert.equal(windows.current.end, "2026-09-23"); // UTC yesterday
  });

  it("keeps prior and current windows equal-length", () => {
    const fakeNow = new Date("2026-09-24T12:00:00.000Z");
    for (const preset of ["last_7d", "last_30d"] as const) {
      const w = calculateReportingWindows(preset, fakeNow);
      const currentDays =
        (new Date(`${w.current.end}T00:00:00Z`).getTime() -
          new Date(`${w.current.start}T00:00:00Z`).getTime()) /
          86_400_000 + 1;
      const priorDays =
        (new Date(`${w.prior.end}T00:00:00Z`).getTime() -
          new Date(`${w.prior.start}T00:00:00Z`).getTime()) /
          86_400_000 + 1;
      assert.equal(currentDays, priorDays, `Period lengths must match for ${preset}`);
      assert.equal(currentDays, w.daysCount);
    }
  });
});

describe("REPORTING_METRIC_CATALOG", () => {
  it("contains all required supported metrics with strict semantic contracts", () => {
    const requiredMetrics = [
      "spend",
      "impressions",
      "clicks",
      "cpc",
      "ctr",
      "conversions",
      "cost_per_conversion",
      "roas",
      "marketplace_orders",
      "marketplace_revenue",
    ] as const;

    for (const id of requiredMetrics) {
      const def = REPORTING_METRIC_CATALOG[id];
      assert.ok(def, `Missing definition for metric ${id}`);
      assert.equal(def.id, id);
      assert.ok(def.name.length > 0);
      assert.ok(def.requiredInputs.length > 0);
      assert.ok(def.semanticLimitations.length > 0);
    }

    // Verify conversions has warning against claiming unique buyers
    assert.ok(
      REPORTING_METRIC_CATALOG.conversions.semanticLimitations.some((lim) =>
        lim.includes("unique buyers"),
      ),
    );

    // Verify cost_per_conversion warning against labeling as CAC
    assert.ok(
      REPORTING_METRIC_CATALOG.cost_per_conversion.semanticLimitations.some((lim) =>
        lim.includes("Customer Acquisition Cost"),
      ),
    );

    // Verify marketplace orders is separate from conversions
    assert.ok(
      REPORTING_METRIC_CATALOG.marketplace_orders.semanticLimitations.some((lim) =>
        lim.includes("separate from ad-platform conversions"),
      ),
    );
  });
});
