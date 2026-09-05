import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_ARTIFACTS_PER_RUN,
  MAX_ARTIFACT_BYTES,
  RUN_ARTIFACT_RETENTION_DAYS,
  assertConnectorProviderId,
} from "./types";
import {
  assertArtifactBounds,
  buildArtifact,
  forbiddenReplayGateway,
  hashArtifactPayload,
  isArtifactRetained,
  replayGateAEvaluation,
  retainedUntilFor,
  verifyArtifactIntegrity,
  type ReplayGateway,
} from "./foundation";
import type { RuntimeArtifact } from "./types";

function makeArtifact(overrides: Omit<Partial<RuntimeArtifact>, "createdAt"> & { createdAt?: Date } = {}): RuntimeArtifact {
  return buildArtifact({
    workspaceId: "ws-1",
    connectionId: "conn-1",
    runId: "run-1",
    provider: "google_ads",
    kind: "report",
    payload: { rows: 10 },
    createdAt: new Date("2026-09-04T00:00:00.000Z"),
    ...overrides,
  });
}

describe("connector provider identifiers are strings only", () => {
  it("accepts the three known provider strings", () => {
    assert.equal(assertConnectorProviderId("google_ads"), "google_ads");
    assert.equal(assertConnectorProviderId("meta_ads"), "meta_ads");
    assert.equal(assertConnectorProviderId("tiktok_business"), "tiktok_business");
  });

  it("rejects non-strings, unknown strings and objects", () => {
    for (const bad of [undefined, null, 42, {}, [], "GOOGLE_ADS", "google-ads", ""]) {
      assert.throws(() => assertConnectorProviderId(bad), /Unknown connector provider/);
    }
  });
});

describe("30-day retention metadata", () => {
  it("stamps retainedUntil exactly 30 days after creation", () => {
    assert.equal(RUN_ARTIFACT_RETENTION_DAYS, 30);
    const created = new Date("2026-09-04T12:00:00.000Z");
    assert.equal(
      retainedUntilFor(created).toISOString(),
      new Date("2026-10-04T12:00:00.000Z").toISOString(),
    );
    const artifact = makeArtifact();
    assert.equal(artifact.retainedUntil, "2026-10-04T00:00:00.000Z");
  });

  it("reports retained vs expired relative to now", () => {
    const artifact = makeArtifact();
    assert.equal(isArtifactRetained(artifact, new Date("2026-09-05T00:00:00.000Z")), true);
    assert.equal(isArtifactRetained(artifact, new Date("2026-10-05T00:00:00.000Z")), false);
  });
});

describe("bounded immutable artifacts", () => {
  it("accepts a set within count and byte bounds", () => {
    assertArtifactBounds([makeArtifact(), makeArtifact({ kind: "warehouse" })]);
  });

  it("rejects more than MAX_ARTIFACTS_PER_RUN artifacts", () => {
    const tooMany = Array.from({ length: MAX_ARTIFACTS_PER_RUN + 1 }, (_, i) =>
      makeArtifact({ kind: `kind-${i}` }),
    );
    assert.throws(() => assertArtifactBounds(tooMany), /exceeds bound/);
  });

  it("rejects an oversized payload", () => {
    const big = makeArtifact({ payload: { blob: "x".repeat(MAX_ARTIFACT_BYTES) } });
    assert.throws(() => assertArtifactBounds([big]), /exceeds bound/);
  });

  it("hash is deterministic regardless of key order", () => {
    assert.equal(
      hashArtifactPayload({ b: 1, a: { y: 2, x: 1 } }),
      hashArtifactPayload({ a: { x: 1, y: 2 }, b: 1 }),
    );
  });

  it("detects stored-payload tampering", () => {
    const artifact = makeArtifact();
    verifyArtifactIntegrity(artifact);
    const tampered = { ...artifact, payload: { rows: 999 } };
    assert.throws(() => verifyArtifactIntegrity(tampered), /integrity failure/);
  });
});

describe("zero-provider-call replay", () => {
  function countingGateway(): ReplayGateway & { calls: number } {
    const gateway = {
      calls: 0,
      fetchReport: async () => {
        gateway.calls += 1;
        return null;
      },
      fetchAccount: async () => {
        gateway.calls += 1;
        return null;
      },
    };
    return gateway;
  }

  it("pure evaluation completes with zero gateway calls and identical verdict", () => {
    const artifacts = [makeArtifact()];
    const evaluate = (loaded: RuntimeArtifact[]) => ({ count: loaded.length });
    const gateway = countingGateway();
    const result = replayGateAEvaluation(artifacts, gateway, evaluate);
    assert.deepEqual(result, { count: 1 });
    assert.equal(gateway.calls, 0);
  });

  it("forbidden gateway throws on any provider use", async () => {
    const gateway = forbiddenReplayGateway();
    await assert.rejects(() => gateway.fetchReport({}), /forbidden during replay/);
    await assert.rejects(() => gateway.fetchAccount({}), /forbidden during replay/);
  });

  it("replay refuses tampered or over-bound sets before evaluating", () => {
    const tampered = { ...makeArtifact(), payload: { rows: 0 } };
    assert.throws(
      () => replayGateAEvaluation([tampered], countingGateway(), () => "evaluated"),
      /integrity failure/,
    );
  });
});
