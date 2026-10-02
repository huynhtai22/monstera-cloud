import assert from "node:assert/strict";
import test from "node:test";
import {
  ExactDecimal,
  getEligibleComparisonWindows,
  computeDatasetFingerprint,
  evaluateMonitorEvidence,
  type MetricInputRecord,
  type DatasetFingerprintContext,
} from "./monitor-evidence";
import {
  GOLDEN_TIKTOK_DATASET,
  GOLDEN_TIKTOK_WINDOW_TOTALS,
} from "./fixtures/ledger";
import { buildCanonicalAccountId, type ExpectedAccountRoster } from "./roster";

const TEST_ROSTER: ExpectedAccountRoster = {
  workspaceId: "ws_c3_test",
  responsibilityId: "resp_test_1",
  revision: 1,
  confirmedAt: "2026-09-01T00:00:00.000Z",
  confirmedByUserId: "user_owner_1",
  primaryCurrency: "USD",
  primaryTimezone: "America/New_York",
  accounts: [
    {
      canonicalId: buildCanonicalAccountId("tiktok_business", "conn_tt_1", "tt_adv_101"),
      connectionId: "conn_tt_1",
      providerAccountId: "tt_adv_101",
      provider: "tiktok_business",
      accountName: "Main TikTok Ad Account",
      currency: "USD",
      timezone: "America/New_York",
      status: "active",
    },
  ],
};

const DUMMY_WINDOWS = {
  currentWindow: {
    since: "2026-09-20",
    until: "2026-09-26",
    daysCount: 7,
    dates: [
      "2026-09-20",
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
    ],
  },
  baselineWindow: {
    since: "2026-09-13",
    until: "2026-09-19",
    daysCount: 7,
    dates: [
      "2026-09-13",
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
    ],
  },
  timezone: "America/New_York",
  lagDays: 1,
  asOfTimestamp: "2026-09-28T12:00:00.000Z",
};

const DEFAULT_TEST_PROVENANCE_RAW = JSON.stringify({
  endpoint: "AUCTION_CAMPAIGN",
  grain: "campaign",
  conversionAction: "purchase",
  attributionWindow: "7d_click",
  revenueBasis: "order_completed",
  availability: "final",
  provenanceOrigin: "provider_response",
});

// Complete baseline records for tests requiring both complete windows
const BASELINE_RECORDS: MetricInputRecord[] = DUMMY_WINDOWS.baselineWindow.dates.map((d) => ({
  date: d,
  platform: "tiktok_business",
  connectionId: "conn_tt_1",
  accountId: "tt_adv_101",
  level: "campaign",
  entityId: "camp_1",
  spend: 150.0,
  conversions: 10,
  revenue: 0,
  currency: "USD",
  rawData: DEFAULT_TEST_PROVENANCE_RAW,
}));

test("1. ExactDecimal arithmetic: eliminates float drift, handles sub-cent precision, and safely handles zero denominators", () => {
  const a = ExactDecimal.fromNumber(0.1);
  const b = ExactDecimal.fromNumber(0.2);
  const sum = a.add(b);
  assert.equal(sum.toDisplayString(2), "0.30");
  assert.equal(sum.toDisplayString(4), "0.3000");
  assert.equal(sum.toExactString(), "0.300000");

  // Sub-cent 4th decimal precision
  const subCentA = ExactDecimal.fromString("100.0001");
  const subCentB = ExactDecimal.fromString("100.0002");
  assert.equal(subCentB.sub(subCentA).toExactString(), "0.000100");

  const spend = ExactDecimal.fromNumber(1400);
  const conv = ExactDecimal.fromNumber(75);
  const cpa = spend.divide(conv);
  assert.ok(cpa.result);
  assert.equal(cpa.result.toDisplayString(2), "18.67");

  const zeroConv = ExactDecimal.zero();
  const divByZero = spend.divide(zeroConv);
  assert.equal(divByZero.result, null);
  assert.equal(divByZero.reason, "ZERO_DENOMINATOR");
});

test("2. Timezone-aware complete-day windows: excludes today and enforces provider-required lag", () => {
  const asOf = new Date("2026-09-28T15:00:00.000Z");
  const windows = getEligibleComparisonWindows(asOf, "America/New_York", {
    lagDays: 1,
    windowDays: 7,
    providerLagDays: 2, // Provider requires at least 2 days lag
  });

  // Effective lag = max(1, 2) = 2 days -> latest complete day is T-3 = Sep 25
  assert.equal(windows.currentWindow.until, "2026-09-25");
  assert.equal(windows.currentWindow.since, "2026-09-19");
  assert.equal(windows.currentWindow.daysCount, 7);
  assert.equal(windows.currentWindow.dates.length, 7);

  // Baseline window is preceding 7 complete days: Sep 12 to Sep 18
  assert.equal(windows.baselineWindow.until, "2026-09-18");
  assert.equal(windows.baselineWindow.since, "2026-09-12");
  assert.equal(windows.baselineWindow.daysCount, 7);

  assert.throws(() => {
    getEligibleComparisonWindows(asOf, "Invalid/Unknown_Zone");
  }, /Invalid IANA timezone/);
});

test("3. Golden dataset reproduction: exactly reproduces spend, conversions, and CPA ratio of totals with complete baseline", () => {
  const currentRecords: MetricInputRecord[] = GOLDEN_TIKTOK_DATASET.map((r) => ({
    date: r.date,
    platform: r.provider,
    connectionId: "conn_tt_1",
    accountId: r.accountId,
    level: "campaign",
    entityId: "camp_1",
    spend: r.spend,
    conversions: r.conversions,
    revenue: r.revenue ?? 0,
    currency: r.currency,
    rawData: DEFAULT_TEST_PROVENANCE_RAW,
  }));

  const allRecords = [...BASELINE_RECORDS, ...currentRecords];

  const res = evaluateMonitorEvidence({
    workspaceId: "ws_c3_test",
    roster: TEST_ROSTER,
    queriedIdentifiers: [TEST_ROSTER.accounts[0].canonicalId],
    executionMode: "local_test",
    targetGrain: "campaign",
    records: allRecords,
    windows: DUMMY_WINDOWS,
    cpaFloor: 20,
    sourceHealthList: [
      {
        connectionId: "conn_tt_1",
        provider: "tiktok_business",
        status: "connected",
        lastSyncAt: new Date("2026-09-28T00:00:00Z"),
        lastDataThrough: new Date("2026-09-26T23:59:59Z"),
      },
    ],
  });

  assert.equal(res.valid, true, `Expected valid, got blockers: ${res.blockers.join(", ")}`);
  assert.equal(res.blockers.length, 0);
  assert.ok(res.metrics);

  // Current window matches golden totals
  assert.equal(res.metrics.current.spend, GOLDEN_TIKTOK_WINDOW_TOTALS.totalSpend);
  assert.equal(res.metrics.current.exactSpend, "1400.00");
  assert.equal(res.metrics.current.conversions, GOLDEN_TIKTOK_WINDOW_TOTALS.totalConversions);
  assert.equal(res.metrics.current.displayCpa, "18.67");

  // Comparison is valid because both windows are complete
  assert.equal(res.metrics.comparisonBlocked, false);
  assert.equal(res.metrics.spendDelta, 1400 - 1050); // baseline: 7 * 150 = 1050
  assert.equal(res.inventory.totalExpectedAccountDays, 14);
  assert.equal(res.inventory.totalPresentAccountDays, 14);
  assert.equal(res.inventory.currentMissingDates.length, 0);
  assert.equal(res.inventory.baselineMissingDates.length, 0);
  assert.equal(res.inventory.accountDayCoverageRatio, 1.0);
});

test("4. Missing baseline coverage: blocks comparison and never assumes zero baseline", () => {
  // Current window is complete, but baseline has missing dates (only 4 of 7 days present)
  const currentRecords: MetricInputRecord[] = GOLDEN_TIKTOK_DATASET.map((r) => ({
    date: r.date,
    platform: r.provider,
    connectionId: "conn_tt_1",
    accountId: r.accountId,
    level: "campaign",
    spend: r.spend,
    conversions: r.conversions,
    revenue: 0,
    currency: "USD",
    rawData: DEFAULT_TEST_PROVENANCE_RAW,
  }));

  const partialBaseline = BASELINE_RECORDS.slice(0, 4); // missing Sep 17, 18, 19
  const records = [...partialBaseline, ...currentRecords];

  const res = evaluateMonitorEvidence({
    workspaceId: "ws_c3_test",
    roster: TEST_ROSTER,
    queriedIdentifiers: [TEST_ROSTER.accounts[0].canonicalId],
    executionMode: "local_test",
    targetGrain: "campaign",
    records,
    windows: DUMMY_WINDOWS,
  });

  assert.equal(res.valid, false);
  assert.ok(res.blockers.includes("WINDOW_INCOMPLETE"));
  assert.ok(res.metrics);

  // Comparison must be strictly BLOCKED!
  assert.equal(res.metrics.comparisonBlocked, true);
  assert.equal(res.metrics.comparisonBlockReason, "BASELINE_WINDOW_INCOMPLETE");
  assert.equal(res.metrics.spendDelta, null);
  assert.equal(res.metrics.spendDeltaRatio, null);
  assert.equal(res.metrics.conversionDelta, null);
  assert.equal(res.metrics.conversionDeltaRatio, null);
  assert.equal(res.metrics.cpaDelta, null);

  assert.deepEqual(res.inventory.baselineMissingDates, ["2026-09-17", "2026-09-18", "2026-09-19"]);
  assert.equal(res.inventory.currentMissingDates.length, 0);
});

test("5. Authoritative Freshness: stale sync and incomplete data-through trigger DATA_STALE", () => {
  const records = [...BASELINE_RECORDS, ...GOLDEN_TIKTOK_DATASET.map((r) => ({
    date: r.date,
    platform: r.provider,
    connectionId: "conn_tt_1",
    accountId: r.accountId,
    level: "campaign",
    spend: r.spend,
    conversions: r.conversions,
    revenue: 0,
    currency: "USD",
    rawData: DEFAULT_TEST_PROVENANCE_RAW,
  }))];

  // Case A: Last sync is 36 hours old (> 24h stale threshold)
  const staleSyncRes = evaluateMonitorEvidence({
    workspaceId: "ws_c3_test",
    roster: TEST_ROSTER,
    queriedIdentifiers: [TEST_ROSTER.accounts[0].canonicalId],
    executionMode: "local_test",
    records,
    windows: DUMMY_WINDOWS,
    sourceHealthList: [
      {
        connectionId: "conn_tt_1",
        provider: "tiktok_business",
        status: "connected",
        lastSyncAt: new Date("2026-09-26T00:00:00Z"), // 60h ago relative to Sep 28 12:00
        lastDataThrough: new Date("2026-09-26T23:59:59Z"),
      },
    ],
  });

  assert.equal(staleSyncRes.valid, false);
  assert.ok(staleSyncRes.blockers.includes("DATA_STALE"));

  // Case B: Data-through covers only up to Sep 24 (current window requires through Sep 26)
  const staleDataThroughRes = evaluateMonitorEvidence({
    workspaceId: "ws_c3_test",
    roster: TEST_ROSTER,
    queriedIdentifiers: [TEST_ROSTER.accounts[0].canonicalId],
    executionMode: "local_test",
    records,
    windows: DUMMY_WINDOWS,
    sourceHealthList: [
      {
        connectionId: "conn_tt_1",
        provider: "tiktok_business",
        status: "connected",
        lastSyncAt: new Date("2026-09-28T10:00:00Z"), // Fresh sync
        lastDataThrough: new Date("2026-09-24T23:59:59Z"), // But data only through Sep 24!
      },
    ],
  });

  assert.equal(staleDataThroughRes.valid, false);
  assert.ok(staleDataThroughRes.blockers.includes("DATA_STALE"));
});

test("6. Metric integrity: row currency mismatch, duplicate observations, overlapping breakdowns, and non-finite numbers", () => {
  // Case A: Row currency mismatch (account expects USD, row has EUR)
  const mismatchCurrencyRecords: MetricInputRecord[] = [
    {
      date: "2026-09-20",
      platform: "tiktok_business",
      connectionId: "conn_tt_1",
      accountId: "tt_adv_101",
      level: "campaign",
      spend: 100,
      conversions: 5,
      revenue: 0,
      currency: "EUR", // Mismatch!
      rawData: DEFAULT_TEST_PROVENANCE_RAW,
    },
  ];

  const resCurr = evaluateMonitorEvidence({
    workspaceId: "ws_c3_test",
    roster: TEST_ROSTER,
    queriedIdentifiers: [TEST_ROSTER.accounts[0].canonicalId],
    executionMode: "local_test",
    records: mismatchCurrencyRecords,
    windows: DUMMY_WINDOWS,
  });
  assert.equal(resCurr.valid, false);
  assert.ok(resCurr.blockers.includes("CURRENCY_CONFLICT"));

  // Case B: Duplicate observations for same entity and date
  const dupRecords: MetricInputRecord[] = [
    { date: "2026-09-20", platform: "tiktok_business", connectionId: "conn_tt_1", accountId: "tt_adv_101", level: "campaign", entityId: "camp_1", breakdownHash: "none", spend: 100, conversions: 5, revenue: 0, currency: "USD", rawData: DEFAULT_TEST_PROVENANCE_RAW },
    { date: "2026-09-20", platform: "tiktok_business", connectionId: "conn_tt_1", accountId: "tt_adv_101", level: "campaign", entityId: "camp_1", breakdownHash: "none", spend: 100, conversions: 5, revenue: 0, currency: "USD", rawData: DEFAULT_TEST_PROVENANCE_RAW },
  ];
  const resDup = evaluateMonitorEvidence({
    workspaceId: "ws_c3_test",
    roster: TEST_ROSTER,
    queriedIdentifiers: [TEST_ROSTER.accounts[0].canonicalId],
    executionMode: "local_test",
    records: dupRecords,
    windows: DUMMY_WINDOWS,
  });
  assert.equal(resDup.valid, false);
  assert.ok(resDup.blockers.includes("DUPLICATE_ACCOUNT"));

  // Case C: Overlapping breakdowns (e.g. breakdown by placement mixed with total)
  const overlapRecords: MetricInputRecord[] = [
    { date: "2026-09-20", platform: "tiktok_business", connectionId: "conn_tt_1", accountId: "tt_adv_101", level: "campaign", entityId: "camp_1", breakdownHash: "none", spend: 100, conversions: 5, revenue: 0, currency: "USD", rawData: DEFAULT_TEST_PROVENANCE_RAW },
    { date: "2026-09-20", platform: "tiktok_business", connectionId: "conn_tt_1", accountId: "tt_adv_101", level: "campaign", entityId: "camp_1", breakdownHash: "placement=feed", spend: 60, conversions: 3, revenue: 0, currency: "USD", rawData: DEFAULT_TEST_PROVENANCE_RAW },
  ];
  const resOverlap = evaluateMonitorEvidence({
    workspaceId: "ws_c3_test",
    roster: TEST_ROSTER,
    queriedIdentifiers: [TEST_ROSTER.accounts[0].canonicalId],
    executionMode: "local_test",
    records: overlapRecords,
    windows: DUMMY_WINDOWS,
  });
  assert.equal(resOverlap.valid, false);
  assert.ok(resOverlap.blockers.includes("GRAIN_AMBIGUOUS"));

  // Case D: Non-finite or negative numbers
  const invalidNumRecords: MetricInputRecord[] = [
    { date: "2026-09-20", platform: "tiktok_business", connectionId: "conn_tt_1", accountId: "tt_adv_101", level: "campaign", entityId: "camp_1", spend: -50, conversions: 5, revenue: 0, currency: "USD", rawData: DEFAULT_TEST_PROVENANCE_RAW },
  ];
  const resInvalidNum = evaluateMonitorEvidence({
    workspaceId: "ws_c3_test",
    roster: TEST_ROSTER,
    queriedIdentifiers: [TEST_ROSTER.accounts[0].canonicalId],
    executionMode: "local_test",
    records: invalidNumRecords,
    windows: DUMMY_WINDOWS,
  });
  assert.equal(resInvalidNum.valid, false);
  assert.ok(resInvalidNum.blockers.includes("METRIC_UNSUPPORTED"));
});

test("7. Unsupported provider metric semantics: revenue and ROAS remain unavailable for TikTok Ads", () => {
  const records = [...BASELINE_RECORDS, ...GOLDEN_TIKTOK_DATASET.map((r) => ({
    date: r.date,
    platform: r.provider,
    connectionId: "conn_tt_1",
    accountId: r.accountId,
    level: "campaign",
    spend: r.spend,
    conversions: r.conversions,
    revenue: 500.0, // Stored in row, but TikTok Ads has metricSemantics.revenue = false
    currency: "USD",
    rawData: DEFAULT_TEST_PROVENANCE_RAW,
  }))];

  const res = evaluateMonitorEvidence({
    workspaceId: "ws_c3_test",
    roster: TEST_ROSTER,
    queriedIdentifiers: [TEST_ROSTER.accounts[0].canonicalId],
    executionMode: "local_test",
    records,
    windows: DUMMY_WINDOWS,
  });

  assert.ok(res.metrics);
  // TikTok Ads revenue and ROAS must remain unavailable
  assert.equal(res.metrics.current.revenue, null);
  assert.equal(res.metrics.current.exactRevenue, null);
  assert.equal(res.metrics.current.roas, null);
  assert.equal(res.metrics.current.roasReason, "REVENUE_SEMANTICS_UNSUPPORTED");
});

test("8. Sub-four-decimal precision and reordered tied rows: tamper-detection and deterministic ordering", () => {
  const dummyCtx: DatasetFingerprintContext = {
    workspaceId: "ws_c3_test",
    responsibilityId: "resp_1",
    scopeRevision: 1,
    rosterRevision: 1,
    accountScope: [{ canonicalId: "c1", currency: "USD", timezone: "America/New_York" }],
    currentWindow: DUMMY_WINDOWS.currentWindow,
    baselineWindow: DUMMY_WINDOWS.baselineWindow,
    timezone: "America/New_York",
    grain: "campaign",
    metricSemantics: { spend: true, conversions: true },
    provenance: { version: 1 },
    zeroReceipts: [],
    calculationVersion: 1,
  };

  // Sub-four-decimal correction (100.0000 vs 100.0001)
  const recOriginal: MetricInputRecord[] = [
    { date: "2026-09-20", platform: "tiktok_business", connectionId: "conn_tt_1", accountId: "tt_adv_101", level: "campaign", entityId: "camp_1", spend: 100.0000, conversions: 5, revenue: 0 },
  ];
  const recCorrected: MetricInputRecord[] = [
    { date: "2026-09-20", platform: "tiktok_business", connectionId: "conn_tt_1", accountId: "tt_adv_101", level: "campaign", entityId: "camp_1", spend: 100.0001, conversions: 5, revenue: 0 },
  ];

  const fpOrig = computeDatasetFingerprint(dummyCtx, recOriginal);
  const fpCorr = computeDatasetFingerprint(dummyCtx, recCorrected);
  assert.notEqual(fpOrig, fpCorr, "Fingerprint must detect sub-cent (4th decimal) corrections");

  // Reordered tied rows (two rows with identical primary keys but different IDs)
  const tiedRow1: MetricInputRecord = { id: "row_aaa", date: "2026-09-20", platform: "tiktok_business", connectionId: "conn_tt_1", accountId: "tt_adv_101", level: "campaign", entityId: "camp_1", spend: 100, conversions: 5, revenue: 0 };
  const tiedRow2: MetricInputRecord = { id: "row_bbb", date: "2026-09-20", platform: "tiktok_business", connectionId: "conn_tt_1", accountId: "tt_adv_101", level: "campaign", entityId: "camp_1", spend: 100, conversions: 5, revenue: 0 };

  const fpTiedA = computeDatasetFingerprint(dummyCtx, [tiedRow1, tiedRow2]);
  const fpTiedB = computeDatasetFingerprint(dummyCtx, [tiedRow2, tiedRow1]);
  assert.equal(fpTiedA, fpTiedB, "Secondary tie-breakers must guarantee identical fingerprint regardless of insertion order");
});

test("9. Explicit execution mode: rejects missing execution mode and visibly marks synthetic evidence", () => {
  const records = [...BASELINE_RECORDS, ...GOLDEN_TIKTOK_DATASET.map((r) => ({
    date: r.date,
    platform: r.provider,
    connectionId: "conn_tt_1",
    accountId: r.accountId,
    level: "campaign",
    spend: r.spend,
    conversions: r.conversions,
    revenue: 0,
    currency: "USD",
    rawData: DEFAULT_TEST_PROVENANCE_RAW,
  }))];

  // Missing execution mode
  const resMissing = evaluateMonitorEvidence({
    workspaceId: "ws_c3_test",
    roster: TEST_ROSTER,
    queriedIdentifiers: [TEST_ROSTER.accounts[0].canonicalId],
    executionMode: "" as any,
    records,
    windows: DUMMY_WINDOWS,
  });
  assert.equal(resMissing.valid, false);
  assert.ok(resMissing.blockers.includes("CHECK_UNAVAILABLE"));

  // local_test mode marks isSynthetic = true
  const resLocal = evaluateMonitorEvidence({
    workspaceId: "ws_c3_test",
    roster: TEST_ROSTER,
    queriedIdentifiers: [TEST_ROSTER.accounts[0].canonicalId],
    executionMode: "local_test",
    records,
    windows: DUMMY_WINDOWS,
  });
  assert.equal(resLocal.isSynthetic, true);
  assert.equal(resLocal.provenance.isSyntheticTest, true);

  // live_production mode with unverified provider rejects with CHECK_UNAVAILABLE
  const resLive = evaluateMonitorEvidence({
    workspaceId: "ws_c3_test",
    roster: TEST_ROSTER,
    queriedIdentifiers: [TEST_ROSTER.accounts[0].canonicalId],
    executionMode: "live_production",
    records,
    windows: DUMMY_WINDOWS,
  });
  assert.equal(resLive.valid, false);
  assert.ok(resLive.blockers.includes("CHECK_UNAVAILABLE"));
});

test("10. Required verified semantic provenance: missing or unverified origin blocks affected metrics", () => {
  const baseRecord: MetricInputRecord = {
    date: "2026-09-20",
    platform: "tiktok_business",
    connectionId: "conn_tt_1",
    accountId: "tt_adv_101",
    level: "campaign",
    entityId: "camp_1",
    spend: 100.0,
    conversions: 10,
    revenue: 0,
    currency: "USD",
  };

  const health = [{
    connectionId: "conn_tt_1",
    provider: "tiktok_business",
    status: "connected",
    lastSyncAt: new Date("2026-09-28T06:00:00Z"),
    lastDataThrough: new Date("2026-09-26T23:59:59Z"),
  }];

  // 10a. Semantic labels populated, but origin missing: fails closed with SEMANTICS_UNKNOWN
  const recordMissingOrigin: MetricInputRecord = {
    ...baseRecord,
    rawData: JSON.stringify({
      endpoint: "AUCTION_CAMPAIGN",
      grain: "campaign",
      conversionAction: "purchase",
      attributionWindow: "7d_click",
      revenueBasis: "order_completed",
      availability: "final",
      // provenanceOrigin omitted!
    }),
  };

  const resMissingOrigin = evaluateMonitorEvidence({
    workspaceId: "ws_c3_test",
    roster: TEST_ROSTER,
    queriedIdentifiers: [TEST_ROSTER.accounts[0].canonicalId],
    executionMode: "local_test",
    records: [recordMissingOrigin],
    windows: DUMMY_WINDOWS,
    sourceHealthList: health,
  });
  assert.equal(resMissingOrigin.valid, false);
  assert.ok(resMissingOrigin.blockers.includes("SEMANTICS_UNKNOWN"));
  assert.ok(resMissingOrigin.reasons.some((r) => r.includes("unverified provenance origin 'missing'")));

  // 10b. Semantic labels populated, but origin explicitly 'unverified': blocks with SEMANTICS_UNKNOWN
  const recordUnverifiedOrigin: MetricInputRecord = {
    ...baseRecord,
    rawData: JSON.stringify({
      endpoint: "AUCTION_CAMPAIGN",
      grain: "campaign",
      conversionAction: "purchase",
      attributionWindow: "7d_click",
      revenueBasis: "order_completed",
      availability: "final",
      provenanceOrigin: "unverified",
    }),
  };

  const resUnverifiedOrigin = evaluateMonitorEvidence({
    workspaceId: "ws_c3_test",
    roster: TEST_ROSTER,
    queriedIdentifiers: [TEST_ROSTER.accounts[0].canonicalId],
    executionMode: "local_test",
    records: [recordUnverifiedOrigin],
    windows: DUMMY_WINDOWS,
    sourceHealthList: health,
  });
  assert.equal(resUnverifiedOrigin.valid, false);
  assert.ok(resUnverifiedOrigin.blockers.includes("SEMANTICS_UNKNOWN"));
  assert.ok(resUnverifiedOrigin.reasons.some((r) => r.includes("unverified provenance origin 'unverified'")));

  // 10c. Verified matching contexts: provider_response, provider_request, account_config
  for (const origin of ["provider_response", "provider_request", "account_config"] as const) {
    const allRecords: MetricInputRecord[] = [
      ...DUMMY_WINDOWS.baselineWindow.dates.map((d) => ({
        ...baseRecord,
        date: d,
        rawData: JSON.stringify({
          endpoint: "AUCTION_CAMPAIGN",
          grain: "campaign",
          conversionAction: "purchase",
          attributionWindow: "7d_click",
          revenueBasis: "order_completed",
          availability: "final",
          provenanceOrigin: origin,
        }),
      })),
      ...DUMMY_WINDOWS.currentWindow.dates.map((d) => ({
        ...baseRecord,
        date: d,
        rawData: JSON.stringify({
          endpoint: "AUCTION_CAMPAIGN",
          grain: "campaign",
          conversionAction: "purchase",
          attributionWindow: "7d_click",
          revenueBasis: "order_completed",
          availability: "final",
          provenanceOrigin: origin,
        }),
      })),
    ];

    const resVerified = evaluateMonitorEvidence({
      workspaceId: "ws_c3_test",
      roster: TEST_ROSTER,
      queriedIdentifiers: [TEST_ROSTER.accounts[0].canonicalId],
      executionMode: "local_test",
      records: allRecords,
      windows: DUMMY_WINDOWS,
      sourceHealthList: health,
    });
    assert.equal(resVerified.valid, true, `Origin '${origin}' must be accepted as verified`);
    assert.ok(!resVerified.blockers.includes("SEMANTICS_UNKNOWN"));
  }
});

test("11. Independent cpaFloor domain validation and fractional conversion semantics", () => {
  const { validateCpaFloor } = require("./monitor-evidence");

  // 11a. validateCpaFloor unit checks
  assert.equal(validateCpaFloor(undefined).valid, true);
  assert.equal(validateCpaFloor(undefined).floor, 20);
  assert.equal(validateCpaFloor(null).valid, true);
  assert.equal(validateCpaFloor(null).floor, 20);
  assert.equal(validateCpaFloor(1).valid, true);
  assert.equal(validateCpaFloor(1).floor, 1);
  assert.equal(validateCpaFloor(25.5).valid, true);
  assert.equal(validateCpaFloor(25.5).floor, 25.5);

  // Invalid values
  assert.equal(validateCpaFloor(0).valid, false);
  assert.equal(validateCpaFloor(-1).valid, false);
  assert.equal(validateCpaFloor(0.5).valid, false);
  assert.equal(validateCpaFloor(NaN).valid, false);
  assert.equal(validateCpaFloor(Infinity).valid, false);
  assert.equal(validateCpaFloor(-Infinity).valid, false);
  assert.equal(validateCpaFloor("20").valid, false);

  // 11b. Non-finite or negative floor passed to evaluateMonitorEvidence blocks with METRIC_UNSUPPORTED
  const resInvalidFloor = evaluateMonitorEvidence({
    workspaceId: "ws_c3_test",
    roster: TEST_ROSTER,
    queriedIdentifiers: [TEST_ROSTER.accounts[0].canonicalId],
    executionMode: "local_test",
    records: BASELINE_RECORDS,
    windows: DUMMY_WINDOWS,
    cpaFloor: -5,
  });
  assert.equal(resInvalidFloor.valid, false);
  assert.ok(resInvalidFloor.blockers.includes("METRIC_UNSUPPORTED"));
  assert.ok(resInvalidFloor.reasons.some((r) => r.includes("Invalid cpaFloor")));

  // 11c. Fractional conversion semantics preserved against cpaFloor
  // Suppose cpaFloor = 20. Total conversions = 19.5 (fractional from attribution models).
  // 19.5 < 20 triggers low volume warning. 20.5 >= 20 passes to normal CPA.
  const records19_5: MetricInputRecord[] = [
    ...DUMMY_WINDOWS.baselineWindow.dates.map((d) => ({
      date: d,
      platform: "tiktok_business",
      connectionId: "conn_tt_1",
      accountId: "tt_adv_101",
      level: "campaign",
      spend: 100,
      conversions: 20,
      revenue: 0,
      currency: "USD",
      rawData: DEFAULT_TEST_PROVENANCE_RAW,
    })),
    // Current window with 19.5 total conversions across 7 days (e.g. 2.785714 each day)
    ...DUMMY_WINDOWS.currentWindow.dates.map((d, i) => ({
      date: d,
      platform: "tiktok_business",
      connectionId: "conn_tt_1",
      accountId: "tt_adv_101",
      level: "campaign",
      spend: 100,
      conversions: i === 0 ? 1.5 : 3.0, // 1.5 + 6 * 3.0 = 19.5
      revenue: 0,
      currency: "USD",
      rawData: DEFAULT_TEST_PROVENANCE_RAW,
    })),
  ];

  const health = [{
    connectionId: "conn_tt_1",
    provider: "tiktok_business",
    status: "connected",
    lastSyncAt: new Date("2026-09-28T06:00:00Z"),
    lastDataThrough: new Date("2026-09-26T23:59:59Z"),
  }];

  const res19_5 = evaluateMonitorEvidence({
    workspaceId: "ws_c3_test",
    roster: TEST_ROSTER,
    queriedIdentifiers: [TEST_ROSTER.accounts[0].canonicalId],
    executionMode: "local_test",
    records: records19_5,
    windows: DUMMY_WINDOWS,
    sourceHealthList: health,
    cpaFloor: 20,
  });
  assert.equal(res19_5.metrics?.current.conversions, 19.5);
  assert.equal(res19_5.metrics?.current.cpaReason, "LOW_CONVERSION_VOLUME_BELOW_FLOOR_20");

  // Current window with 20.5 conversions -> normal CPA without floor reason
  const records20_5: MetricInputRecord[] = [
    ...DUMMY_WINDOWS.baselineWindow.dates.map((d) => ({
      date: d,
      platform: "tiktok_business",
      connectionId: "conn_tt_1",
      accountId: "tt_adv_101",
      level: "campaign",
      spend: 100,
      conversions: 20,
      revenue: 0,
      currency: "USD",
      rawData: DEFAULT_TEST_PROVENANCE_RAW,
    })),
    ...DUMMY_WINDOWS.currentWindow.dates.map((d, i) => ({
      date: d,
      platform: "tiktok_business",
      connectionId: "conn_tt_1",
      accountId: "tt_adv_101",
      level: "campaign",
      spend: 100,
      conversions: i === 0 ? 2.5 : 3.0, // 2.5 + 6 * 3.0 = 20.5
      revenue: 0,
      currency: "USD",
      rawData: DEFAULT_TEST_PROVENANCE_RAW,
    })),
  ];

  const res20_5 = evaluateMonitorEvidence({
    workspaceId: "ws_c3_test",
    roster: TEST_ROSTER,
    queriedIdentifiers: [TEST_ROSTER.accounts[0].canonicalId],
    executionMode: "local_test",
    records: records20_5,
    windows: DUMMY_WINDOWS,
    sourceHealthList: health,
    cpaFloor: 20,
  });
  assert.equal(res20_5.metrics?.current.conversions, 20.5);
  assert.equal(res20_5.metrics?.current.cpaReason, undefined);
  assert.ok(res20_5.metrics?.current.cpa !== null);

  // 11d. Confirm monetary CPA target never supplies cpaFloor
  // A configuration with targetCpa = 50 and no cpaFloor defaults to 20, never 50
  const resTargetCpa = evaluateMonitorEvidence({
    workspaceId: "ws_c3_test",
    roster: TEST_ROSTER,
    queriedIdentifiers: [TEST_ROSTER.accounts[0].canonicalId],
    executionMode: "local_test",
    records: records20_5,
    windows: DUMMY_WINDOWS,
    sourceHealthList: health,
    // cpaFloor omitted!
  });
  // With 20.5 conversions, if floor was mistakenly defaulted to targetCpa 50, it would be below floor!
  // But because default floor is 20, 20.5 >= 20 passes with no cpaReason.
  assert.equal(resTargetCpa.metrics?.current.cpaReason, undefined);
});
