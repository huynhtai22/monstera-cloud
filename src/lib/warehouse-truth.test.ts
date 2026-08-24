import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveDataThrough, resolveWarehouseEmptyState } from "./warehouse-truth";
import { countSourceHealthStatuses } from "./source-health";

describe("warehouse truthfulness — data through", () => {
  it("uses the real latest data date, never the selected range end", () => {
    assert.equal(resolveDataThrough("2026-08-18T00:00:00.000Z"), "2026-08-18T00:00:00.000Z");
  });

  it("returns null when the warehouse has no data (must not fabricate a date)", () => {
    assert.equal(resolveDataThrough(null), null);
    assert.equal(resolveDataThrough(undefined), null);
  });
});

describe("warehouse truthfulness — empty states", () => {
  it("zero rows + no warehouse data anywhere → no-data", () => {
    assert.equal(resolveWarehouseEmptyState(0, null), "no-data");
    assert.equal(resolveWarehouseEmptyState(0, undefined), "no-data");
  });

  it("zero matching rows but warehouse data exists → filter-empty", () => {
    assert.equal(resolveWarehouseEmptyState(0, "2026-08-18T00:00:00.000Z"), "filter-empty");
  });

  it("visible rows → not-empty", () => {
    assert.equal(resolveWarehouseEmptyState(5, "2026-08-18T00:00:00.000Z"), "not-empty");
    assert.equal(resolveWarehouseEmptyState(5, null), "not-empty");
  });
});

describe("source health counts — partial is not connected", () => {
  it("buckets partial separately from connected", () => {
    const counts = countSourceHealthStatuses([
      { status: "connected" },
      { status: "partial" },
      { status: "partial" },
      { status: "error" },
      { status: "available" },
    ]);
    assert.deepEqual(counts, { connected: 1, needsAttention: 1, available: 1, partial: 2 });
  });

  it("all-connected workspaces report zero partial", () => {
    assert.deepEqual(
      countSourceHealthStatuses([{ status: "connected" }, { status: "connected" }]),
      { connected: 2, needsAttention: 0, available: 0, partial: 0 },
    );
  });
});
