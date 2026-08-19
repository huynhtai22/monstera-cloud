import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatRunDiagnostics, mapWarehouseJobToRun } from "./runs";

describe("run mapping", () => {
  it("marks a completed job with failed items as partial and copies ids", () => {
    const run = mapWarehouseJobToRun({
      id: "wjob_1",
      workspaceId: "ws-a",
      status: "completed",
      approximateRows: 12,
      retryCount: 2,
      maxRetries: 3,
      errorMsg: null,
      startedAt: new Date("2026-08-19T10:00:00.000Z"),
      finishedAt: new Date("2026-08-19T10:00:05.000Z"),
      createdAt: new Date("2026-08-19T10:00:00.000Z"),
      heartbeatAt: new Date("2026-08-19T10:00:04.000Z"),
      items: [{ connectionId: "conn-1" }],
      results: [
        { ok: true, connectionId: "conn-1" },
        { ok: false, connectionId: "conn-1", error: "429 rate limit" },
      ],
    });
    assert.equal(run.status, "partial");
    assert.equal(run.tag, "[quota]");
    assert.equal(run.action, "wait_quota");
    assert.equal(run.durationMs, 5000);
    assert.match(formatRunDiagnostics(run), /workspaceId=ws-a/);
    assert.match(formatRunDiagnostics(run), /connectionId=conn-1/);
  });
});
