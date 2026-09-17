import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateStorageGate,
  evaluateServingGate,
  modelCapacityScenario,
  recommendQualification,
  CAPACITY_SCENARIOS,
  MEASURED_INDEX_OVERHEAD_FRACTION,
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
      serving: [
        evaluateServingGate({ query: "q", p50Ms: 1, p95Ms: 10, rowCount: 1, sequentialScan: false, bounded: true }),
      ],
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
