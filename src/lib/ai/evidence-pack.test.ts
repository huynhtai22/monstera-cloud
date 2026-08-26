import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reduceFreshness } from "./evidence-pack";

describe("reduceFreshness", () => {
  it("returns never when there are no sources", () => {
    assert.equal(reduceFreshness([]), "never");
  });

  it("lets partial win over every other state", () => {
    assert.equal(reduceFreshness(["fresh", "partial", "stale", "error"]), "partial");
  });

  it("maps source error to failed when nothing is partial", () => {
    assert.equal(reduceFreshness(["fresh", "error"]), "failed");
  });

  it("treats disconnected/pending/unknown as never unless something worse exists", () => {
    assert.equal(reduceFreshness(["disconnected", "pending", "unknown"]), "never");
    assert.equal(reduceFreshness(["fresh", "disconnected"]), "never");
  });

  it("keeps stale below refreshing and fresh", () => {
    assert.equal(reduceFreshness(["fresh", "stale"]), "stale");
    assert.equal(reduceFreshness(["fresh", "syncing"]), "refreshing");
    assert.equal(reduceFreshness(["fresh", "fresh"]), "fresh");
  });

  it("accepts already-reduced warehouse freshness that has no partial", () => {
    assert.equal(reduceFreshness(["fresh", "stale"]), "stale");
  });
});
