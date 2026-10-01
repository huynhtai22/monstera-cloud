import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmedFirstResultTasks, firstResultKey, type FirstResultPreviews } from "./first-result";
import type { AgentSnapshot } from "@/hooks/use-agent-run";
const task = { id: "task", provider: "meta_ads", state: "ready", scopeRevision: 2, version: 4, confirmedScope: { since: "2026-09-23", until: "2026-09-29" } } as AgentSnapshot["tasks"][number];
const previews = { task: { scopeRevision: 2, data: { provider: "meta_ads", verified: true, rowsCount: 5, window: { since: "2026-09-23", until: "2026-09-29" }, accounts: [] } } } as unknown as FirstResultPreviews;
test("first result excludes zero rows, unfinished sources, stale approvals and mismatched dates", () => {
  assert.equal(confirmedFirstResultTasks([task], previews).length, 1);
  assert.equal(confirmedFirstResultTasks([{ ...task, state: "deferred" }], previews).length, 0);
  assert.equal(confirmedFirstResultTasks([{ ...task, scopeRevision: 3 }], previews).length, 0);
  assert.equal(confirmedFirstResultTasks([task], { task: { ...previews.task, data: { ...previews.task.data, rowsCount: 0 } } }).length, 0);
  assert.equal(confirmedFirstResultTasks([task], { task: { ...previews.task, data: { ...previews.task.data, window: { since: "2026-09-01", until: "2026-09-29" } } } }).length, 0);
});
test("acknowledgment becomes stale when evidence, account approval or workspace changes", () => {
  const snapshot = { run: { id: "run" }, tasks: [task] } as AgentSnapshot;
  const key = firstResultKey(snapshot, previews);
  assert.equal(firstResultKey(snapshot, { ...previews }), key);
  assert.notEqual(firstResultKey({ ...snapshot, tasks: [{ ...task, scopeRevision: 3 }] }, previews), key);
  assert.notEqual(firstResultKey({ ...snapshot, run: { ...snapshot.run, id: "other-run" } }, previews), key);
  assert.notEqual(firstResultKey(snapshot, { task: { ...previews.task, data: { ...previews.task.data, rowsCount: 6 } } }), key);
});
