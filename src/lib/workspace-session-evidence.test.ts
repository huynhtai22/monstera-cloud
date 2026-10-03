import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateWorkspaceDeviceSignals,
  recordWorkspaceSessionEvidence,
} from "./workspace-session-evidence";

describe("workspace session evidence", () => {
  it("upserts an authorized workspace/session tuple without raw request identity", async () => {
    const calls: unknown[] = [];
    await recordWorkspaceSessionEvidence({
      workspaceId: "ws-1",
      userId: "user-1",
      sessionJti: "jti-1",
      now: new Date("2026-09-20T10:00:00.000Z"),
      request: { headers: { "x-forwarded-for": "192.0.2.10", "user-agent": "Browser/1.0" } },
      delegate: { upsert: async (args) => { calls.push(args); } },
    });
    assert.equal(calls.length, 1);
    const serialized = JSON.stringify(calls[0]);
    assert.equal(serialized.includes("192.0.2.10"), false);
    assert.equal(serialized.includes("Browser/1.0"), false);
    assert.match(serialized, /workspaceId_sessionJti/);
  });

  it("does nothing for grandfathered sessions without a jti", async () => {
    let called = false;
    await recordWorkspaceSessionEvidence({
      workspaceId: "ws-1",
      userId: "user-1",
      sessionJti: null,
      delegate: { upsert: async () => { called = true; } },
    });
    assert.equal(called, false);
  });

  it("fails open when evidence storage is unavailable", async () => {
    await assert.doesNotReject(recordWorkspaceSessionEvidence({
      workspaceId: "ws-1",
      userId: "user-1",
      sessionJti: "jti-1",
      delegate: { upsert: async () => { throw new Error("database unavailable"); } },
    }));
  });

  it("aggregates only the supplied workspace-scoped rows", () => {
    const result = aggregateWorkspaceDeviceSignals([
      { userId: "u1", sessionJti: "s1", ipHash: "i1", uaHash: "a1", lastSeenAt: new Date("2026-09-20T10:00:00Z") },
      { userId: "u1", sessionJti: "s2", ipHash: "i2", uaHash: "a1", lastSeenAt: new Date("2026-09-20T11:00:00Z") },
      { userId: "u2", sessionJti: "s3", ipHash: null, uaHash: "a2", lastSeenAt: new Date("2026-09-20T09:00:00Z") },
    ]);
    assert.deepEqual(result.get("u1"), {
      activeDevices: 2,
      distinctIps: 2,
      distinctBrowsers: 1,
      lastSeenAt: new Date("2026-09-20T11:00:00Z"),
    });
    assert.equal(result.get("u2")?.activeDevices, 1);
  });
});
