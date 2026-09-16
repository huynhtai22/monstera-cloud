import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateChunkStates,
  chunkIdFor,
  chunkResultsForModal,
  isExtendedBackfillExecutionEnabled,
  isMissingChunkTableError,
  sanitizeChunkError,
  validateChunkSpecs,
  type BackfillChunkRecord,
} from "./warehouse-backfill-chunks";
import { planHistoricalBackfill } from "./historical-backfill-plan";
import { HistoricalBackfillPlanningError } from "./historical-backfill-plan";

function record(overrides: Partial<BackfillChunkRecord> & { id: string }): BackfillChunkRecord {
  return {
    workspaceId: "ws",
    jobId: "job",
    connectionId: "conn",
    provider: "meta_ads",
    accountId: "",
    since: "2026-08-01",
    until: "2026-08-30",
    ordinal: 0,
    status: "queued",
    attempts: 0,
    maxAttempts: 3,
    persistedRows: 0,
    leaseId: null,
    leaseExpiresAt: null,
    fencingToken: BigInt(0),
    lastErrorCode: null,
    lastError: null,
    heartbeatAt: null,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function days(since: string, until: string): number {
  return Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000) + 1;
}

describe("checkpoint chunk specs and validation (production code)", () => {
  it("produces deterministic stable IDs per logical slice", () => {
    const spec = { connectionId: "c1", accountId: "", since: "2026-07-02", until: "2026-07-31" };
    assert.equal(chunkIdFor("job-1", spec), chunkIdFor("job-1", spec));
    assert.match(chunkIdFor("job-1", spec), /^wchk_[a-f0-9]{24}$/);
    assert.notEqual(chunkIdFor("job-1", spec), chunkIdFor("job-2", spec));
    assert.notEqual(
      chunkIdFor("job-1", spec),
      chunkIdFor("job-1", { ...spec, since: "2026-07-03" }),
    );
  });

  it("accepts 1-day and 30-day ranges", () => {
    validateChunkSpecs([
      { connectionId: "c", accountId: "", provider: "meta_ads", since: "2024-02-29", until: "2024-02-29", ordinal: 0 },
    ]);
    assert.equal(days("2024-02-29", "2024-02-29"), 1);
    validateChunkSpecs([
      { connectionId: "c", accountId: "", provider: "meta_ads", since: "2026-07-02", until: "2026-07-31", ordinal: 0 },
    ]);
    validateChunkSpecs([
      { connectionId: "c", accountId: "123", provider: "google_ads", since: "2026-07-02", until: "2026-07-31", ordinal: 0 },
    ]);
  });

  it("rejects 31-day Meta/Google slices", () => {
    for (const provider of ["meta_ads", "google_ads"] as const) {
      assert.throws(
        () =>
          validateChunkSpecs([
            { connectionId: "c", accountId: "", provider, since: "2026-07-01", until: "2026-07-31", ordinal: 0 },
          ]),
        /REQUEST_CHUNKING_NOT_IMPLEMENTED/,
      );
    }
  });

  it("keeps non-Meta/Google windows free of slice-span policy", () => {
    for (const provider of ["tiktok_business", "shopee", "lazada"] as const) {
      validateChunkSpecs([
        { connectionId: "c", accountId: "", provider, since: "2026-06-01", until: "2026-08-29", ordinal: 0 },
      ]);
    }
  });

  it("rejects timestamps, impossible dates, and reversed ranges via the canonical helper", () => {
    for (const [since, until] of [
      ["2024-02-01T00:00:00Z", "2024-02-02"],
      ["2024-02-30", "2024-03-01"],
      ["2026-08-02", "2026-08-01"],
    ] as const) {
      assert.throws(
        () => validateChunkSpecs([{ connectionId: "c", accountId: "", provider: "meta_ads", since, until, ordinal: 0 }]),
        /INVALID_DATE_RANGE/,
      );
    }
  });

  it("requires string account IDs", () => {
    assert.throws(
      () =>
        validateChunkSpecs([
          { connectionId: "c", accountId: 123 as unknown as string, provider: "meta_ads", since: "2026-08-01", until: "2026-08-01", ordinal: 0 },
        ]),
      /INVALID_CHUNK_SPEC/,
    );
  });

  it("covers 90-day plans exactly with no gaps or overlaps in newest-first order", () => {
    const plan = planHistoricalBackfill({ provider: "meta_ads", since: "2026-06-01", until: "2026-08-29", asOf: "2026-08-29" });
    assert.equal(plan.chunks.length, 3);
    const specs = plan.chunks.map((chunk) => ({
      connectionId: "c",
      accountId: "",
      provider: "meta_ads",
      since: chunk.since,
      until: chunk.until,
      ordinal: chunk.ordinal,
    }));
    validateChunkSpecs(specs);
    assert.deepEqual(specs.map((spec) => spec.ordinal), [0, 1, 2]);
    assert.equal(specs[0]!.until, "2026-08-29");
    assert.equal(specs[2]!.since, "2026-06-01");
    const seen = new Set<string>();
    for (const spec of specs) {
      assert.ok(days(spec.since, spec.until) <= 30);
      for (let cursor = Date.parse(`${spec.since}T00:00:00Z`); cursor <= Date.parse(`${spec.until}T00:00:00Z`); cursor += 86_400_000) {
        const day = new Date(cursor).toISOString().slice(0, 10);
        assert.equal(seen.has(day), false, `duplicate day ${day}`);
        seen.add(day);
      }
    }
    assert.equal(seen.size, 90);
  });

  it("keeps 365-day and 731-day planning visible but refuses executable totals", () => {
    const plan = planHistoricalBackfill({ provider: "meta_ads", since: "2022-03-01", until: "2024-02-29", asOf: "2024-03-01" });
    assert.equal(plan.requestedRange.days, 731);
    assert.equal(plan.executionAllowed, false);
    const specs = plan.chunks.map((chunk) => ({
      connectionId: "c",
      accountId: "",
      provider: "meta_ads",
      since: chunk.since,
      until: chunk.until,
      ordinal: chunk.ordinal,
    }));
    assert.throws(() => validateChunkSpecs(specs), /EXTENDED_EXECUTION_NOT_ALLOWED/);
  });

  it("covers leap-day boundaries inclusively", () => {
    validateChunkSpecs([
      { connectionId: "c", accountId: "", provider: "google_ads", since: "2024-02-28", until: "2024-03-01", ordinal: 0 },
    ]);
    assert.equal(days("2024-02-28", "2024-03-01"), 3);
  });

  it("keeps extended execution behind a default-off env flag that requests cannot set", () => {
    assert.equal(isExtendedBackfillExecutionEnabled({} as unknown as NodeJS.ProcessEnv), false);
    assert.equal(isExtendedBackfillExecutionEnabled({ EXTENDED_BACKFILL_EXECUTION_ENABLED: "false" } as unknown as NodeJS.ProcessEnv), false);
    assert.equal(isExtendedBackfillExecutionEnabled({ EXTENDED_BACKFILL_EXECUTION_ENABLED: "true" } as unknown as NodeJS.ProcessEnv), true);
    const plan = planHistoricalBackfill({ provider: "google_ads", since: "2022-03-01", until: "2024-02-29", asOf: "2024-03-01" });
    const specs = plan.chunks.map((chunk) => ({
      connectionId: "c",
      accountId: "",
      provider: "google_ads" as const,
      since: chunk.since,
      until: chunk.until,
      ordinal: chunk.ordinal,
    }));
    validateChunkSpecs(specs, { EXTENDED_BACKFILL_EXECUTION_ENABLED: "true" } as unknown as NodeJS.ProcessEnv);
    assert.ok(validateChunkSpecs instanceof Function);
    assert.ok(HistoricalBackfillPlanningError);
  });
});

describe("parent aggregation from persisted chunk states (production code)", () => {
  it("reports queued when nothing started", () => {
    const aggregation = aggregateChunkStates([record({ id: "a" }), record({ id: "b", ordinal: 1 })]);
    assert.equal(aggregation.status, "queued");
    assert.equal(aggregation.totalChunks, 2);
    assert.equal(aggregation.queuedChunks, 2);
  });

  it("reports running while work remains", () => {
    assert.equal(aggregateChunkStates([record({ id: "a", status: "running" })]).status, "running");
    const mixed = aggregateChunkStates([
      record({ id: "a", status: "completed", persistedRows: 10 }),
      record({ id: "b", ordinal: 1 }),
    ]);
    assert.equal(mixed.status, "running");
    assert.equal(mixed.approximateRows, 10);
  });

  it("reports completed only when every chunk completed", () => {
    const aggregation = aggregateChunkStates([
      record({ id: "a", status: "completed", persistedRows: 7 }),
      record({ id: "b", ordinal: 1, status: "completed", persistedRows: 5 }),
    ]);
    assert.equal(aggregation.status, "completed");
    assert.equal(aggregation.approximateRows, 12);
    assert.deepEqual(aggregation.completedCoverage, { since: "2026-08-01", until: "2026-08-30" });
  });

  it("reports partial and failed truthfully, never hiding unfinished work", () => {
    const partial = aggregateChunkStates([
      record({ id: "a", status: "completed", persistedRows: 4 }),
      record({ id: "b", ordinal: 1, status: "failed", lastErrorCode: "PROVIDER", lastError: "boom" }),
    ]);
    assert.equal(partial.status, "partial");
    assert.equal(partial.errors.length, 1);
    const failed = aggregateChunkStates([
      record({ id: "a", status: "failed", lastErrorCode: "X", lastError: "no" }),
    ]);
    assert.equal(failed.status, "failed");
    // A completed chunk plus remaining queued work is running, not completed.
    assert.equal(
      aggregateChunkStates([record({ id: "a", status: "completed" }), record({ id: "b", ordinal: 1 })]).status,
      "running",
    );
  });

  it("derives inclusive coverage across chunks", () => {
    const aggregation = aggregateChunkStates([
      record({ id: "a", since: "2026-08-15", until: "2026-08-29", ordinal: 0 }),
      record({ id: "b", since: "2026-08-01", until: "2026-08-14", ordinal: 1 }),
    ]);
    assert.deepEqual(aggregation.coverage, { since: "2026-08-01", until: "2026-08-29" });
    assert.equal(aggregateChunkStates([]).coverage, null);
  });

  it("builds modal-compatible results newest-first", () => {
    const results = chunkResultsForModal([
      record({ id: "old", ordinal: 1, status: "completed", persistedRows: 3, since: "2026-08-01", until: "2026-08-14" }),
      record({ id: "new", ordinal: 0, status: "failed", lastError: "timeout", since: "2026-08-15", until: "2026-08-29" }),
    ]);
    assert.equal(results[0]?.executionSince, "2026-08-15");
    assert.equal(results[0]?.ok, false);
    assert.equal(results[0]?.error, "timeout");
    assert.equal(results[1]?.ok, true);
    assert.equal(results[1]?.upserted, 3);
  });

  it("sanitizes persisted errors without secrets", () => {
    const { code, message } = sanitizeChunkError(
      new Error('provider said no access_token=secret-value-123 for shown'),
    );
    assert.equal(code, "CHUNK_FAILED");
    assert.ok(!message.includes("secret-value-123"));
    assert.ok(message.includes("access_token=[redacted]"));
    const long = sanitizeChunkError("x".repeat(2000));
    assert.ok(long.message.length <= 500);
  });

  it("treats only missing-table errors as absent chunks, never outages", () => {
    assert.equal(isMissingChunkTableError({ code: "P2021" }), true);
    assert.equal(isMissingChunkTableError(new Error('relation "WarehouseBackfillChunk" does not exist')), true);
    assert.equal(isMissingChunkTableError(new Error("connect timeout")), false);
    assert.equal(isMissingChunkTableError(null), false);
    assert.equal(isMissingChunkTableError(undefined), false);
  });
});
