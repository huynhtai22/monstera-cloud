import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickDataThroughDate, shouldRefreshLastDataThrough } from "./connection-data-through";

describe("pickDataThroughDate", () => {
  it("prefers the stored connection date over a live fallback", () => {
    const stored = new Date("2026-08-20T00:00:00.000Z");
    const fallback = new Date("2026-08-25T00:00:00.000Z");
    assert.equal(pickDataThroughDate(stored, fallback)?.toISOString(), stored.toISOString());
  });

  it("falls back to MAX(date) when the column is still null", () => {
    const fallback = new Date("2026-08-18T00:00:00.000Z");
    assert.equal(pickDataThroughDate(null, fallback)?.toISOString(), fallback.toISOString());
  });

  it("returns null rather than fabricating a date", () => {
    assert.equal(pickDataThroughDate(null, null), null);
    assert.equal(pickDataThroughDate(undefined, "not-a-date"), null);
  });
});

describe("shouldRefreshLastDataThrough", () => {
  it("advances only on full success", () => {
    assert.equal(shouldRefreshLastDataThrough("success"), true);
    assert.equal(shouldRefreshLastDataThrough("partial"), false);
    assert.equal(shouldRefreshLastDataThrough("failed"), false);
  });
});
