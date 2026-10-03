import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentSnapshot } from "@/hooks/use-agent-run";
import { taskPresentation } from "./task-presentation";
const base: AgentSnapshot["tasks"][number] = { id: "meta", provider: "meta_ads", state: "waiting_authorization", scopeRevision: 0, version: 0, reasonCode: null, requestedScope: null, confirmedScope: null, importJobId: null, result: null };
const approval = { provider: "meta_ads" as const, connectionId: "connection", selectedAccountIds: ["account"], since: "2026-09-23", until: "2026-09-29" };
test("a completed zero-row import remains connected without a warehouse success check", () => {
  const task = { ...base, state: "deferred" as const, confirmedScope: approval, result: { verified: false, rowsCount: 0, completedItems: 2, totalItems: 2 } };
  assert.deepEqual(taskPresentation(task), { connected: true, imported: false, importing: false, label: "Connected · saved for later" });
});
test("deferred authorization and revoked access never appear connected", () => {
  assert.equal(taskPresentation({ ...base, state: "deferred" }).connected, false);
  assert.equal(taskPresentation({ ...base, state: "needs_attention", confirmedScope: approval, reasonCode: "reconnect_required" }).connected, false);
});
test("warehouse success requires ready state, verified evidence and positive rows", () => {
  const result = { verified: true, rowsCount: 3, completedItems: 1, totalItems: 1 };
  assert.equal(taskPresentation({ ...base, state: "ready", confirmedScope: approval, result }, { verified: true, rowsCount: 3, scopeRevision: 0 }).imported, true);
  assert.equal(taskPresentation({ ...base, state: "ready", result: { ...result, rowsCount: 0 } }).imported, false);
  assert.equal(taskPresentation({ ...base, state: "importing", result }).imported, false);
  assert.equal(taskPresentation({ ...base, state: "ready", result: { ...result, verified: false } }).imported, false);
});

test("cached task receipts cannot replace a fresh warehouse confirmation", () => {
  const task = { ...base, state: "ready" as const, confirmedScope: approval, result: { verified: true, rowsCount: 3, completedItems: 1, totalItems: 1 } };
  assert.equal(taskPresentation(task).imported, false);
  assert.equal(taskPresentation(task, { verified: true, rowsCount: 0, scopeRevision: 0 }).imported, false);
  assert.equal(taskPresentation(task, { verified: true, rowsCount: 3, scopeRevision: 1 }).imported, false);
});
