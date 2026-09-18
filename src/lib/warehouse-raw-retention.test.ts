import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  MAX_RAW_RETENTION_SAMPLE_SIZE,
  measureCampaignMetricRawRetention,
  RAW_RETENTION_STATEMENT_TIMEOUT_MS,
  RawRetentionInputError,
} from "./warehouse-raw-retention";

const now = new Date("2026-09-18T12:00:00.000Z");

const summaryBase = {
  rawBearingRows: BigInt(8),
  oldestDate: new Date("2022-01-01T00:00:00.000Z"),
  newestDate: new Date("2025-01-01T00:00:00.000Z"),
  oldestPulledAt: new Date("2026-06-01T00:00:00.000Z"),
  newestPulledAt: new Date("2026-08-01T00:00:00.000Z"),
  metaAdNameRows: BigInt(1),
  shopeeBroadRows: BigInt(1),
  shopeeDirectRows: BigInt(1),
  shopeeKeywordRows: BigInt(1),
};

function fakeDb(summary: Record<string, unknown>, platformExact: Array<Record<string, unknown>>, sample: Array<Record<string, unknown>>) {
  let calls = 0;
  const tx = {
    async $queryRaw() {
      calls++;
      if (calls === 1) return [];
      if (calls === 2) return [summary];
      if (calls === 3) return platformExact;
      return sample;
    },
  };
  return {
    db: { $transaction: async (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx) },
    calls: () => calls,
  };
}

const metaExact = [{
  platform: "meta_ads",
  eligibleRows: BigInt(3),
  oldestDate: new Date("2022-01-01T00:00:00.000Z"),
  newestDate: new Date("2025-01-01T00:00:00.000Z"),
  oldestPulledAt: new Date("2026-06-01T00:00:00.000Z"),
  newestPulledAt: new Date("2026-08-01T00:00:00.000Z"),
}];

describe("warehouse raw retention dry-run", () => {
  it("accepts exactly 14, 30, and 90 day policies", async () => {
    for (const retentionDays of [14, 30, 90] as const) {
      const fixture = fakeDb(
        { ...summaryBase, eligibleRows: BigInt(3) },
        metaExact,
        [
          { platform: "meta_ads", bytes: BigInt(60) },
          { platform: "meta_ads", bytes: BigInt(40) },
          { platform: "meta_ads", bytes: BigInt(50) },
        ],
      );
      const result = await measureCampaignMetricRawRetention({ workspaceId: "ws_a", retentionDays, now }, fixture.db as any);
      assert.equal(result.retentionPolicy.days, retentionDays);
      assert.equal(result.dryRun, true);
      assert.equal(result.wouldMutate, false);
      assert.equal(result.executionAvailable, false);
    }
  });

  it("fails closed for missing, fractional, negative, NaN, and unsupported policies before SQL", async () => {
    for (const retentionDays of [undefined, 0, -14, 14.5, Number.NaN, 15] as const) {
      const fixture = fakeDb({ ...summaryBase, eligibleRows: BigInt(0) }, [], []);
      await assert.rejects(
        () => measureCampaignMetricRawRetention({ workspaceId: "ws_a", retentionDays: retentionDays as any, now }, fixture.db as any),
        RawRetentionInputError,
      );
      assert.equal(fixture.calls(), 0);
    }
  });

  it("labels a fully measured small set exact without returning payloads", async () => {
    const fixture = fakeDb(
      { ...summaryBase, eligibleRows: BigInt(3) },
      metaExact,
      [
        { platform: "meta_ads", bytes: BigInt(60) },
        { platform: "meta_ads", bytes: BigInt(40) },
        { platform: "meta_ads", bytes: BigInt(50) },
      ],
    );
    const result = await measureCampaignMetricRawRetention({ workspaceId: "ws_a", retentionDays: 30, now, sampleSize: 10 }, fixture.db as any);
    assert.equal(result.exactEligibleRowCount, 3);
    assert.equal(result.eligibleByteEstimate.evidence, "exact");
    assert.equal(result.eligibleByteEstimate.bytes, 150);
    assert.equal(result.eligibleByteEstimate.sampleRows, 3);
    assert.equal(result.eligibleByteEstimate.sampleMethod, "bounded-unsorted-scan");
    assert.equal(result.eligibleByteEstimate.sampleLimit, 10);
    assert.equal(result.perPlatform[0]?.sampledByteEstimate.evidence, "exact");
    assert.equal(result.knownReaderImpact.metaAdNameRows, 1);
    assert.equal(result.knownReaderImpact.shopeeBroadMetricRows, 1);
    assert.equal(result.statementTimeoutMs, RAW_RETENTION_STATEMENT_TIMEOUT_MS);
    assert.equal(JSON.stringify(result).includes("SECRET_RAW"), false);
    assert.equal(fixture.calls(), 4, "measurement issues only SET LOCAL and SELECT queries");
  });

  it("labels a capped large-set physical sample as sampled and keeps exact counts", async () => {
    const summary = { ...summaryBase, eligibleRows: BigInt(300) };
    const exact = [{ ...metaExact[0], eligibleRows: BigInt(300) }];
    const sample = [
      { platform: "meta_ads", bytes: BigInt(60) },
      { platform: "meta_ads", bytes: BigInt(40) },
    ];
    const first = fakeDb(summary, exact, sample);
    const result = await measureCampaignMetricRawRetention({ workspaceId: "ws_a", retentionDays: 30, now, sampleSize: 2 }, first.db as any);
    assert.equal(result.exactEligibleRowCount, 300);
    assert.equal(result.eligibleByteEstimate.evidence, "sampled");
    assert.equal(result.eligibleByteEstimate.bytes, 15000);
    assert.equal(result.eligibleByteEstimate.sampleRows, 2);
    assert.equal(result.eligibleByteEstimate.sampleMethod, "tablesample-system-10");
    assert.equal(result.byteSampling.method, "tablesample-system-10");
    assert.equal(result.byteSampling.sampleLimit, 2);
    assert.ok(result.byteSampling.sampleRows <= 2, "sample cap is enforced before aggregation");
    assert.equal(result.perPlatform[0]?.sampledByteEstimate.evidence, "sampled");

    const second = fakeDb(summary, exact, []);
    const rerun = await measureCampaignMetricRawRetention({ workspaceId: "ws_a", retentionDays: 30, now, sampleSize: 100 }, second.db as any);
    assert.equal(rerun.exactEligibleRowCount, 300, "exact counts do not depend on the byte sample");
  });

  it("reports unknown instead of a false zero-byte estimate when nothing was sampled", async () => {
    const fixture = fakeDb({ ...summaryBase, eligibleRows: BigInt(5) }, [{ ...metaExact[0], eligibleRows: BigInt(5) }], []);
    const result = await measureCampaignMetricRawRetention({ workspaceId: "ws_a", retentionDays: 30, now, sampleSize: 2 }, fixture.db as any);
    assert.equal(result.exactEligibleRowCount, 5);
    assert.equal(result.eligibleByteEstimate.evidence, "unknown");
    assert.equal(result.eligibleByteEstimate.bytes, null);
    assert.equal(result.perPlatform[0]?.sampledByteEstimate.evidence, "unknown");
    assert.equal(result.perPlatform[0]?.sampledByteEstimate.bytes, null);
  });

  it("never ranks or sorts the eligible population while sampling", () => {
    const source = readFileSync(new URL("./warehouse-raw-retention.ts", import.meta.url), "utf8").toLowerCase();
    for (const forbidden of ["row_number(", "over (partition", "windowagg", "dense_rank(", "rank("]) {
      assert.equal(source.includes(forbidden), false, `sampling must not use ${forbidden}`);
    }
    assert.ok(source.includes("tablesample system"), "large sets use a physical page sample");
  });

  it("bounds sample size before SQL", async () => {
    for (const sampleSize of [0, -1, 1.5, Number.NaN, MAX_RAW_RETENTION_SAMPLE_SIZE + 1] as const) {
      const fixture = fakeDb({ ...summaryBase, eligibleRows: BigInt(0) }, [], []);
      await assert.rejects(
        () => measureCampaignMetricRawRetention({ workspaceId: "ws_a", retentionDays: 30, sampleSize: sampleSize as any, now }, fixture.db as any),
        RawRetentionInputError,
      );
      assert.equal(fixture.calls(), 0);
    }
  });
});
