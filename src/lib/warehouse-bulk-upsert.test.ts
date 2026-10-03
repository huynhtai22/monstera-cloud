import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BULK_UPSERT_DEFAULT_MAX_BYTES,
  BULK_UPSERT_DEFAULT_MAX_ROWS,
  buildGenericBulkUpsert,
  buildMetaBulkUpsert,
  bulkUpsertMaxBytes,
  bulkUpsertMaxRows,
  estimateBulkRowBytes,
  executeBulkBatch,
  flushGenericPayloadBatches,
  flushMetaPayloadBatches,
  isWarehouseBulkUpsertEnabled,
  sanitizeBulkRow,
  splitBulkBatches,
  BulkRowPoisonError,
  type BulkMetricRow,
} from "./warehouse-bulk-upsert";

function bulkRow(overrides: Partial<BulkMetricRow> = {}): BulkMetricRow {
  return {
    id: "test-id-1",
    workspaceId: "ws",
    connectionId: "conn",
    platform: "google_ads",
    accountId: "act",
    accountName: null,
    level: "campaign",
    entityId: "e1",
    campaignId: "c1",
    campaignName: "C1",
    adsetId: "",
    adsetName: null,
    adId: "",
    date: new Date("2026-03-01T00:00:00.000Z"),
    breakdownHash: "none",
    impressions: 10,
    clicks: 2,
    spend: 5,
    reach: 0,
    cpc: 2.5,
    ctr: 20,
    conversions: 1,
    revenue: 3,
    roas: 0.6,
    currency: "USD",
    rawData: null,
    adName: null,
    shopeeBroadOrders: null,
    shopeeBroadUnits: null,
    shopeeBroadGmv: null,
    shopeeDirectOrders: null,
    shopeeDirectUnits: null,
    shopeeDirectGmv: null,
    shopeeKeywordSettingsCount: null,
    syncJobId: null,
    lockScope: null,
    fencingToken: null,
    ...overrides,
  };
}

describe("bulk flag and budgets (unit)", () => {
  it("is disabled by default and enabled only by an explicit opt-in", () => {
    const prev = process.env.WAREHOUSE_BULK_UPSERT_ENABLED;
    try {
      delete process.env.WAREHOUSE_BULK_UPSERT_ENABLED;
      assert.equal(isWarehouseBulkUpsertEnabled(), false);
      process.env.WAREHOUSE_BULK_UPSERT_ENABLED = "true";
      assert.equal(isWarehouseBulkUpsertEnabled(), false, "only exactly \"1\" enables the bulk path");
      process.env.WAREHOUSE_BULK_UPSERT_ENABLED = "1";
      assert.equal(isWarehouseBulkUpsertEnabled(), true);
    } finally {
      if (prev === undefined) delete process.env.WAREHOUSE_BULK_UPSERT_ENABLED;
      else process.env.WAREHOUSE_BULK_UPSERT_ENABLED = prev;
    }
  });

  it("uses conservative explicit defaults within the design range", () => {
    assert.equal(BULK_UPSERT_DEFAULT_MAX_ROWS, 1000);
    assert.equal(BULK_UPSERT_DEFAULT_MAX_BYTES, 262144);
    const prevRows = process.env.WAREHOUSE_BULK_MAX_ROWS;
    const prevBytes = process.env.WAREHOUSE_BULK_MAX_BYTES;
    try {
      delete process.env.WAREHOUSE_BULK_MAX_ROWS;
      delete process.env.WAREHOUSE_BULK_MAX_BYTES;
      assert.equal(bulkUpsertMaxRows(), 1000);
      assert.equal(bulkUpsertMaxBytes(), 262144);
      process.env.WAREHOUSE_BULK_MAX_ROWS = "99999";
      assert.equal(bulkUpsertMaxRows(), 5000, "row cap is clamped to the design maximum");
      process.env.WAREHOUSE_BULK_MAX_BYTES = "1";
      assert.equal(bulkUpsertMaxBytes(), 65536, "byte budget has a floor");
    } finally {
      if (prevRows === undefined) delete process.env.WAREHOUSE_BULK_MAX_ROWS;
      else process.env.WAREHOUSE_BULK_MAX_ROWS = prevRows;
      if (prevBytes === undefined) delete process.env.WAREHOUSE_BULK_MAX_BYTES;
      else process.env.WAREHOUSE_BULK_MAX_BYTES = prevBytes;
    }
  });
});

describe("bulk sanitization (unit)", () => {
  it("maps NaN/Infinity/negatives to per-row defaults and preserves zero", () => {
    const row = sanitizeBulkRow({
      workspaceId: "ws", connectionId: "conn", platform: "google_ads",
      accountId: "act", entityId: "e", date: new Date("2026-03-01T00:00:00.000Z"),
      impressions: NaN, clicks: Infinity, spend: -5, cpc: NaN, ctr: Infinity,
      conversions: -2, revenue: NaN, shopeeBroadOrders: -3,
      shopeeBroadGmv: Infinity, shopeeKeywordSettingsCount: -1.6,
      fencingToken: BigInt(42),
    });
    assert.equal(row.impressions, 0);
    assert.equal(row.clicks, 0);
    assert.equal(row.spend, 0);
    assert.equal(row.conversions, 0);
    assert.equal(row.revenue, 0);
    assert.equal(row.shopeeBroadOrders, 0, "negative promoted values clamp like normalized fields");
    assert.equal(row.shopeeBroadGmv, null, "non-finite promoted values fall back");
    assert.equal(row.shopeeKeywordSettingsCount, 0);
    assert.equal(row.fencingToken, "42", "BigInt tokens bind as decimal strings");
    assert.equal(row.currency, null);
    assert.equal(row.rawData, null);
  });

  it("keeps zero valid and null absent", () => {
    const row = sanitizeBulkRow({
      workspaceId: "ws", connectionId: "conn", platform: "shopee",
      accountId: "act", entityId: "e", date: new Date("2026-03-01T00:00:00.000Z"),
      impressions: 0, clicks: 0, spend: 0, cpc: 0, ctr: 0,
      conversions: 0, shopeeBroadOrders: 0,
    });
    assert.equal(row.impressions, 0);
    assert.equal(row.shopeeBroadOrders, 0, "zero is a valid promoted value");
    assert.equal(row.shopeeDirectOrders, null);
  });

  it("rejects poison rows before binding", () => {
    assert.throws(
      () => sanitizeBulkRow({
        workspaceId: "ws", connectionId: "conn", platform: "google_ads",
        accountId: "act", entityId: "e", date: new Date("not-a-date"),
        impressions: 0, clicks: 0, spend: 0, cpc: 0, ctr: 0, conversions: 0,
      }),
      BulkRowPoisonError,
    );
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assert.throws(
      () => sanitizeBulkRow({
        workspaceId: "ws", connectionId: "conn", platform: "google_ads",
        accountId: "act", entityId: "e", date: new Date("2026-03-01T00:00:00.000Z"),
        impressions: 0, clicks: 0, spend: 0, cpc: 0, ctr: 0, conversions: 0,
        rawData: circular,
      }),
      BulkRowPoisonError,
    );
  });
});

describe("bulk batching (unit)", () => {
  it("splits by row count and byte budget, isolating oversized rows", () => {
    const rows = [bulkRow(), bulkRow(), bulkRow(), bulkRow()];
    const byCount = splitBulkBatches(rows, () => 10, 2, 1_000_000);
    assert.equal(byCount.length, 2);
    assert.deepEqual(byCount.map((b) => b.rows.length), [2, 2]);
    assert.ok(byCount.every((b) => !b.oversized));

    const byBytes = splitBulkBatches(rows, () => 100, 1000, 250);
    assert.deepEqual(byBytes.map((b) => b.rows.length), [2, 2]);

    const huge = bulkRow({ rawData: "x".repeat(10_000) });
    const mixed = splitBulkBatches([bulkRow(), huge, bulkRow()], (r) => estimateBulkRowBytes(r), 1000, 1000);
    assert.equal(mixed.length, 3);
    assert.equal(mixed[1]!.oversized, true);
    assert.equal(mixed[1]!.rows.length, 1);
  });
});

describe("bulk SQL shape (unit)", () => {
  it("generic statement uses a single JSONB bind with the per-row conflict key", () => {
    const { sql, params } = buildGenericBulkUpsert([bulkRow(), bulkRow()]);
    assert.ok(sql.includes("jsonb_to_recordset($1::jsonb)"), "whole batch binds as one JSON value");
    assert.ok(!sql.includes("UNNEST("), "no parallel-array binds");
    assert.ok(
      sql.includes('ON CONFLICT ("connectionId", "accountId", "level", "entityId", "date", "breakdownHash")'),
      "conflict key matches the per-row upsert",
    );
    assert.ok(!sql.includes("lease_ok"), "generic path has no lease gate, like the per-row path");
    assert.equal(params.length, 1, "single bind parameter");
  });

  it("meta statement fences in-statement with scope, lease, token, status, and expiry", () => {
    const { sql, params } = buildMetaBulkUpsert([bulkRow()], {
      scope: "s", leaseId: "l", fencingToken: BigInt(7),
    });
    assert.ok(sql.includes("lease_ok"), "lease CTE present");
    assert.ok(sql.includes('"scope" = $1'), "scope bound");
    assert.ok(sql.includes('"leaseId" = $2'), "lease ID bound");
    assert.ok(sql.includes('"fencingToken" = $3::bigint'), "fencing token bound as bigint");
    assert.ok(sql.includes('"status" = \'running\''), "running status required");
    assert.ok(sql.includes('"leaseExpiresAt" > NOW()'), "unexpired lease required");
    assert.ok(sql.includes("CROSS JOIN lease_ok"), "inserts gated on the lease");
    assert.ok(sql.includes("WHERE EXISTS (SELECT 1 FROM lease_ok)"), "updates gated on the lease");
    assert.ok(sql.includes("jsonb_to_recordset($4::jsonb)"), "batch binds as one JSON value");
    assert.deepEqual(params.slice(0, 3), ["s", "l", "7"]);
    assert.equal(params.length, 4);
  });
});

describe("bulk fallback behavior (unit)", () => {
  const fallbackCalls: string[] = [];

  it("poisoned bulk batches fall back row-by-row with attribution", async () => {
    fallbackCalls.length = 0;
    const rows = [bulkRow(), bulkRow()];
    const outcome = await executeBulkBatch(
      rows,
      () => { throw new Error("boom"); },
      async (original: string) => { fallbackCalls.push(original); },
      ["a", "b"],
      { executeBulk: async () => { throw new Error("unreachable"); } },
      "generic",
    );
    assert.deepEqual(outcome, { upserted: 2, failed: 0, fallbacks: 1 });
    assert.deepEqual(fallbackCalls, ["a", "b"]);
  });

  it("bulk errors attribute per-row failures without losing good rows", async () => {
    const outcome = await executeBulkBatch(
      [bulkRow()],
      (bulkRows) => buildGenericBulkUpsert(bulkRows),
      async () => { throw new Error("poison"); },
      ["only"],
      { executeBulk: async () => { throw new Error("statement failed"); } },
      "generic",
    );
    assert.deepEqual(outcome, { upserted: 0, failed: 1, fallbacks: 1 });
  });

  it("stolen meta lease throws with zero writes instead of falling back", async () => {
    await assert.rejects(
      executeBulkBatch(
        [bulkRow()],
        (bulkRows) => buildMetaBulkUpsert(bulkRows, { scope: "s", leaseId: "old", fencingToken: BigInt(1) }),
        async () => {},
        ["only"],
        {
          executeBulk: async () => 0,
          findLease: async () => ({ leaseId: "new", fencingToken: BigInt(2), status: "running", leaseExpiresAt: new Date(Date.now() + 60_000) }),
        },
        "meta",
        { leaseId: "old", fencingToken: "1" },
      ),
      /lease lost/i,
    );
  });

  it("affected-count mismatch with a live lease falls back per-row", async () => {
    let fallbackCount = 0;
    const outcome = await executeBulkBatch(
      [bulkRow()],
      (bulkRows) => buildMetaBulkUpsert(bulkRows, { scope: "s", leaseId: "l", fencingToken: BigInt(1) }),
      async () => { fallbackCount++; },
      ["only"],
      {
        executeBulk: async () => 0,
        findLease: async () => ({ leaseId: "l", fencingToken: BigInt(1), status: "running", leaseExpiresAt: new Date(Date.now() + 60_000) }),
      },
      "meta",
      { leaseId: "l", fencingToken: "1" },
    );
    assert.deepEqual(outcome, { upserted: 1, failed: 0, fallbacks: 1 });
    assert.equal(fallbackCount, 1);
  });
});

describe("bulk flush helpers (unit)", () => {
  it("oversized generic payloads route to per-row fallback", async () => {
    const seen: string[] = [];
    const outcome = await flushGenericPayloadBatches(
      [{
        workspaceId: "ws", connectionId: "c", platform: "google_ads", accountId: "a",
        level: "campaign", entityId: "e", campaignId: "e",
        date: new Date("2026-03-01T00:00:00.000Z"),
        impressions: 1, clicks: 1, spend: 1, cpc: 1, ctr: 1, conversions: 0,
        rawData: { blob: "x".repeat(5000) },
      }],
      {
        fallbackRow: async (p) => { seen.push(p.entityId); },
        maxBytes: 100,
        executor: { executeBulk: async () => { throw new Error("must not bulk oversized rows"); } },
      },
    );
    assert.deepEqual(outcome, { upserted: 1, failed: 0, fallbacks: 1 });
    assert.deepEqual(seen, ["e"]);
  });

  it("meta poison rows fall back while good rows bulk", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const fallbackSeen: string[] = [];
    let bulked = 0;
    const outcome = await flushMetaPayloadBatches(
      [
        {
          workspaceId: "ws", connectionId: "c", accountId: "a", level: "campaign",
          entityId: "good", date: new Date("2026-03-01T00:00:00.000Z"), breakdownHash: "none",
          metrics: { impressions: 1, clicks: 1, spend: 1, reach: 0, cpc: 1, ctr: 1, conversions: 0, revenue: 0, roas: 0, rawData: { ok: true } },
          syncJobId: "j",
        },
        {
          workspaceId: "ws", connectionId: "c", accountId: "a", level: "campaign",
          entityId: "poison", date: new Date("2026-03-01T00:00:00.000Z"), breakdownHash: "none",
          metrics: { impressions: 1, clicks: 1, spend: 1, reach: 0, cpc: 1, ctr: 1, conversions: 0, revenue: 0, roas: 0, rawData: circular },
          syncJobId: "j",
        },
      ],
      {
        lease: { scope: "s", leaseId: "l", fencingToken: BigInt(1) },
        fallbackRow: async (row) => {
          fallbackSeen.push(row.entityId);
          if (row.entityId === "poison") throw new Error("circular rawData");
        },
        executor: {
          executeBulk: async () => { bulked++; return 1; },
          findLease: async () => ({ leaseId: "l", fencingToken: BigInt(1), status: "running", leaseExpiresAt: new Date(Date.now() + 60_000) }),
        },
      },
    );
    assert.equal(bulked, 1, "good row bulked");
    assert.deepEqual(fallbackSeen, ["poison"], "poison row attributed per-row");
    assert.deepEqual(outcome, { upserted: 1, failed: 1, fallbacks: 1 });
  });

  it("lost lease aborts remaining batches without writing", async () => {
    const written: string[] = [];
    let heartbeats = 0;
    const outcome = await flushGenericPayloadBatches(
      [1, 2, 3, 4].map((n) => ({
        workspaceId: "ws", connectionId: "c", platform: "google_ads", accountId: "a",
        level: "campaign", entityId: `e${n}`, campaignId: `e${n}`,
        date: new Date("2026-03-01T00:00:00.000Z"),
        impressions: 1, clicks: 1, spend: 1, cpc: 1, ctr: 1, conversions: 0,
      })),
      {
        fallbackRow: async (p) => { written.push(p.entityId); },
        onHeartbeat: async () => {
          heartbeats++;
          if (heartbeats > 1) throw new Error("lease stolen");
        },
        maxRows: 2,
        executor: { executeBulk: async () => 2 },
      },
    );
    assert.equal(outcome.upserted, 2, "completed batch keeps its writes");
    assert.equal(outcome.failed, 2, "remaining batches counted failed without writing");
    assert.deepEqual(written, [], "no per-row fallback writes after a lost lease");
  });
});
