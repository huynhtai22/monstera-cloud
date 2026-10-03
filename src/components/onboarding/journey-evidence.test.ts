import test from "node:test";
import assert from "node:assert/strict";
import { importItemProgress } from "./journey-evidence";

test("uses only valid observed item counts, including genuine zero", () => {
  assert.deepEqual(importItemProgress(0, 3), { completed: 0, total: 3 });
  assert.deepEqual(importItemProgress(2, 3), { completed: 2, total: 3 });
  assert.deepEqual(importItemProgress(3, 3), { completed: 3, total: 3 });
});
test("does not synthesize progress for unknown, inconsistent or malformed counts", () => {
  for (const [completed, total] of [[null, 3], [0, null], [0, 0], [4, 3], [-1, 3], [1.5, 3], [1, Infinity], [NaN, 2]]) {
    assert.equal(importItemProgress(completed, total), null);
  }
});
