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
  let txCount = 0;
  let txOptions: unknown;
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
    db: {
      $transaction: async (fn: (transaction: typeof tx) => Promise<unknown>, opts?: Record<string, unknown>) => {
        txCount++;
        txOptions = opts;
        return fn(tx);
      },
    },
    calls: () => calls,
    txCount: () => txCount,
    txOptions: () => txOptions as Record<string, unknown> | undefined,
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

type SnapshotSimRow = { platform: string; rawData: string | null; pulledAt: Date; date: Date };

/**
 * Simulates PostgreSQL snapshot semantics against the transaction options the
 * service actually passes: RepeatableRead answers every measurement query from
 * the transaction-start snapshot, while any other isolation answers from the
 * live store (READ COMMITTED statement snapshots). The writer hook fires after
 * the summary query resolves, modeling an import that commits mid-measurement.
 */
function snapshotFakeDb(
  initial: SnapshotSimRow[],
  cutoff: Date,
  hooks: { afterSummary?: (store: { addRow: (row: SnapshotSimRow) => void }) => void | Promise<void> },
) {
  const live: SnapshotSimRow[] = initial.map((row) => ({ ...row }));
  let snapshot: SnapshotSimRow[] | null = null;
  let txOptions: unknown;
  let queryCount = 0;
  const eligible = (rows: SnapshotSimRow[]) =>
    rows.filter((row) => row.rawData !== null && row.pulledAt < cutoff);
  const tx = {
    async $queryRaw() {
      queryCount++;
      if (queryCount === 1) return [];
      const useSnapshot = (txOptions as any)?.isolationLevel === "RepeatableRead" && snapshot !== null;
      const rows = useSnapshot ? snapshot as SnapshotSimRow[] : live;
      if (queryCount === 2) {
        const matching = eligible(rows);
        const dates = matching.map((row) => row.date.getTime());
        const pulled = matching.map((row) => row.pulledAt.getTime());
        const result = [{
          rawBearingRows: matching.length,
          eligibleRows: matching.length,
          oldestDate: matching.length ? new Date(Math.min(...dates)) : null,
          newestDate: matching.length ? new Date(Math.max(...dates)) : null,
          oldestPulledAt: matching.length ? new Date(Math.min(...pulled)) : null,
          newestPulledAt: matching.length ? new Date(Math.max(...pulled)) : null,
          metaAdNameRows: matching.filter((row) => row.platform === "meta_ads" && row.rawData!.includes('"ad_name"')).length,
          shopeeBroadRows: matching.filter((row) => row.platform === "shopee" && row.rawData!.includes('"broad_metrics"')).length,
          shopeeDirectRows: matching.filter((row) => row.platform === "shopee" && row.rawData!.includes('"direct_metrics"')).length,
          shopeeKeywordRows: matching.filter((row) => row.platform === "shopee" && row.rawData!.includes('"keyword_settings"')).length,
        }];
        await hooks.afterSummary?.({ addRow: (row) => { live.push({ ...row }); } });
        return result;
      }
      if (queryCount === 3) {
        const byPlatform = new Map<string, SnapshotSimRow[]>();
        for (const row of eligible(rows)) {
          byPlatform.set(row.platform, [...(byPlatform.get(row.platform) ?? []), row]);
        }
        return [...byPlatform.entries()].map(([platform, group]) => ({
          platform,
          eligibleRows: group.length,
          oldestDate: new Date(Math.min(...group.map((row) => row.date.getTime()))),
          newestDate: new Date(Math.max(...group.map((row) => row.date.getTime()))),
          oldestPulledAt: new Date(Math.min(...group.map((row) => row.pulledAt.getTime()))),
          newestPulledAt: new Date(Math.max(...group.map((row) => row.pulledAt.getTime()))),
        }));
      }
      return eligible(rows).map((row) => ({ platform: row.platform, bytes: Buffer.byteLength(row.rawData as string, "utf8") }));
    },
  };
  return {
    db: {
      $transaction: async (fn: (transaction: typeof tx) => Promise<unknown>, opts?: Record<string, unknown>) => {
        txOptions = opts;
        snapshot = live.map((row) => ({ ...row }));
        queryCount = 0;
        return fn(tx);
      },
    },
  };
}

describe("warehouse raw retention snapshot consistency", () => {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000);
  const oldPulledAt = new Date("2026-08-01T00:00:00.000Z");
  const oldDate = new Date("2022-01-01T00:00:00.000Z");
  const seed: SnapshotSimRow[] = [
    { platform: "meta_ads", rawData: '{"ad_name":"SNAPSHOT_SECRET_A"}', pulledAt: oldPulledAt, date: oldDate },
    { platform: "shopee", rawData: '{"broad_metrics":{},"direct_metrics":{},"keyword_settings":[1]}', pulledAt: oldPulledAt, date: oldDate },
  ];
  const lateWriter = {
    afterSummary: (store: { addRow: (row: SnapshotSimRow) => void }) => {
      store.addRow({ platform: "meta_ads", rawData: '{"late":true}', pulledAt: oldPulledAt, date: oldDate });
    },
  };

  it("opens a single RepeatableRead transaction with a budgeted timeout", async () => {
    const retention = await import("./warehouse-raw-retention") as any;
    const {
      RAW_RETENTION_MAX_TIMED_STATEMENTS,
      RAW_RETENTION_TRANSACTION_BUFFER_MS,
      RAW_RETENTION_TRANSACTION_TIMEOUT_MS,
    } = retention;
    assert.ok(
      Number.isInteger(RAW_RETENTION_MAX_TIMED_STATEMENTS) && RAW_RETENTION_MAX_TIMED_STATEMENTS >= 3,
      "the maximum timed statement count is centralized",
    );
    assert.ok(
      Number.isInteger(RAW_RETENTION_TRANSACTION_BUFFER_MS) && RAW_RETENTION_TRANSACTION_BUFFER_MS > 0,
      "the orchestration buffer is centralized",
    );
    assert.equal(
      RAW_RETENTION_TRANSACTION_TIMEOUT_MS,
      RAW_RETENTION_MAX_TIMED_STATEMENTS * RAW_RETENTION_STATEMENT_TIMEOUT_MS + RAW_RETENTION_TRANSACTION_BUFFER_MS,
      "transaction timeout covers every timed statement plus buffer",
    );
    const fixture = fakeDb({ ...summaryBase, eligibleRows: BigInt(1) }, [], []);
    await measureCampaignMetricRawRetention({ workspaceId: "ws_a", retentionDays: 30, now }, fixture.db as any);
    assert.equal(fixture.txCount(), 1, "one transaction per invocation");
    assert.equal(fixture.txOptions()?.isolationLevel, "RepeatableRead", "all measurement queries share one snapshot");
    assert.equal(fixture.txOptions()?.timeout, RAW_RETENTION_TRANSACTION_TIMEOUT_MS);
  });

  it("keeps every response section on the pre-writer snapshot", async () => {
    const fixture = snapshotFakeDb(seed, cutoff, lateWriter);
    const result = await measureCampaignMetricRawRetention(
      { workspaceId: "ws_a", retentionDays: 30, now, sampleSize: 10 },
      fixture.db as any,
    );
    assert.equal(result.exactEligibleRowCount, 2, "summary must not see the mid-measurement commit");
    const perPlatformSum = result.perPlatform.reduce((sum, row) => sum + row.exactEligibleRowCount, 0);
    assert.equal(perPlatformSum, result.exactEligibleRowCount, "sections must agree within one snapshot");
    assert.equal(result.eligibleByteEstimate.evidence, "exact", "exact bytes must describe the snapshot population");
    assert.equal(result.eligibleByteEstimate.sampleRows, 2);
    assert.equal(result.knownReaderImpact.metaAdNameRows, 1);
    assert.equal(result.knownReaderImpact.shopeeBroadMetricRows, 1);
    assert.equal(JSON.stringify(result).includes("SNAPSHOT_SECRET_A"), false, "no raw payload values leak");
  });

  it("observes rows committed after the prior snapshot on the next invocation", async () => {
    let writes = 0;
    const fixture = snapshotFakeDb(seed, cutoff, {
      afterSummary: (store) => {
        if (writes++ === 0) {
          store.addRow({ platform: "meta_ads", rawData: '{"late":true}', pulledAt: oldPulledAt, date: oldDate });
        }
      },
    });
    const first = await measureCampaignMetricRawRetention(
      { workspaceId: "ws_a", retentionDays: 30, now, sampleSize: 10 },
      fixture.db as any,
    );
    assert.equal(first.exactEligibleRowCount, 2);
    const second = await measureCampaignMetricRawRetention(
      { workspaceId: "ws_a", retentionDays: 30, now, sampleSize: 10 },
      fixture.db as any,
    );
    assert.equal(second.exactEligibleRowCount, 3, "a new invocation takes a fresh snapshot");
  });
});

describe("warehouse raw retention timeout classification", () => {
  const throwingDb = (error: unknown) => ({
    $transaction: async () => { throw error; },
  });

  it("maps PostgreSQL statement cancellation to a retention timeout", async () => {
    const { RawRetentionTimeoutError } = await import("./warehouse-raw-retention");
    await assert.rejects(
      () => measureCampaignMetricRawRetention(
        { workspaceId: "ws_a", retentionDays: 30, now },
        throwingDb({ code: "57014", message: "canceling statement due to statement timeout" }) as any,
      ),
      RawRetentionTimeoutError,
    );
  });

  it("maps Prisma P2028 transaction expiry to a retention timeout", async () => {
    const { RawRetentionTimeoutError } = await import("./warehouse-raw-retention");
    await assert.rejects(
      () => measureCampaignMetricRawRetention(
        { workspaceId: "ws_a", retentionDays: 30, now },
        throwingDb({ code: "P2028", message: "Transaction API error: Transaction expired due to timeout" }) as any,
      ),
      RawRetentionTimeoutError,
    );
    await assert.rejects(
      () => measureCampaignMetricRawRetention(
        { workspaceId: "ws_a", retentionDays: 30, now },
        throwingDb({ code: "P2028" }) as any,
      ),
      RawRetentionTimeoutError,
    );
    await assert.rejects(
      () => measureCampaignMetricRawRetention(
        { workspaceId: "ws_a", retentionDays: 30, now },
        throwingDb({ code: "P2028", message: "Transaction already closed: Transaction expired" }) as any,
      ),
      RawRetentionTimeoutError,
    );
  });

  it("leaves ordinary database errors untouched", async () => {
    for (const error of [
      new Error("boom"),
      { code: "P2002", message: "Unique constraint failed" },
      { code: "P1001", message: "Can't reach database server" },
      { code: "P2028", message: "Transaction API error: Invalid isolation level `Chaos`" },
    ]) {
      await assert.rejects(
        () => measureCampaignMetricRawRetention(
          { workspaceId: "ws_a", retentionDays: 30, now },
          throwingDb(error) as any,
        ),
        (thrown: unknown) => thrown === error,
        "non-timeout errors must propagate unchanged",
      );
    }
  });
});
