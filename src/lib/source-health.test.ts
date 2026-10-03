import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSourceHealthState } from "./source-health";

const staleBefore = new Date("2026-08-24T00:00:00.000Z");

describe("source health resolver", () => {
  it("uses durable state precedence and keeps partial distinct from error", () => {
    assert.equal(resolveSourceHealthState({
      connectionStatus: "disconnected",
      lastError: "[partial] one child failed",
      lastSyncAt: new Date("2026-08-25T00:00:00.000Z"),
      isSyncing: true,
      staleBefore,
    }), "disconnected");
    assert.equal(resolveSourceHealthState({
      connectionStatus: "connected",
      lastError: "[partial] one child failed",
      lastSyncAt: new Date("2026-08-25T00:00:00.000Z"),
      staleBefore,
    }), "partial");
    assert.equal(resolveSourceHealthState({
      connectionStatus: "connected",
      lastError: "refresh token revoked",
      lastSyncAt: new Date("2026-08-25T00:00:00.000Z"),
      staleBefore,
    }), "error");
  });

  it("never treats unknown, pending, or stale connections as fresh", () => {
    assert.equal(resolveSourceHealthState({
      connectionStatus: "mystery",
      lastError: null,
      lastSyncAt: new Date("2026-08-25T00:00:00.000Z"),
      staleBefore,
    }), "unknown");
    assert.equal(resolveSourceHealthState({
      connectionStatus: "connected",
      lastError: null,
      lastSyncAt: null,
      staleBefore,
    }), "pending");
    assert.equal(resolveSourceHealthState({
      connectionStatus: "connected",
      lastError: null,
      lastSyncAt: new Date("2026-08-20T00:00:00.000Z"),
      staleBefore,
    }), "stale");
  });

  it("distinguishes a running sync from a recent durable completion", () => {
    assert.equal(resolveSourceHealthState({
      connectionStatus: "connected",
      lastError: null,
      lastSyncAt: null,
      isSyncing: true,
      staleBefore,
    }), "syncing");
    assert.equal(resolveSourceHealthState({
      connectionStatus: "connected",
      lastError: null,
      lastSyncAt: new Date("2026-08-25T00:00:00.000Z"),
      staleBefore,
    }), "fresh");
  });

  it("does not call provider processing stuck without an attempt timestamp", () => {
    const now = new Date("2026-10-02T12:00:00.000Z");
    const base = {
      connectionStatus: "connected",
      lastError: "TikTok report task is still processing",
      lastSyncAt: null,
      now,
      staleBefore,
    };
    assert.equal(resolveSourceHealthState(base), "syncing");
    assert.equal(resolveSourceHealthState({ ...base, syncAttemptAt: new Date(now.getTime() - 60 * 60 * 1000 - 1) }), "stuck");
    assert.equal(resolveSourceHealthState({ ...base, syncAttemptAt: now }), "syncing");
  });
});
