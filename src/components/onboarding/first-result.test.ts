import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmedFirstResultTasks, firstResultAccounts, firstResultKey, type FirstResultPreviews } from "./first-result";
import type { AgentSnapshot } from "@/hooks/use-agent-run";
const task = { id: "task", provider: "meta_ads", state: "ready", scopeRevision: 2, version: 4, confirmedScope: { selectedAccountIds: ["populated"], since: "2026-09-23", until: "2026-09-29" } } as AgentSnapshot["tasks"][number];
const previews = { task: { scopeRevision: 2, data: { provider: "meta_ads", verified: true, rowsCount: 5, window: { since: "2026-09-23", until: "2026-09-29" }, sampleRows: [{ date: "2026-09-24", accountId: "act_1" }], accounts: [{ id: "populated", accountId: "act_1", groups: [{ rows: 5 }] }] } } } as unknown as FirstResultPreviews;
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

test("first overview shows populated accounts before applying its display cap", () => {
  const data = { ...previews.task.data, accounts: [
    ...Array.from({ length: 3 }, (_, index) => ({ id: `empty-${index}`, groups: [] })),
    ...Array.from({ length: 4 }, (_, index) => ({ id: `populated-${index}`, groups: [{ rows: 1 }] })),
  ] } as unknown as FirstResultPreviews[string]["data"];
  assert.deepEqual(firstResultAccounts(data).map(account => account.id), ["populated-0", "populated-1", "populated-2"]);
  const noAccounts = { ...data, accounts: [] };
  assert.equal(confirmedFirstResultTasks([task], { task: { ...previews.task, data: noAccounts } }).length, 0);
});

test("first result rejects missing rows, unapproved accounts and rows outside the approved window", () => {
  assert.equal(confirmedFirstResultTasks([{ ...task, confirmedScope: { ...task.confirmedScope!, selectedAccountIds: ["populated", "missing"] } }], previews).length, 0);
  const base = previews.task;
  for (const data of [
    { ...base.data, sampleRows: [] },
    { ...base.data, accounts: [{ ...base.data.accounts[0], id: "not-approved" }] },
    { ...base.data, sampleRows: [{ ...base.data.sampleRows[0], accountId: "other" }] },
    { ...base.data, sampleRows: [{ ...base.data.sampleRows[0], date: "2026-09-30" }] },
  ]) assert.equal(confirmedFirstResultTasks([task], { task: { ...base, data } }).length, 0);
});
