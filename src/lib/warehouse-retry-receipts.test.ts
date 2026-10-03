import test from "node:test";
import assert from "node:assert/strict";
import { mergeTargetedImportReceipts } from "./warehouse-retry-receipts";
const a = { connectionId: "a", provider: "meta_ads", accountId: "act_1", executionSince: "2026-09-01", executionUntil: "2026-09-07", ok: true, rowsIngested: 20 };
const b = { ...a, accountId: "act_2", ok: false, rowsIngested: 0 };
test("retry replaces a failed receipt and keeps successful targets without summing them twice", () => {
  const success = { ...b, ok: true, rowsIngested: 5 };
  assert.deepEqual(mergeTargetedImportReceipts([a, b], [success]), [a, success]);
  assert.deepEqual(mergeTargetedImportReceipts([a], [a]), [a]);
});
test("retains an unresolved failed target and keeps connections and dates distinct", () => {
  const different = { ...a, connectionId: "other", executionUntil: "2026-09-08" };
  assert.deepEqual(mergeTargetedImportReceipts([a, b], [different]), [a, b, different]);
});
test("connection-wide jobs do not borrow targeted account receipts", () => {
  const { accountId, ...legacy } = a; void accountId;
  assert.deepEqual(mergeTargetedImportReceipts([legacy], [a]), [a]);
});
