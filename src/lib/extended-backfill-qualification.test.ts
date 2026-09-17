import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateStorageGate,
  evaluateServingGate,
  modelCapacityScenario,
  recommendQualification,
  CAPACITY_SCENARIOS,
  MEASURED_INDEX_OVERHEAD_FRACTION,
  REQUIRED_SERVING_QUERIES,
} from "./extended-backfill-qualification";

describe("storage gate (production code)", () => {
  it("passes below 60% and fails at or above it", () => {
    const pass = evaluateStorageGate({ estimatedNewBytes: 100, provisionedBytes: 1000, usedBytes: 400 });
    assert.equal(pass.status, "pass");
    assert.equal(pass.projectedBytes, 500);
    assert.equal(pass.projectedFraction, 0.5);
    const fail = evaluateStorageGate({ estimatedNewBytes: 200, provisionedBytes: 1000, usedBytes: 400 });
    assert.equal(fail.status, "fail");
    assert.equal(fail.projectedFraction, 0.6);
  });

  it("fails closed on unknown inputs", () => {
    for (const inputs of [
      { estimatedNewBytes: null, provisionedBytes: 1000, usedBytes: 1 },
      { estimatedNewBytes: 1, provisionedBytes: null, usedBytes: 1 },
      { estimatedNewBytes: 1, provisionedBytes: 1000, usedBytes: null },
      { estimatedNewBytes: 1, provisionedBytes: 0, usedBytes: 1 },
    ] as const) {
      assert.equal(evaluateStorageGate(inputs).status, "unknown");
    }
  });
});

describe("serving gates (production code)", () => {
  it("enforces p95 targets, boundedness, and index usage", () => {
    assert.equal(
      evaluateServingGate({ query: "q", p50Ms: 10, p95Ms: 100, rowCount: 50, sequentialScan: false, bounded: true }).status,
      "pass",
    );
    assert.equal(
      evaluateServingGate({ query: "q", p50Ms: 10, p95Ms: 1600, rowCount: 50, sequentialScan: false, bounded: true }).status,
      "fail",
    );
    assert.equal(
      evaluateServingGate({ query: "job-progress-polling", p50Ms: 10, p95Ms: 600, rowCount: 50, sequentialScan: false, bounded: true }).status,
      "fail",
    );
    assert.equal(
      evaluateServingGate({ query: "q", p50Ms: 10, p95Ms: 100, rowCount: 50, sequentialScan: true, bounded: true }).status,
      "fail",
    );
    assert.equal(
      evaluateServingGate({ query: "q", p50Ms: 10, p95Ms: 100, rowCount: 50, sequentialScan: true, bounded: true, allowFullScan: true, fullScanJustification: "Full-range two-group aggregate must visit every row." }).status,
      "pass",
    );
    assert.equal(
      evaluateServingGate({ query: "q", p50Ms: 10, p95Ms: 100, rowCount: 50, sequentialScan: true, bounded: true, allowFullScan: true }).status,
      "fail",
    );
    assert.equal(
      evaluateServingGate({ query: "q", p50Ms: 10, p95Ms: 100, rowCount: 50, sequentialScan: false, bounded: false }).status,
      "fail",
    );
    assert.equal(
      evaluateServingGate({ query: "q", p50Ms: null, p95Ms: null, rowCount: null, sequentialScan: false, bounded: true }).status,
      "unknown",
    );
  });
});

describe("capacity scenarios (production code)", () => {
  it("models exact row arithmetic with labeled estimates", () => {
    const pilot = modelCapacityScenario({ ...CAPACITY_SCENARIOS.pilot, bytesPerRow: 512 });
    assert.equal(pilot.totalRows, 5 * 3 * 20 * 731);
    assert.equal(pilot.dailyRowGrowth, 5 * 3 * 20);
    assert.equal(pilot.monthlyRowGrowth, 5 * 3 * 20 * 30);
    assert.equal(pilot.tableBytes, pilot.totalRows * 512);
    assert.equal(pilot.indexBytes, Math.round(pilot.tableBytes * MEASURED_INDEX_OVERHEAD_FRACTION));
    assert.equal(pilot.totalBytes, pilot.tableBytes + pilot.indexBytes);
    assert.equal(pilot.withHeadroomBytes, Math.round(pilot.totalBytes / 0.6));
    assert.equal(pilot.expectedProviderCalls, 5 * 3 * Math.ceil(731 / 30));
    assert.ok(pilot.assumptions.length >= 3);

    const growth = modelCapacityScenario({ ...CAPACITY_SCENARIOS.growth, bytesPerRow: 512 });
    assert.equal(growth.totalRows, 50 * 5 * 50 * 731);
    const high = modelCapacityScenario({ ...CAPACITY_SCENARIOS.highScale, bytesPerRow: 512 });
    assert.equal(high.totalRows, 200 * 8 * 100 * 731);
    assert.ok(high.totalBytes > growth.totalBytes && growth.totalBytes > pilot.totalBytes);
  });

  it("rejects invalid inputs instead of guessing", () => {
    for (const patch of [{ workspaces: 0 }, { days: -1 }, { bytesPerRow: 0 }, { bytesPerRow: NaN }]) {
      assert.throws(() => modelCapacityScenario({ ...CAPACITY_SCENARIOS.pilot, bytesPerRow: 512, ...patch }));
    }
  });
});

describe("release recommendation (production code)", () => {
  function base() {
    return {
      storage: evaluateStorageGate({ estimatedNewBytes: 100, provisionedBytes: 1000, usedBytes: 100 }),
      serving: REQUIRED_SERVING_QUERIES.map((query) => ({
        query,
        status: "pass" as const,
        reason: `${query} passes.`,
      })),
      workerInvariantsHold: true as boolean | null,
      providerBudgetKnown: true,
      metaLiveCleared: false,
      missingOwnerInputs: [] as string[],
    };
  }

  it("recommends staging only when every gate passes", () => {
    const { recommendation } = recommendQualification(base());
    assert.equal(recommendation, "ready-for-staging");
  });

  it("blocks on missing inputs and fails closed otherwise", () => {
    assert.equal(
      recommendQualification({ ...base(), missingOwnerInputs: ["DB storage limit"] }).recommendation,
      "blocked-missing-inputs",
    );
    assert.equal(
      recommendQualification({ ...base(), storage: evaluateStorageGate({ estimatedNewBytes: 900, provisionedBytes: 1000, usedBytes: 100 }) }).recommendation,
      "not-ready",
    );
    assert.equal(
      recommendQualification({ ...base(), workerInvariantsHold: null }).recommendation,
      "not-ready",
    );
    assert.equal(
      recommendQualification({ ...base(), providerBudgetKnown: false }).recommendation,
      "not-ready",
    );
    assert.equal(
      recommendQualification({ ...base(), metaLiveCleared: true }).recommendation,
      "not-ready",
    );
  });

  it("never recommends production activation", () => {
    const { recommendation, reasons } = recommendQualification(base());
    assert.ok(recommendation !== ("production" as never));
    assert.ok(!reasons.join(" ").toLowerCase().includes("production activation"));
  });
});

describe("serving-evidence completeness (production code)", () => {
  const recommend = recommendQualification;

  function passingSet() {
    return REQUIRED_SERVING_QUERIES.map((query: string) => ({
      query, status: "pass" as const, reason: `${query} passes.`,
    }));
  }

  function baseWithServing(serving: { query: string; status: "pass" | "fail" | "unknown"; reason: string }[]) {
    return {
      storage: { status: "pass" as const, projectedBytes: 500, projectedFraction: 0.5, headroomFraction: 0.6, reason: "ok." },
      serving,
      workerInvariantsHold: true as boolean | null,
      providerBudgetKnown: true,
      metaLiveCleared: false,
      missingOwnerInputs: [] as string[],
    };
  }

  it("empty serving evidence cannot produce readiness", () => {
    const { recommendation, reasons } = recommend(baseWithServing([]));
    assert.notEqual(recommendation, "ready-for-staging");
    assert.ok(reasons.join(" ").includes("SERVING_EVIDENCE_REQUIRED"));
  });

  it("missing serving evidence cannot produce readiness", () => {
    const partial = passingSet().slice(0, REQUIRED_SERVING_QUERIES.length - 1);
    const { recommendation, reasons } = recommend(baseWithServing(partial));
    assert.notEqual(recommendation, "ready-for-staging");
    assert.ok(reasons.join(" ").includes("SERVING_EVIDENCE_REQUIRED"));
  });

  it("a complete passing serving set may still become ready", () => {
    const { recommendation } = recommend(baseWithServing(passingSet()));
    assert.equal(recommendation, "ready-for-staging");
  });

  it("one failed required serving check remains rejected", () => {
    const failing = passingSet().map((gate: { query: string; status: "pass"; reason: string }, index: number) =>
      index === 0 ? { ...gate, status: "fail" as const, reason: "p95 over target." } : gate,
    );
    const { recommendation } = recommend(baseWithServing(failing));
    assert.notEqual(recommendation, "ready-for-staging");
  });

  it("unknown serving evidence stays distinguishable from measured failure", () => {
    const withUnknown = passingSet().map((gate: { query: string; status: "pass"; reason: string }, index: number) =>
      index === 0 ? { ...gate, status: "unknown" as const, reason: "No measurement available." } : gate,
    );
    const unknownResult = recommend(baseWithServing(withUnknown));
    const failedResult = recommend(baseWithServing(
      passingSet().map((gate: { query: string; status: "pass"; reason: string }, index: number) =>
        index === 0 ? { ...gate, status: "fail" as const, reason: "p95 over target." } : gate,
      ),
    ));
    assert.notEqual(unknownResult.recommendation, "ready-for-staging");
    assert.notEqual(failedResult.recommendation, "ready-for-staging");
    assert.notDeepEqual(unknownResult.reasons, failedResult.reasons);
  });
});

describe("provider call-rate demand (production code)", () => {
  function scenario(rate: unknown) {
    return modelCapacityScenario({
      workspaces: 5, connectionsPerWorkspace: 3, entitiesPerConnectionPerDay: 20,
      days: 731, bytesPerRow: 512, providerCallsPerConnectionPerDay: rate as number,
    });
  }

  it("a positive rate changes calculated demand", () => {
    const without = modelCapacityScenario({
      workspaces: 5, connectionsPerWorkspace: 3, entitiesPerConnectionPerDay: 20, days: 731, bytesPerRow: 512,
    });
    assert.equal(without.expectedProviderCalls, 5 * 3 * Math.ceil(731 / 30));
    const withRate = scenario(2);
    assert.ok(withRate.expectedProviderCalls > without.expectedProviderCalls);
  });

  it("scales monotonically and doubles proportionally", () => {
    assert.ok(scenario(2).expectedProviderCalls > scenario(1).expectedProviderCalls);
    assert.ok(scenario(3).expectedProviderCalls > scenario(2).expectedProviderCalls);
    const one = scenario(1).expectedProviderCalls;
    const two = scenario(2).expectedProviderCalls;
    const base = 5 * 3 * Math.ceil(731 / 30);
    assert.equal(two - base, 2 * (one - base));
  });

  it("handles zero explicitly and rejects invalid rates", () => {
    const zero = scenario(0);
    assert.equal(zero.expectedProviderCalls, 5 * 3 * Math.ceil(731 / 30));
    assert.equal(zero.rollingRefetchCalls, 0);
    assert.ok(zero.assumptions.join(" ").includes("0"));
    // Fractional rates express sub-daily cadence and are supported.
    const half = scenario(0.5);
    assert.equal(half.rollingRefetchCalls, Math.ceil(0.5 * 15 * 731));
    for (const bad of [-1, NaN, Infinity, -Infinity, "2" as unknown as number, null as unknown as number]) {
      assert.throws(() => scenario(bad), Error);
    }
  });

  it("multiplies rate by connections and days exactly once", () => {
    const result = scenario(2);
    const backfillPass = 5 * 3 * Math.ceil(731 / 30);
    const rollingRefetch = 2 * (5 * 3) * 731;
    assert.equal(result.expectedProviderCalls, backfillPass + rollingRefetch);
    assert.ok(result.assumptions.join(" ").includes(`${rollingRefetch}`));
  });

  it("overflow is rejected with checked arithmetic", () => {
    assert.throws(
      () =>
        modelCapacityScenario({
          workspaces: 1_000_000, connectionsPerWorkspace: 1000, entitiesPerConnectionPerDay: 20,
          days: 731, bytesPerRow: 512, providerCallsPerConnectionPerDay: 1_000_000,
        }),
      Error,
    );
  });

  it("demand beyond a known quota blocks readiness; unknown quota stays blocked", () => {
    const over = recommendQualification({
      storage: { status: "pass" as const, projectedBytes: 1, projectedFraction: 0.1, headroomFraction: 0.6, reason: "ok." },
      serving: REQUIRED_SERVING_QUERIES.map((query: string) => ({ query, status: "pass" as const, reason: "ok." })),
      workerInvariantsHold: true as boolean | null,
      providerBudgetKnown: true,
      metaLiveCleared: false,
      missingOwnerInputs: [] as string[],
      providerCallDemand: 1_000_000,
      providerCallQuota: 100,
    });
    assert.notEqual(over.recommendation, "ready-for-staging");
    assert.ok(over.reasons.join(" ").includes("PROVIDER_CALL_BUDGET_EXCEEDED"));
    const unknownQuota = recommendQualification({
      storage: { status: "pass" as const, projectedBytes: 1, projectedFraction: 0.1, headroomFraction: 0.6, reason: "ok." },
      serving: REQUIRED_SERVING_QUERIES.map((query: string) => ({ query, status: "pass" as const, reason: "ok." })),
      workerInvariantsHold: true as boolean | null,
      providerBudgetKnown: true,
      metaLiveCleared: false,
      missingOwnerInputs: [] as string[],
      providerCallDemand: 50,
      providerCallQuota: null,
    });
    assert.notEqual(unknownQuota.recommendation, "ready-for-staging");
  });
});
