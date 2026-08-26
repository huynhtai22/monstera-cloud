import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  tiktokGmvMaxClient,
  GMV_MAX_PRODUCT_DIMENSIONS,
  GMV_MAX_LIVE_DIMENSIONS,
  GMV_MAX_METRICS,
  GMV_MAX_ATTRIBUTION_DISCLAIMER,
} from "./tiktok-gmv-max";

describe("TikTok GMV Max Reporting Client & Invariants", () => {
  test("chunkDateRange: splits date intervals into safe <=14-day slices", () => {
    const singleSlice = tiktokGmvMaxClient.chunkDateRange("2026-08-01", "2026-08-10", 14);
    assert.equal(singleSlice.length, 1);
    assert.deepEqual(singleSlice[0], { start: "2026-08-01", end: "2026-08-10" });

    const multiSlice = tiktokGmvMaxClient.chunkDateRange("2026-07-01", "2026-08-15", 14);
    assert.equal(multiSlice.length, 4);
    assert.equal(multiSlice[0].start, "2026-07-01");
    assert.equal(multiSlice[0].end, "2026-07-14");
    assert.equal(multiSlice[1].start, "2026-07-15");
    assert.equal(multiSlice[1].end, "2026-07-28");
    assert.equal(multiSlice[2].start, "2026-07-29");
    assert.equal(multiSlice[2].end, "2026-08-11");
    assert.equal(multiSlice[3].start, "2026-08-12");
    assert.equal(multiSlice[3].end, "2026-08-15");
  });

  test("dimensions & metrics: enforces clean separation between PRODUCT and LIVE", () => {
    // PRODUCT must contain item_id, never live_room_id
    assert.ok(GMV_MAX_PRODUCT_DIMENSIONS.includes("item_id"));
    assert.ok(!GMV_MAX_PRODUCT_DIMENSIONS.includes("live_room_id" as any));

    // LIVE must contain live_room_id, never item_id
    assert.ok(GMV_MAX_LIVE_DIMENSIONS.includes("live_room_id"));
    assert.ok(!GMV_MAX_LIVE_DIMENSIONS.includes("item_id" as any));

    // Metrics must only contain official verified GMV Max metrics
    assert.deepEqual(
      [...GMV_MAX_METRICS],
      ["gmv_max_cost", "gmv_max_gross_revenue", "gmv_max_orders", "gmv_max_roi"]
    );
  });

  test("attribution disclaimer: clearly explains 1-day blended attribution", () => {
    assert.ok(GMV_MAX_ATTRIBUTION_DISCLAIMER.includes("1-day blended attribution"));
    assert.ok(GMV_MAX_ATTRIBUTION_DISCLAIMER.includes("paid + organic + affiliate"));
    assert.ok(GMV_MAX_ATTRIBUTION_DISCLAIMER.includes("Do not compare with standard ad ROAS"));
  });
});
