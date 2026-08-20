import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeImportJob, formatAge } from "./import-job-status";

describe("import job status copy", () => {
  it("does not imply a queued job is already running", () => {
    const view = describeImportJob({
      status: "queued",
      retryCount: 0,
      maxRetries: 3,
    });
    assert.equal(view.tone, "queued");
    assert.match(view.title, /queued/i);
    assert.match(view.detail, /15 minutes/i);
    assert.doesNotMatch(view.detail, /refreshing/i);
  });

  it("surfaces heartbeat and retry while running", () => {
    const now = Date.parse("2026-08-19T12:00:00.000Z");
    const view = describeImportJob(
      {
        status: "running",
        completedItems: 1,
        totalItems: 4,
        approximateRows: 1200,
        retryCount: 1,
        maxRetries: 3,
        heartbeatAt: "2026-08-19T11:59:40.000Z",
      },
      now,
    );
    assert.equal(view.tone, "running");
    assert.match(view.title, /1\/4/);
    assert.match(view.detail, /heartbeat 20s ago/);
    assert.match(view.detail, /retry 1\/3/);
  });

  it("does not present a partial import as finished", () => {
    const view = describeImportJob({
      status: "partial",
      completedItems: 1,
      totalItems: 2,
      errorMsg: "Partial import: advertiser 123 was rate limited",
    });
    assert.equal(view.tone, "partial");
    assert.match(view.title, /partial/i);
    assert.match(view.detail, /rate limited/i);
  });

  it("formats compact ages", () => {
    const now = Date.parse("2026-08-19T12:00:00.000Z");
    assert.equal(formatAge("2026-08-19T11:59:50.000Z", now), "10s ago");
    assert.equal(formatAge(null, now), null);
  });
});

