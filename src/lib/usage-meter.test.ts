import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recordUsage, utcDayBucket } from "./usage-meter";

describe("usage meter", () => {
  it("buckets timestamps at UTC midnight regardless of local offset", () => {
    assert.equal(
      utcDayBucket(new Date("2026-09-20T23:59:59.999-07:00")).toISOString(),
      "2026-09-21T00:00:00.000Z",
    );
    assert.equal(
      utcDayBucket(new Date("2026-09-20T00:00:00.000Z")).toISOString(),
      "2026-09-20T00:00:00.000Z",
    );
  });

  it("uses one upsert with only the requested counter incremented", async () => {
    const calls: unknown[] = [];
    await recordUsage("ws-1", "keyHit", {
      now: new Date("2026-09-20T13:14:15.000Z"),
      delegate: { upsert: async (args) => { calls.push(args); } },
    });

    assert.deepEqual(calls, [{
      where: { workspaceId_date: { workspaceId: "ws-1", date: new Date("2026-09-20T00:00:00.000Z") } },
      create: {
        workspaceId: "ws-1",
        date: new Date("2026-09-20T00:00:00.000Z"),
        queryCount: 0,
        importCount: 0,
        keyHitCount: 1,
      },
      update: {
        queryCount: { increment: 0 },
        importCount: { increment: 0 },
        keyHitCount: { increment: 1 },
      },
    }]);
  });

  it("fails open when storage rejects", async () => {
    await assert.doesNotReject(recordUsage("ws-1", "query", {
      delegate: { upsert: async () => { throw new Error("database unavailable"); } },
    }));
  });

  it("does nothing for an empty workspace id", async () => {
    let called = false;
    await recordUsage("", "import", {
      delegate: { upsert: async () => { called = true; } },
    });
    assert.equal(called, false);
  });
});
