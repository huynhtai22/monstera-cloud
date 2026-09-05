import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildArtifact } from "./foundation";
import { evaluateGoogleGateA } from "./google-gate-a";
import type { RuntimeArtifact } from "./types";

const BASE = {
  workspaceId: "ws-1",
  connectionId: "conn-1",
  runId: "run-1",
  provider: "google_ads",
} as const;

function artifactSet(overrides: Partial<Record<string, unknown>> = {}): RuntimeArtifact[] {
  return (["connection", "report", "warehouse", "reconciliation"] as const).map((kind) =>
    buildArtifact({ ...BASE, kind, payload: { kind, ...(overrides as object) } }),
  );
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    provider: "google_ads",
    runId: "run-1",
    artifacts: artifactSet(),
    warehouse: { rowsWritten: 120, zeroRowJustified: false },
    reconciliation: {
      variances: [
        { metric: "spend", percentVariance: 1.2 },
        { metric: "impressions", percentVariance: 0 },
      ],
      tolerancePercent: 5,
    },
    ...overrides,
  };
}

describe("Google Gate A evaluation", () => {
  it("passes a complete, in-tolerance run", () => {
    const result = evaluateGoogleGateA(input());
    assert.equal(result.verdict, "PASS");
    assert.deepEqual(result.reasons, []);
    assert.equal(result.artifactHashes.length, 4);
  });

  it("fails when a required artifact kind is missing", () => {
    const artifacts = artifactSet().filter((a) => a.kind !== "warehouse");
    const result = evaluateGoogleGateA(input({ artifacts }));
    assert.equal(result.verdict, "FAIL");
    assert.ok(result.reasons.some((r) => r === "missing-artifact:warehouse"));
  });

  it("fails on tampered artifact content", () => {
    const artifacts = artifactSet();
    artifacts[1] = { ...artifacts[1], payload: { kind: "report", forged: true } };
    const result = evaluateGoogleGateA(input({ artifacts }));
    assert.equal(result.verdict, "FAIL");
    assert.ok(result.reasons.some((r) => r === "integrity-failure:report"));
  });

  it("fails on reconciliation variance beyond tolerance", () => {
    const result = evaluateGoogleGateA(
      input({
        reconciliation: {
          variances: [{ metric: "spend", percentVariance: 12.5 }],
          tolerancePercent: 5,
        },
      }),
    );
    assert.equal(result.verdict, "FAIL");
    assert.ok(result.reasons.some((r) => r === "variance-breach:spend"));
  });

  it("fails on unjustified zero rows, passes justified ones", () => {
    const failed = evaluateGoogleGateA(input({ warehouse: { rowsWritten: 0, zeroRowJustified: false } }));
    assert.equal(failed.verdict, "FAIL");
    assert.ok(failed.reasons.includes("zero-rows-unjustified"));

    const passed = evaluateGoogleGateA(input({ warehouse: { rowsWritten: 0, zeroRowJustified: true } }));
    assert.equal(passed.verdict, "PASS");
  });

  it("rejects Meta and TikTok until Google Gate A passes", () => {
    for (const provider of ["meta_ads", "tiktok_business"]) {
      const artifacts = (["connection", "report", "warehouse", "reconciliation"] as const).map((kind) =>
        buildArtifact({ ...BASE, provider, kind, payload: { kind } }),
      );
      const result = evaluateGoogleGateA(input({ provider, artifacts }));
      assert.equal(result.verdict, "FAIL");
      assert.ok(result.reasons.some((r) => r.startsWith("provider-not-in-scope")));
    }
  });

  it("rejects unknown provider identifiers", () => {
    const result = evaluateGoogleGateA(input({ provider: "shopee" }));
    assert.equal(result.verdict, "FAIL");
    assert.ok(result.reasons.some((r) => r.startsWith("unknown-provider")));
  });

  it("rejects artifacts from another run or provider", () => {
    const artifacts = artifactSet();
    artifacts[0] = { ...artifacts[0], runId: "run-2" };
    const foreign = evaluateGoogleGateA(input({ artifacts }));
    assert.equal(foreign.verdict, "FAIL");
    assert.ok(foreign.reasons.some((r) => r.startsWith("foreign-run-artifact")));
  });
});
