import test from "node:test";
import assert from "node:assert/strict";
import { ConfirmScopeInputSchema } from "./contracts";
import { DateSchema, initialImportWindow } from "./execution-contracts";

test("scope input rejects impossible dates, empty selection and invalid versions", () => {
  const input = { selectedAccountIds: ["1001"], since: "2026-09-20", until: "2026-09-26", expectedVersion: 1 };
  assert.equal(ConfirmScopeInputSchema.safeParse(input).success, true);
  for (const change of [{ selectedAccountIds: [] }, { since: "2026-02-30" }, { expectedVersion: -1 }, { expectedVersion: 1.5 }]) {
    assert.equal(ConfirmScopeInputSchema.safeParse({ ...input, ...change }).success, false);
  }
  assert.equal(DateSchema.safeParse("2024-02-29").success, true);
  assert.equal(DateSchema.safeParse("2026-02-29").success, false);
});

test("initial import always contains seven complete UTC reporting dates across month and leap boundaries", () => {
  assert.deepEqual(initialImportWindow(new Date("2026-10-01T23:59:59Z")), { since: "2026-09-24", until: "2026-09-30" });
  assert.deepEqual(initialImportWindow(new Date("2024-03-01T00:00:00Z")), { since: "2024-02-23", until: "2024-02-29" });
});
