import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { googleAdsReportClient } from "../google-ads";
import {
  GOOGLE_CONNECTOR_RUNTIME_MODES,
  MAX_SHADOW_KEY_SAMPLES,
  SHADOW_CHUNK_BYTES,
  MAX_SHADOW_RAW_CAPTURES,
  canonicalGoogleRowKey,
  canonicalizeGoogleRow,
  chunkShadowRawTexts,
  compareGoogleShadowRun,
  isGoogleShadowEnabled,
  replayGoogleRows,
  resolveGoogleRuntimeMode,
  type CanonicalGoogleRow,
} from "./google-shadow";

function sampleBatch(campaigns: Array<{ id: string; spendMicros: string }>) {
  return [
    {
      results: campaigns.map((c) => ({
        campaign: { id: c.id, name: `Camp ${c.id}`, status: "ENABLED" },
        customer: { currency_code: "USD", time_zone: "America/New_York" },
        metrics: {
          impressions: "100",
          clicks: "10",
          cost_micros: c.spendMicros,
          conversions: "1",
          conversions_value: "5.0",
          ctr: "0.1",
          average_cpc: "100000",
        },
        segments: { date: "2026-09-01" },
      })),
    },
  ];
}

function legacyRow(key: string, spend = 10): CanonicalGoogleRow {
  return {
    key,
    date: "2026-09-01",
    campaignId: "1",
    campaignName: "Camp 1",
    impressions: 100,
    clicks: 10,
    spend,
    conversions: 1,
    conversionValue: 5,
    currency: "USD",
  };
}

describe("google runtime mode flag", () => {
  it("defaults to legacy and fails closed on unknown values", () => {
    assert.deepEqual([...GOOGLE_CONNECTOR_RUNTIME_MODES].sort(), ["legacy", "runtime", "shadow"]);
    assert.equal(resolveGoogleRuntimeMode(undefined), "legacy");
    assert.equal(resolveGoogleRuntimeMode("legacy"), "legacy");
    assert.equal(resolveGoogleRuntimeMode("shadow"), "shadow");
    assert.equal(resolveGoogleRuntimeMode("runtime"), "runtime");
    assert.equal(resolveGoogleRuntimeMode("production"), "legacy");
    assert.equal(isGoogleShadowEnabled("shadow"), true);
    assert.equal(isGoogleShadowEnabled("runtime"), false);
    assert.equal(isGoogleShadowEnabled(undefined), false);
  });
});

describe("single-extraction fan-out", () => {
  const originalFetch = globalThis.fetch;
  const originalDevToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  beforeEach(() => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-developer-token";
  });
  afterEach(() => {
    if (originalDevToken === undefined) delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    else process.env.GOOGLE_ADS_DEVELOPER_TOKEN = originalDevToken;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubSearchStream(batches: unknown) {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify(batches), { status: 200 });
    }) as typeof fetch;
    return () => calls;
  }

  it("captures the raw response from the same single request legacy uses", async () => {
    const countCalls = stubSearchStream(sampleBatch([{ id: "111", spendMicros: "10000000" }]));
    const captured: string[] = [];
    const rows = await googleAdsReportClient.getCampaignPerformance(
      "token",
      "1234567890",
      "LAST_7_DAYS",
      undefined,
      { onRawResponse: (event) => captured.push(event.rawText) },
    );
    assert.equal(countCalls(), 1);
    assert.equal(captured.length, 1);
    assert.deepEqual(JSON.parse(captured[0]), sampleBatch([{ id: "111", spendMicros: "10000000" }]));
    assert.equal(rows.length, 1);
  });

  it("legacy output is byte-identical with and without the hook", async () => {
    const countCalls = stubSearchStream(sampleBatch([{ id: "111", spendMicros: "10000000" }]));
    const withHook = await googleAdsReportClient.getCampaignPerformance("token", "1234567890", "LAST_7_DAYS", undefined, {
      onRawResponse: () => {},
    });
    const withoutHook = await googleAdsReportClient.getCampaignPerformance("token", "1234567890", "LAST_7_DAYS");
    assert.equal(countCalls(), 2);
    assert.deepEqual(withHook, withoutHook);
  });
});

describe("string-only provider identifiers", () => {
  it("keeps 19-digit Google IDs exact end to end", () => {
    const big = "1234567890123456789";
    assert.ok(Number(big) !== Number(big) || String(Number(big)) !== big, "sanity: Number loses this id");
    const raw = JSON.stringify([{ results: [{ campaign: { id: big, name: "Big" }, metrics: {}, segments: { date: "2026-09-01" } }] }]);
    const [row] = replayGoogleRows({ connectionId: "conn-1", accountId: "999", rawTexts: [raw] });
    assert.equal(row.campaignId, big);
    assert.ok(row.key.includes(big));
  });

  it("builds canonical keys from strings only", () => {
    assert.equal(
      canonicalGoogleRowKey({ connectionId: "c", accountId: "a", campaignId: "1", date: "2026-09-01" }),
      "c|a|1|2026-09-01",
    );
    assert.equal(
      canonicalizeGoogleRow({ connectionId: "c", accountId: "a", row: { campaign_id: 7, segments_date: "2026-09-01" } }).campaignId,
      "7",
    );
  });
});

describe("bounded chunking", () => {
  it("splits raw texts into bounded chunks with exact reassembly", async () => {
    const big = "x".repeat(SHADOW_CHUNK_BYTES * 2 + 100);
    const chunks = chunkShadowRawTexts([{ customerId: "123", rawText: big }]);
    assert.equal(chunks.length, 3);
    assert.ok(chunks.every((c) => c.rawText.length <= SHADOW_CHUNK_BYTES));
    assert.equal(chunks.map((c) => c.rawText).join(""), big);
    assert.deepEqual(
      chunks.map((c) => c.index),
      [0, 1, 2],
    );
  });

  it("caps captures per run", async () => {
    const captures = Array.from({ length: MAX_SHADOW_RAW_CAPTURES + 10 }, (_, i) => ({
      customerId: String(i),
      rawText: "{}",
    }));
    const chunks = chunkShadowRawTexts(captures);
    assert.equal(chunks.length, MAX_SHADOW_RAW_CAPTURES);
  });
});

describe("deterministic replay", () => {
  const rawOne = JSON.stringify([
    { results: [{ campaign: { id: "2", name: "B" }, metrics: { impressions: "10" }, segments: { date: "2026-09-01" } }] },
  ]);
  const rawTwo = JSON.stringify([
    { results: [{ campaign: { id: "1", name: "A" }, metrics: { impressions: "20" }, segments: { date: "2026-09-01" } }] },
  ]);

  it("produces identical rows across repeated replays", () => {
    const first = replayGoogleRows({ connectionId: "c", accountId: "a", rawTexts: [rawOne, rawTwo] });
    const second = replayGoogleRows({ connectionId: "c", accountId: "a", rawTexts: [rawOne, rawTwo] });
    assert.deepEqual(first, second);
  });

  it("orders by canonical key, never array position", () => {
    const straight = replayGoogleRows({ connectionId: "c", accountId: "a", rawTexts: [rawOne, rawTwo] });
    const shuffled = replayGoogleRows({ connectionId: "c", accountId: "a", rawTexts: [rawTwo, rawOne] });
    assert.deepEqual(straight, shuffled);
    assert.deepEqual(
      straight.map((r) => r.key),
      ["c|a|1|2026-09-01", "c|a|2|2026-09-01"],
    );
  });

  it("reads camelCase raw fields exactly", () => {
    const raw = JSON.stringify([
      {
        results: [
          {
            campaign: { id: "42", name: "Camel" },
            customer: { currencyCode: "EUR" },
            metrics: { costMicros: "2500000" },
            segments: { date: "2026-09-02" },
          },
        ],
      },
    ]);
    const [row] = replayGoogleRows({ connectionId: "c", accountId: "a", rawTexts: [raw] });
    assert.equal(row.campaignId, "42");
    assert.equal(row.spend, 2.5);
    assert.equal(row.currency, "EUR");
  });

  it("rejects malformed raw artifacts loudly", () => {
    assert.throws(() => replayGoogleRows({ connectionId: "c", accountId: "a", rawTexts: ["not-json{{{"] }), /not valid JSON/);
  });
});

describe("shadow comparison", () => {
  const base = {
    runId: "run-1",
    artifactIds: ["a1"],
    legacyVersion: "legacy-sync",
  };

  it("passes on exact match", async () => {
    const rows = [
      legacyRow("c|a|1|2026-09-01", 10),
      legacyRow("c|a|2|2026-09-01", 20),
    ];
    const result = compareGoogleShadowRun({ ...base, legacyRows: rows, runtimeRows: rows.map((r) => ({ ...r })) });
    assert.equal(result.pass, true);
    assert.deepEqual(result.comparedRowCounts, { legacy: 2, runtime: 2 });
    assert.deepEqual(result.missingKeys, []);
    assert.deepEqual(result.extraKeys, []);
    assert.deepEqual(result.duplicateKeyCounts, { legacy: 0, runtime: 0 });
    assert.ok(result.metricDifferences.every((d) => d.within));
  });

  it("passes regardless of input array order", async () => {
    const legacy = [legacyRow("c|a|1|2026-09-01", 10), legacyRow("c|a|2|2026-09-01", 20)];
    const runtime = [legacyRow("c|a|2|2026-09-01", 20), legacyRow("c|a|1|2026-09-01", 10)];
    const result = compareGoogleShadowRun({ ...base, legacyRows: legacy, runtimeRows: runtime });
    assert.equal(result.pass, true);
  });

  it("fails missing, extra and duplicate keys with bounded samples", async () => {
    const legacy = Array.from({ length: 60 }, (_, i) => legacyRow(`c|a|${i}|2026-09-01`, 1));
    const runtime = [legacyRow("c|a|0|2026-09-01", 1), legacyRow("c|a|0|2026-09-01", 1), legacyRow("zzz|new|9|2026-09-01", 1)];
    const result = compareGoogleShadowRun({ ...base, legacyRows: legacy, runtimeRows: runtime });
    assert.equal(result.pass, false);
    assert.equal(result.missingKeyCount, 59);
    assert.equal(result.missingKeys.length, MAX_SHADOW_KEY_SAMPLES);
    assert.equal(result.missingKeysTruncated, true);
    assert.equal(result.extraKeyCount, 1);
    assert.equal(result.duplicateKeyCounts.runtime, 1);
    assert.equal(result.duplicateKeyCounts.legacy, 0);
  });

  it("fails metric breaches using contract tolerances, not invented ones", async () => {
    const legacy = [{ ...legacyRow("c|a|1|2026-09-01"), impressions: 100, spend: 10 }];
    const offByOne = [{ ...legacyRow("c|a|1|2026-09-01"), impressions: 101, spend: 10 }];
    const integerBreach = compareGoogleShadowRun({ ...base, legacyRows: legacy, runtimeRows: offByOne });
    assert.equal(integerBreach.pass, false);
    assert.ok(integerBreach.metricDifferences.find((d) => d.metric === "impressions" && !d.within));

    const roundingOk = [
      { ...legacyRow("c|a|1|2026-09-01"), impressions: 100, spend: 10 },
    ];
    const roundingRuntime = [{ ...legacyRow("c|a|1|2026-09-01"), impressions: 100, spend: 10.005 }];
    const currencyOk = compareGoogleShadowRun({ ...base, legacyRows: roundingOk, runtimeRows: roundingRuntime });
    assert.equal(currencyOk.pass, true);
    assert.deepEqual(currencyOk.tolerances, {
      impressions: 0,
      clicks: 0,
      conversions: 0,
      campaignCount: 0,
      spend: 0.01,
      conversionValue: 0.01,
    });
  });
});
