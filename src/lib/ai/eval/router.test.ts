import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { routeModel } from "@/lib/ai/model-router";

describe("eval judge uses a second path, not the generator", () => {
  it("eval_judge is deterministic until a second vendor key exists", () => {
    const judge = routeModel("eval_judge");
    const narrative = routeModel("narrative");
    assert.equal(judge.provider, "deterministic");
    assert.notEqual(judge.provider, narrative.provider);
  });
});
