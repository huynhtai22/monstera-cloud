import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareShadowRun } from "./shadow";

describe("shadow-mode comparison", () => {
  it("matches when legacy success agrees with a v1 PASS", () => {
    const result = compareShadowRun(
      { outcome: "success", rowsIngested: 120 },
      { verdict: "PASS", reasons: [], artifactHashes: ["abc"], evaluatedAt: new Date().toISOString() },
    );
    assert.equal(result.match, true);
    assert.deepEqual(result.differences, []);
  });

  it("reports outcome mismatch without side effects", () => {
    const result = compareShadowRun(
      { outcome: "success", rowsIngested: 120 },
      { verdict: "FAIL", reasons: ["missing-artifact:warehouse"], artifactHashes: [], evaluatedAt: new Date().toISOString() },
    );
    assert.equal(result.match, false);
    assert.ok(result.differences.some((d) => d.startsWith("outcome-mismatch")));
  });

  it("flags a legacy success that ingested nothing", () => {
    const result = compareShadowRun(
      { outcome: "success", rowsIngested: 0 },
      { verdict: "PASS", reasons: [], artifactHashes: [], evaluatedAt: new Date().toISOString() },
    );
    assert.equal(result.match, false);
    assert.ok(result.differences.some((d) => d.startsWith("rows-mismatch")));
  });

  it("matches when both sides agree the run failed", () => {
    const result = compareShadowRun(
      { outcome: "failed", rowsIngested: 0, error: "provider timeout" },
      { verdict: "FAIL", reasons: ["variance-breach:spend"], artifactHashes: [], evaluatedAt: new Date().toISOString() },
    );
    assert.equal(result.match, true);
  });

  it("keeps the legacy error text for operator triage on disagreement", () => {
    const result = compareShadowRun(
      { outcome: "failed", rowsIngested: 0, error: "customer not enabled" },
      { verdict: "PASS", reasons: [], artifactHashes: [], evaluatedAt: new Date().toISOString() },
    );
    assert.equal(result.match, false);
    assert.ok(result.differences.some((d) => d.includes("customer not enabled")));
  });
});
