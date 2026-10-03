import assert from "node:assert/strict";
import { test } from "node:test";
import { countConsoleConnections, groupConsoleConnections } from "./console-connections";
import { resolveSourceHealthState } from "./source-health";
import { sourceStateFor } from "./source-list-display";

test("counts all saved records and retains duplicates in manager groups", () => {
  const rows = [
    { id: "a", provider: "tiktok_business", managerBadge: "BC: 12" },
    { id: "b", provider: "tiktok_business", managerBadge: "BC: 12" },
    { id: "c", provider: "meta_ads", managerBadge: "BC: 12" },
    { id: "d", provider: "tiktok_business", managerBadge: null },
  ];
  assert.equal(countConsoleConnections(rows), 4);
  assert.deepEqual(groupConsoleConnections(rows).map(group => group.map(row => row.id)), [["a", "b"], ["c"], ["d"]]);
});

test("old provider reports are stuck while recent attempts remain syncing", () => {
  const now = new Date("2026-09-30T00:00:00Z");
  const input = { connectionStatus: "connected", lastError: "TikTok report task is still processing; will resume this task automatically", lastSyncAt: new Date("2026-09-27"), staleBefore: new Date("2026-09-29"), now };
  assert.equal(resolveSourceHealthState({ ...input, syncAttemptAt: "2026-09-27" }), "stuck");
  assert.equal(resolveSourceHealthState({ ...input, syncAttemptAt: "2026-09-29T23:45:00Z" }), "syncing");
  assert.equal(resolveSourceHealthState({ ...input, connectionStatus: "disconnected" }), "disconnected");
  assert.equal(resolveSourceHealthState({ ...input, connectionStatus: "error", syncAttemptAt: "2026-09-27" }), "stuck");
  const state = sourceStateFor({ id: "a", name: "TikTok", status: "connected", healthState: "stuck", lastSync: "2026-09-27" }, false);
  assert.equal(state.kind, "stuck");
  assert.equal(state.canSync, true);
});

test("active jobs time out using their start time rather than the last successful import", () => {
  assert.equal(resolveSourceHealthState({ connectionStatus: "connected", lastError: null, lastSyncAt: null, isSyncing: true, syncStartedAt: "2026-09-27", now: new Date("2026-09-30"), staleBefore: new Date("2026-09-29") }), "stuck");
});
