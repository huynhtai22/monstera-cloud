import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WAREHOUSE_SNAPSHOT_MAX_WAIT_MS,
  WAREHOUSE_SNAPSHOT_TIMEOUT_MS,
} from "./warehouse-query";

/**
 * The warehouse snapshot read runs rows, count, aggregates and metadata
 * inside one interactive transaction. Prisma defaults such transactions to
 * five seconds, so the explicit budget must stay above that default or large
 * exports regress to fail-closed timeouts.
 */
describe("warehouse snapshot transaction budget", () => {
  it("keeps an explicit timeout above the Prisma interactive default", () => {
    assert.equal(typeof WAREHOUSE_SNAPSHOT_TIMEOUT_MS, "number");
    assert.ok(WAREHOUSE_SNAPSHOT_TIMEOUT_MS > 5_000);
    assert.equal(typeof WAREHOUSE_SNAPSHOT_MAX_WAIT_MS, "number");
    assert.ok(WAREHOUSE_SNAPSHOT_MAX_WAIT_MS >= 2_000);
  });
});
