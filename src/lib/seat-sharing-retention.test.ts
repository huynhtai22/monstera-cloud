import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_RETENTION_BATCH, retentionCutoff, SEAT_SHARING_RETENTION_DAYS } from "./seat-sharing-retention";

describe("seat-sharing telemetry retention", () => {
  it("uses an exact rolling 90-day cutoff", () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    assert.equal(SEAT_SHARING_RETENTION_DAYS, 90);
    assert.equal(
      retentionCutoff(now).getTime(),
      now.getTime() - 90 * 24 * 60 * 60 * 1000,
    );
  });

  it("keeps cleanup batches bounded", () => {
    assert.equal(MAX_RETENTION_BATCH, 1_000);
  });
});
