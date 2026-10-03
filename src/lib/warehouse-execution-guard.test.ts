import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WAREHOUSE_GENERIC_EXECUTION_MAX_DAYS,
  WAREHOUSE_AUTOMATIC_SKIP_REASON,
  assertExecutableWarehouseRange,
  isAutomaticWarehouseIngestionAvailable,
  isChunkGuardedWarehouseProvider,
  toOversizedExecutionResponse,
  getOversizedExecutionDetails,
} from "./warehouse-execution-guard";
import { HistoricalBackfillPlanningError } from "./historical-backfill-plan";

function inclusiveDays(since: string, until: string): number {
  return Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000) + 1;
}

describe("warehouse execution guard (shared production policy)", () => {
  it("uses inclusive calendar-day semantics: 30 passes, 31 fails for Meta/Google", () => {
    // Exactly 30 inclusive days must pass.
    assert.equal(inclusiveDays("2026-07-02", "2026-07-31"), 30);
    const okMeta = assertExecutableWarehouseRange({
      provider: "meta_ads",
      since: "2026-07-02",
      until: "2026-07-31",
    });
    assert.equal(okMeta.days, 30);
    const okGoogle = assertExecutableWarehouseRange({
      provider: "google_ads",
      since: "2026-07-02",
      until: "2026-07-31",
    });
    assert.equal(okGoogle.days, 30);

    // Exactly 31 inclusive days must fail.
    assert.equal(inclusiveDays("2026-07-01", "2026-07-31"), 31);
    for (const provider of ["meta_ads", "google_ads"] as const) {
      assert.throws(
        () => assertExecutableWarehouseRange({ provider, since: "2026-07-01", until: "2026-07-31" }),
        (error: unknown) =>
          error instanceof HistoricalBackfillPlanningError &&
          (error as HistoricalBackfillPlanningError).code === "REQUEST_CHUNKING_NOT_IMPLEMENTED",
      );
    }
  });

  it("rejects Meta/Google 31/90/731-day raw ranges with structured oversized details", () => {
    const cases: Array<{ since: string; until: string; days: number }> = [
      { since: "2026-07-01", until: "2026-07-31", days: 31 },
      { since: "2026-06-01", until: "2026-08-29", days: 90 },
      { since: "2022-03-01", until: "2024-02-29", days: 731 },
    ];
    for (const provider of ["meta_ads", "google_ads"] as const) {
      for (const { since, until, days } of cases) {
        assert.equal(inclusiveDays(since, until), days);
        let caught: unknown = null;
        try {
          assertExecutableWarehouseRange({ provider, since, until });
        } catch (error) {
          caught = error;
        }
        assert.ok(caught instanceof HistoricalBackfillPlanningError, `${provider} ${days}d must throw`);
        const details = getOversizedExecutionDetails(caught);
        assert.ok(details, "oversized error must carry structured details");
        assert.equal(details?.code, "REQUEST_CHUNKING_NOT_IMPLEMENTED");
        assert.equal(details?.provider, provider);
        assert.equal(details?.requestedRange.since, since);
        assert.equal(details?.requestedRange.until, until);
        assert.equal(details?.requestedRange.days, days);
        assert.equal(details?.maxExecutableDays, WAREHOUSE_GENERIC_EXECUTION_MAX_DAYS);
        const response = toOversizedExecutionResponse(details!.provider, details!.requestedRange, details!.maxExecutableDays);
        assert.equal(response.code, "REQUEST_CHUNKING_NOT_IMPLEMENTED");
        assert.equal(response.provider, provider);
        assert.equal(response.maxExecutableDays, 30);
        assert.match(response.error, /OAuth chunk dispatcher/);
        assert.match(response.hint, /Extended checkpointed backfill is not yet enabled/);
        assert.match((caught as Error).message, /Extended checkpointed backfill is not yet enabled/);
      }
    }
  });

  it("leaves non-Meta/Google behavior unchanged", () => {
    for (const provider of ["tiktok_business", "shopee", "lazada"] as const) {
      const range = assertExecutableWarehouseRange({
        provider,
        since: "2026-06-01",
        until: "2026-08-29",
      });
      assert.equal(range.days, 90);
    }
    assert.equal(isChunkGuardedWarehouseProvider("meta_ads"), true);
    assert.equal(isChunkGuardedWarehouseProvider("google_ads"), true);
    assert.equal(isChunkGuardedWarehouseProvider("tiktok_business"), false);
    assert.equal(isChunkGuardedWarehouseProvider("shopee"), false);
  });

  it("uses the canonical date validation response for invalid and reversed dates", () => {
    assert.throws(
      () => assertExecutableWarehouseRange({ provider: "meta_ads", since: "2024-02-30", until: "2024-03-01" }),
      /INVALID_DATE_RANGE/,
    );
    assert.throws(
      () => assertExecutableWarehouseRange({ provider: "meta_ads", since: "2024-03-02", until: "2024-03-01" }),
      /INVALID_DATE_RANGE/,
    );
    assert.throws(
      () => assertExecutableWarehouseRange({ provider: "google_ads", since: "2024-02-01T00:00:00Z", until: "2024-02-02" }),
      /INVALID_DATE_RANGE/,
    );
  });

  it("reports unavailable ingestion before any date arithmetic", () => {
    assert.equal(isAutomaticWarehouseIngestionAvailable("amazon"), false);
    assert.equal(isAutomaticWarehouseIngestionAvailable("shopify"), false);
    assert.equal(isAutomaticWarehouseIngestionAvailable("meta_ads"), true);
    assert.equal(isAutomaticWarehouseIngestionAvailable("google_ads"), true);
    assert.equal(isAutomaticWarehouseIngestionAvailable("tiktok_business"), true);
    assert.equal(isAutomaticWarehouseIngestionAvailable("shopee"), true);
    assert.equal(isAutomaticWarehouseIngestionAvailable("lazada"), true);
    // Future unavailable providers and unknown connectors fail closed generically.
    assert.equal(isAutomaticWarehouseIngestionAvailable("future_provider_xyz"), false);
    assert.equal(isAutomaticWarehouseIngestionAvailable(undefined), false);
    assert.equal(isAutomaticWarehouseIngestionAvailable(""), false);
    assert.equal(WAREHOUSE_AUTOMATIC_SKIP_REASON, "historical_ingestion_unavailable");
    assert.throws(
      () => assertExecutableWarehouseRange({ provider: "amazon", since: "2026-08-20", until: "2026-08-20" }),
      /WAREHOUSE_INGESTION_UNAVAILABLE/,
    );
    assert.throws(
      () => assertExecutableWarehouseRange({ provider: "shopify", since: "2026-08-20", until: "2026-08-20" }),
      /WAREHOUSE_INGESTION_UNAVAILABLE/,
    );
  });

  it("keeps extended 24-month planning disabled for execution", () => {
    // Planning-only 731-day ranges remain plannable via the planner, but the
    // shared execution guard must still reject generic Meta/Google execution.
    for (const provider of ["meta_ads", "google_ads"] as const) {
      assert.throws(
        () => assertExecutableWarehouseRange({ provider, since: "2022-03-01", until: "2024-02-29" }),
        /REQUEST_CHUNKING_NOT_IMPLEMENTED/,
      );
    }
  });
});
