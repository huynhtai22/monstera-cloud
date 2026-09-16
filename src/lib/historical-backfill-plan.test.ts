import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getHistoricalIngestionCapability,
  HISTORICAL_INGESTION_CAPABILITIES,
  type HistoricalIngestionProvider,
} from "./historical-ingestion-capabilities";
import {
  HistoricalBackfillPlanningError,
  planHistoricalBackfill,
} from "./historical-backfill-plan";

const IMPLEMENTED_PROVIDERS = [
  "meta_ads",
  "google_ads",
  "tiktok_business",
  "shopee",
  "shopee_ads",
  "lazada",
] as const satisfies readonly HistoricalIngestionProvider[];

const UNAVAILABLE_PROVIDERS = ["amazon", "shopify"] as const satisfies readonly HistoricalIngestionProvider[];

const COVERAGE_RANGES = [
  ["one day", "2024-02-29", "2024-02-29"],
  ["five days", "2024-02-25", "2024-02-29"],
  ["thirty days", "2024-02-01", "2024-03-01"],
  ["ninety days", "2024-01-01", "2024-03-30"],
  ["one year", "2023-03-01", "2024-02-29"],
  ["two years inclusive", "2022-03-01", "2024-02-29"],
] as const;

function assertExactInclusiveCoverage(
  since: string,
  until: string,
  chunks: readonly { since: string; until: string; id: string }[],
  maxChunkDays: number,
) {
  assert.ok(chunks.length > 0);
  assert.equal(chunks[0]?.until, until, "chunks must be newest first");
  assert.equal(chunks[chunks.length - 1]?.since, since, "chunks must reach the requested start");
  const seen = new Set<string>();
  for (const chunk of chunks) {
    assert.match(chunk.id, /^[a-z0-9_]+:[a-f0-9]{24}$/);
    const start = Date.parse(`${chunk.since}T00:00:00.000Z`);
    const end = Date.parse(`${chunk.until}T00:00:00.000Z`);
    assert.ok((end - start) / 86_400_000 + 1 <= maxChunkDays);
    for (let cursor = start; cursor <= end; cursor += 86_400_000) {
      const day = new Date(cursor).toISOString().slice(0, 10);
      assert.equal(seen.has(day), false, `duplicate day ${day}`);
      seen.add(day);
    }
  }
  const requestedDays =
    (Date.parse(`${until}T00:00:00.000Z`) - Date.parse(`${since}T00:00:00.000Z`)) /
      86_400_000 +
    1;
  assert.equal(seen.size, requestedDays);
}

describe("historical ingestion capability registry", () => {
  it("has one immutable canonical record for every connector", () => {
    assert.deepEqual(
      HISTORICAL_INGESTION_CAPABILITIES.map((capability) => capability.provider),
      ["amazon", "google_ads", "lazada", "meta_ads", "shopee", "shopee_ads", "shopify", "tiktok_business"],
    );
    assert.equal(getHistoricalIngestionCapability("tiktok_business")?.provider, "tiktok_business");
    assert.equal(getHistoricalIngestionCapability("tiktok_ads"), undefined);
    assert.equal(Object.isFrozen(HISTORICAL_INGESTION_CAPABILITIES), true);
  });

  it("keeps provider availability, product selection, and warehouse retention distinct", () => {
    const meta = getHistoricalIngestionCapability("meta_ads")!;
    const google = getHistoricalIngestionCapability("google_ads")!;
    const shopee = getHistoricalIngestionCapability("shopee")!;
    const amazon = getHistoricalIngestionCapability("amazon")!;

    assert.equal(meta.defaultAutomaticBackfill.days, 90);
    assert.equal(meta.maximumCustomerSelectableRange?.days, 731);
    assert.equal(google.maximumCustomerSelectableRange?.days, 731);
    assert.equal(shopee.maximumCustomerSelectableRange, null);
    assert.equal(amazon.warehouseIngestion, "unavailable");
    assert.equal(meta.normalizedMetricRetention.days, 731);
    assert.equal(meta.maximumRequestSpan.classification, "internal_safety");
  });

  it("records public primary-source URLs only for verified provider claims", () => {
    const google = getHistoricalIngestionCapability("google_ads")!;
    assert.equal(google.providerLookbackCeiling?.classification, "provider_hard");
    assert.match(google.providerLookbackCeiling?.source?.url ?? "", /^https:\/\/developers\.google\.com\//);
    assert.equal(google.providerLookbackCeiling?.source?.accessedOn, "2026-09-16");
    assert.equal(getHistoricalIngestionCapability("meta_ads")?.providerLookbackCeiling, null);
  });
});

describe("historical backfill planner", () => {
  for (const provider of IMPLEMENTED_PROVIDERS) {
    const capability = getHistoricalIngestionCapability(provider)!;
    for (const [label, since, until] of COVERAGE_RANGES) {
      it(`${provider}: deterministically plans ${label} with exact newest-first coverage`, () => {
        const first = planHistoricalBackfill({ provider, since, until, asOf: "2024-03-01" });
        const second = planHistoricalBackfill({ provider, since, until, asOf: "2024-03-01" });
        assert.deepEqual(first, second);
        assert.equal(first.requestedRange.since, since);
        assert.equal(first.requestedRange.until, until);
        assert.equal(first.provider, provider);
        assert.equal(first.capabilityStatus, capability.readiness);
        assertExactInclusiveCoverage(
          first.effectiveRange.since,
          first.effectiveRange.until,
          first.chunks,
          capability.maximumRequestSpan.days,
        );
      });
    }
  }

  for (const provider of UNAVAILABLE_PROVIDERS) {
    for (const [label, since, until] of COVERAGE_RANGES) {
      it(`${provider}: rejects ${label} because no Warehouse ingestion worker exists`, () => {
        assert.throws(
          () => planHistoricalBackfill({ provider, since, until, asOf: "2024-03-01" }),
          /WAREHOUSE_INGESTION_UNAVAILABLE/,
        );
      });
    }
  }

  it("certifies Meta and Google 90- and 731-day planning without enabling execution", () => {
    for (const provider of ["meta_ads", "google_ads"] as const) {
      const plan = planHistoricalBackfill({
        provider,
        since: "2022-03-01",
        until: "2024-02-29",
        asOf: "2024-03-01",
      });
      assert.equal(plan.requestedRange.days, 731);
      assert.equal(plan.executionAllowed, false);
      assert.match(plan.executionBlockers.join(" "), /async_chunked_execution_not_implemented/);
    }
  });

  it("rejects malformed dates, timestamps, reversed ranges, and unknown connectors", () => {
    for (const input of [
      { provider: "meta_ads", since: "2024-02-30", until: "2024-03-01" },
      { provider: "meta_ads", since: "2024-02-01T00:00:00Z", until: "2024-02-02" },
      { provider: "meta_ads", since: "2024-03-02", until: "2024-03-01" },
      { provider: "not_a_connector", since: "2024-03-01", until: "2024-03-01" },
    ]) {
      assert.throws(
        () => planHistoricalBackfill({ ...input, asOf: "2024-03-01" }),
        HistoricalBackfillPlanningError,
      );
    }
  });

  it("rejects warehouse-unavailable connectors", () => {
    for (const provider of ["amazon", "shopify"] as const) {
      assert.throws(
        () => planHistoricalBackfill({ provider, since: "2024-03-01", until: "2024-03-01", asOf: "2024-03-01" }),
        /WAREHOUSE_INGESTION_UNAVAILABLE/,
      );
    }
  });

  it("reports, rather than hides, product and provider-effective clamping", () => {
    const productLimited = planHistoricalBackfill({
      provider: "google_ads",
      since: "2024-01-01",
      until: "2024-03-30",
      asOf: "2024-04-01",
      planMaximumDays: 30,
    });
    assert.equal(productLimited.clamped, true);
    assert.equal(productLimited.effectiveRange.since, "2024-03-01");
    assert.equal(productLimited.clampReasons[0]?.kind, "product_plan");

    const providerLimited = planHistoricalBackfill({
      provider: "google_ads",
      since: "2022-01-01",
      until: "2025-01-01",
      asOf: "2026-09-16",
      planMaximumDays: 2_000,
    });
    assert.equal(providerLimited.clamped, true);
    assert.equal(providerLimited.clampReasons.some((reason) => reason.kind === "provider_hard"), true);
  });

  it("rejects a range that lies wholly outside a hard provider lookback ceiling", () => {
    assert.throws(
      () => planHistoricalBackfill({
        provider: "google_ads",
        since: "2020-01-01",
        until: "2020-01-31",
        asOf: "2026-09-16",
        planMaximumDays: 2_000,
      }),
      /PROVIDER_LOOKBACK_EXCEEDED/,
    );
  });

  it("fails closed when unverified capabilities are asked to execute an extended range", () => {
    for (const provider of ["meta_ads", "tiktok_business", "shopee", "shopee_ads", "lazada"] as const) {
      assert.throws(
        () => planHistoricalBackfill({
          provider,
          since: "2022-03-01",
          until: "2024-02-29",
          asOf: "2024-03-01",
          execution: "execute",
        }),
        /EXTENDED_EXECUTION_NOT_ALLOWED/,
      );
    }
  });

  it("does not accept or derive account IDs, preserving provider-specific normalization", () => {
    const baseline = planHistoricalBackfill({
      provider: "google_ads",
      since: "2024-02-28",
      until: "2024-03-01",
      asOf: "2024-03-01",
    });
    assert.equal(JSON.stringify(baseline).includes("act_"), false);
    assert.equal(JSON.stringify(baseline).includes("account"), false);
  });
});
