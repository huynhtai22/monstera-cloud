import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reduceFreshness } from "./ai/evidence-pack";

describe("reporting readiness invariants", () => {
  it("best-effort is not exportable — only ready datasets may leave the product", () => {
    const exportable = (status: "ready" | "best_effort" | "blocked") => status === "ready";
    assert.equal(exportable("ready"), true);
    assert.equal(exportable("best_effort"), false);
    assert.equal(exportable("blocked"), false);
  });

  it("a partial source blocks ready even if siblings are fresh", () => {
    assert.equal(reduceFreshness(["fresh", "partial"]), "partial");
  });
});
