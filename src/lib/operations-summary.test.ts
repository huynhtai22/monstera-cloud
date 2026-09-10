import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OPERATIONS_DELIVERY_RECENCY_MS,
  OPERATIONS_LIST_LIMIT,
  OPERATIONS_SUMMARY_VERSION,
  operationsSection,
  operationsSummaryQuerySchema,
  operationsUnavailableSection,
  operationsUnsupportedSection,
  sanitizeEvidenceText,
  summarizeAnomalies,
  summarizeConnectorHealth,
  summarizeDelivery,
  summarizeFreshness,
  summarizeIngestion,
  summarizeReadiness,
  type ConnectorHealthRow,
  type DeliveryReceiptRow,
  type FreshnessRow,
} from "./operations-summary";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

describe("operations summary: sanitization", () => {
  it("strips control characters, collapses whitespace and returns null for blanks", () => {
    assert.equal(sanitizeEvidenceText("  token\n\texpired\u0000  "), "token expired");
    assert.equal(sanitizeEvidenceText(""), null);
    assert.equal(sanitizeEvidenceText("   "), null);
    assert.equal(sanitizeEvidenceText(null), null);
    assert.equal(sanitizeEvidenceText(undefined), null);
  });

  it("redacts long opaque tokens and truncates to the bound", () => {
    const secret = "a".repeat(48);
    const sanitized = sanitizeEvidenceText(`refresh failed ${secret} end`);
    assert.equal(sanitized, "refresh failed [redacted] end");

    // A single oversized token collapses entirely to the redaction marker.
    assert.equal(sanitizeEvidenceText("x".repeat(500)), "[redacted]");

    // Ordinary prose is truncated at the bound, with an explicit ellipsis.
    const long = sanitizeEvidenceText(Array.from({ length: 300 }, () => "word").join(" "));
    assert.ok(long);
    assert.equal(long!.length, 200);
    assert.ok(long!.endsWith("…"));
  });

  it("keeps ordinary short text intact", () => {
    assert.equal(sanitizeEvidenceText("HTTP 401 Unauthorized"), "HTTP 401 Unauthorized");
  });
});

describe("operations summary: connector health", () => {
  const rows: ConnectorHealthRow[] = [
    { connectionId: "c2", provider: "meta_ads", accountId: "act_9", accountName: "B", status: "degraded", errorCategory: "RATE_LIMITED", consecutiveFailures: 2, lastError: "slow down", lastSuccessAt: null },
    { connectionId: "c1", provider: "google_ads", accountId: "111", accountName: "A", status: "healthy", errorCategory: null, consecutiveFailures: 0, lastError: null, lastSuccessAt: NOW },
    { connectionId: "c1", provider: "google_ads", accountId: "222", accountName: null, status: "quarantined", errorCategory: "PERMISSION_DENIED", consecutiveFailures: 3, lastError: "denied", lastSuccessAt: null },
    { connectionId: "c3", provider: "shopee", accountId: "s1", accountName: null, status: "reconnect_required", errorCategory: "AUTH_EXPIRED", consecutiveFailures: 1, lastError: null, lastSuccessAt: null },
    { connectionId: "c4", provider: "lazada", accountId: "l1", accountName: null, status: "something_new", errorCategory: null, consecutiveFailures: 0, lastError: null, lastSuccessAt: null },
  ];

  it("aggregates every status without collapsing unknown into healthy", () => {
    const data = summarizeConnectorHealth(rows);
    assert.deepEqual(data.totals, {
      total: 5,
      healthy: 1,
      degraded: 1,
      quarantined: 1,
      reconnectRequired: 1,
      unknown: 1,
    });
    assert.equal(data.quarantineThreshold, 3);
    assert.equal(data.attention.length, 4);
    assert.equal(data.attention.some((row) => row.status === "healthy"), false);
  });

  it("orders attention deterministically and is stable across input order", () => {
    const forward = summarizeConnectorHealth(rows);
    const reversed = summarizeConnectorHealth([...rows].reverse());
    assert.deepEqual(forward.attention, reversed.attention);
    assert.deepEqual(
      forward.attention.map((row) => `${row.status}:${row.provider}:${row.accountId}`),
      ["degraded:meta_ads:act_9", "quarantined:google_ads:222", "reconnect_required:shopee:s1", "unknown:lazada:l1"],
    );
  });

  it("bounds the attention list and sanitizes error text", () => {
    const many: ConnectorHealthRow[] = Array.from({ length: OPERATIONS_LIST_LIMIT + 5 }, (_, index) => ({
      connectionId: `c${index}`,
      provider: "google_ads",
      accountId: `acct_${String(index).padStart(3, "0")}`,
      accountName: null,
      status: "degraded",
      errorCategory: "UNKNOWN",
      consecutiveFailures: 1,
      lastError: `line\nbreak ${"z".repeat(40)}`,
      lastSuccessAt: null,
    }));
    const data = summarizeConnectorHealth(many, { limit: OPERATIONS_LIST_LIMIT });
    assert.equal(data.totals.total, OPERATIONS_LIST_LIMIT + 5);
    assert.equal(data.attention.length, OPERATIONS_LIST_LIMIT);
    assert.equal(data.attention[0]!.lastErrorSummary, "line break [redacted]");
  });
});

describe("operations summary: freshness with an injected clock", () => {
  const base: FreshnessRow = {
    id: "conn_1",
    provider: "google_ads",
    name: "Google",
    status: "connected",
    lastError: null,
    lastSyncAt: NOW,
    lastDataThrough: NOW,
  };

  it("treats exactly 24h as fresh and one millisecond beyond as stale", () => {
    const exactly = summarizeFreshness([{ ...base, lastSyncAt: new Date(NOW.getTime() - 24 * HOUR_MS) }], { now: NOW });
    assert.equal(exactly.totals.fresh, 1);
    assert.equal(exactly.totals.stale, 0);

    const beyond = summarizeFreshness(
      [{ ...base, lastSyncAt: new Date(NOW.getTime() - 24 * HOUR_MS - 1) }],
      { now: NOW },
    );
    assert.equal(beyond.totals.stale, 1);
    assert.equal(beyond.totals.fresh, 0);
    assert.equal(beyond.attention[0]!.state, "stale");
  });

  it("reports both thresholds distinctly and never claims they are the same", () => {
    const data = summarizeFreshness([], { now: NOW });
    assert.equal(data.sourceFreshnessHours, 24);
    assert.equal(data.escalationHours, 26);
  });

  it("classifies disconnected, partial and errored sources as needing attention", () => {
    const data = summarizeFreshness(
      [
        { ...base, id: "a", status: "disconnected" },
        { ...base, id: "b", lastError: "[partial] 2 of 5 accounts failed" },
        { ...base, id: "c", lastError: "boom" },
        { ...base, id: "d", status: "connected", lastSyncAt: null },
      ],
      { now: NOW },
    );
    assert.equal(data.totals.disconnected, 1);
    assert.equal(data.totals.partial, 1);
    assert.equal(data.totals.error, 1);
    assert.equal(data.totals.pending, 1);
    assert.equal(data.totals.fresh, 0);
    assert.equal(data.attention.length, 4);
  });

  it("is deterministic and bounded", () => {
    const rows: FreshnessRow[] = Array.from({ length: OPERATIONS_LIST_LIMIT + 3 }, (_, index) => ({
      ...base,
      id: `conn_${String(index).padStart(3, "0")}`,
      status: "disconnected",
    }));
    const first = summarizeFreshness(rows, { now: NOW });
    const second = summarizeFreshness([...rows].reverse(), { now: NOW });
    assert.deepEqual(first.attention, second.attention);
    assert.equal(first.attention.length, OPERATIONS_LIST_LIMIT);
  });
});

describe("operations summary: ingestion", () => {
  const jobs = [
    { id: "j1", status: "failed", errorMsg: "boom\nx", finishedAt: new Date("2026-09-10T10:00:00.000Z"), since: "2026-09-01", until: "2026-09-07" },
    { id: "j2", status: "completed", errorMsg: null, finishedAt: new Date("2026-09-10T11:00:00.000Z"), since: "2026-09-01", until: "2026-09-07" },
    { id: "j3", status: "partial", errorMsg: null, finishedAt: new Date("2026-09-10T09:00:00.000Z"), since: "2026-09-01", until: "2026-09-07" },
    { id: "j4", status: "queued", errorMsg: null, finishedAt: null, since: "2026-09-01", until: "2026-09-07" },
    { id: "j5", status: "running", errorMsg: null, finishedAt: null, since: "2026-09-01", until: "2026-09-07" },
  ];
  const logs = [
    { id: "l1", pipelineId: "p1", status: "error", errorMsg: "nope", createdAt: new Date("2026-09-10T08:00:00.000Z") },
    { id: "l2", pipelineId: "p2", status: "failed", errorMsg: null, createdAt: new Date("2026-09-10T09:00:00.000Z") },
  ];

  it("counts each job status and lists failures newest-first", () => {
    const data = summarizeIngestion(jobs, logs, { windowDays: 7 });
    assert.deepEqual(data.totals, { total: 5, queued: 1, running: 1, completed: 1, partial: 1, failed: 1 });
    assert.equal(data.windowDays, 7);
    assert.deepEqual(data.recentFailures.map((failure) => failure.id), ["j1", "j3"]);
    assert.equal(data.recentFailures[0]!.errorSummary, "boom x");
  });

  it("orders sync-log errors newest-first and bounds both lists", () => {
    const data = summarizeIngestion(jobs, logs);
    assert.deepEqual(data.syncLogErrors.map((row) => row.id), ["l2", "l1"]);

    const many = Array.from({ length: OPERATIONS_LIST_LIMIT + 4 }, (_, index) => ({
      id: `e${String(index).padStart(3, "0")}`,
      pipelineId: "p",
      status: "error",
      errorMsg: null,
      createdAt: new Date("2026-09-10T00:00:00.000Z"),
    }));
    const bounded = summarizeIngestion([], many);
    assert.equal(bounded.syncLogErrors.length, OPERATIONS_LIST_LIMIT);
  });

  it("reports zero totals for an empty workspace without inventing evidence", () => {
    const data = summarizeIngestion([], []);
    assert.deepEqual(data.totals, { total: 0, queued: 0, running: 0, completed: 0, partial: 0, failed: 0 });
    assert.deepEqual(data.recentFailures, []);
    assert.deepEqual(data.syncLogErrors, []);
  });
});

describe("operations summary: readiness", () => {
  const window = { start: "2026-09-03", end: "2026-09-09" };

  it("aggregates verdicts, dedupes codes and orders by client id", () => {
    const data = summarizeReadiness(
      [
        { clientId: "cl_b", status: "NOT_READY", blockers: [{ code: "SYNC_FAILED" }, { code: "SYNC_FAILED" }], warnings: [] },
        { clientId: "cl_a", status: "READY", blockers: [], warnings: [] },
        { clientId: "cl_c", status: "WARNING", blockers: [], warnings: [{ code: "MIXED_CURRENCY" }] },
        { clientId: "cl_d", status: "UNKNOWN", blockers: [], warnings: [{ code: "TIMEZONE_UNKNOWN" }] },
      ],
      { window, clientNames: new Map([["cl_b", "Bravo"]]) },
    );
    assert.deepEqual(data.totals, { ready: 1, notReady: 1, warning: 1, unknown: 1 });
    assert.equal(data.evaluatedClients, 4);
    assert.deepEqual(data.clients.map((client) => client.clientId), ["cl_a", "cl_b", "cl_c", "cl_d"]);
    assert.deepEqual(data.clients[1]!.blockers, ["SYNC_FAILED"]);
    assert.equal(data.clients[1]!.clientName, "Bravo");
    assert.equal(data.clients[0]!.clientName, "cl_a");
    assert.deepEqual(data.window, window);
  });

  it("returns empty totals for no evaluations", () => {
    const data = summarizeReadiness([], { window });
    assert.deepEqual(data.totals, { ready: 0, notReady: 0, warning: 0, unknown: 0 });
    assert.equal(data.evaluatedClients, 0);
    assert.deepEqual(data.clients, []);
  });
});

describe("operations summary: delivery", () => {
  const receipt = (overrides: Partial<DeliveryReceiptRow> & { id: string }): DeliveryReceiptRow => ({
    clientId: "cl_a",
    destination: "google_sheets",
    windowStart: "2026-09-01",
    windowEnd: "2026-09-07",
    dataThroughDate: "2026-09-07",
    rowCount: 10,
    retrievedAt: NOW,
    ...overrides,
  });

  it("keeps only the latest receipt per client and destination", () => {
    const data = summarizeDelivery(
      [
        receipt({ id: "r1", retrievedAt: new Date(NOW.getTime() - 2 * HOUR_MS), rowCount: 1 }),
        receipt({ id: "r2", retrievedAt: NOW, rowCount: 2 }),
        receipt({ id: "r3", destination: "looker", rowCount: 3 }),
      ],
      { now: NOW },
    );
    assert.equal(data.totals.receipts, 2);
    assert.equal(data.totals.clients, 1);
    assert.deepEqual(data.latest.map((entry) => `${entry.destination}:${entry.rowCount}`), ["google_sheets:2", "looker:3"]);
  });

  it("marks receipts older than the recency window as stale using the injected clock", () => {
    const fresh = summarizeDelivery([receipt({ id: "r1", retrievedAt: new Date(NOW.getTime() - OPERATIONS_DELIVERY_RECENCY_MS) })], { now: NOW });
    assert.equal(fresh.latest[0]!.stale, false);
    assert.equal(fresh.totals.stale, 0);

    const stale = summarizeDelivery(
      [receipt({ id: "r2", retrievedAt: new Date(NOW.getTime() - OPERATIONS_DELIVERY_RECENCY_MS - 1) })],
      { now: NOW },
    );
    assert.equal(stale.latest[0]!.stale, true);
    assert.equal(stale.totals.stale, 1);
    assert.equal(stale.recencyHours, 168);
  });

  it("is empty and deterministic with no receipts", () => {
    const data = summarizeDelivery([], { now: NOW });
    assert.equal(data.totals.receipts, 0);
    assert.deepEqual(data.latest, []);
  });
});

describe("operations summary: anomalies", () => {
  it("orders critical first, bounds the list and counts severities", () => {
    const data = summarizeAnomalies(
      [
        { id: "w1", type: "cpa_surge", severity: "warning", platform: "meta_ads", campaignName: "B" },
        { id: "c1", type: "zero_conversion_burn", severity: "critical", platform: "google_ads", campaignName: "A" },
      ],
      { windowDays: 14 },
    );
    assert.deepEqual(data.totals, { total: 2, critical: 1, warning: 1 });
    assert.deepEqual(data.items.map((item) => item.id), ["c1", "w1"]);
    assert.equal(data.windowDays, 14);
    assert.equal(data.items[0]!.clientId, null);
    assert.equal(data.items[0]!.accountName, null);
  });

  it("is empty with no anomalies", () => {
    const data = summarizeAnomalies([]);
    assert.deepEqual(data.totals, { total: 0, critical: 0, warning: 0 });
    assert.deepEqual(data.items, []);
  });
});

describe("operations summary: section states", () => {
  it("distinguishes empty from ready and from attention", () => {
    const empty = operationsSection({ value: 0 }, { attention: false, empty: true, truncated: false, limit: 25, href: "/sources" });
    const ready = operationsSection({ value: 0 }, { attention: false, empty: false, truncated: false, limit: 25, href: "/sources" });
    const attention = operationsSection({ value: 1 }, { attention: true, empty: false, truncated: true, limit: 25, href: "/sources" });
    assert.equal(empty.state, "empty");
    assert.equal(ready.state, "ready");
    assert.equal(attention.state, "attention");
    assert.equal(attention.truncated, true);
    assert.equal(empty.reason, null);
  });

  it("never attaches data or a healthy state to unsupported/unavailable evidence", () => {
    const unsupported = operationsUnsupportedSection<{ value: number }>("import_jobs_not_client_attributable", "/reports");
    const unavailable = operationsUnavailableSection<{ value: number }>("/reports");
    assert.equal(unsupported.state, "unsupported");
    assert.equal(unsupported.data, null);
    assert.equal(unsupported.reason, "import_jobs_not_client_attributable");
    assert.equal(unavailable.state, "unavailable");
    assert.equal(unavailable.data, null);
    assert.equal(unavailable.limit, 0);
    assert.equal(unavailable.reason, "operations_section_unavailable");
  });

  it("exposes only internal application paths as navigation targets", () => {
    const targets = [
      operationsSection({}, { attention: false, empty: false, truncated: false, limit: 1, href: "/sources" }).href,
      operationsUnsupportedSection("import_jobs_not_client_attributable", "/reports").href,
      operationsUnavailableSection("/clients").href,
    ];
    for (const href of targets) {
      assert.ok(href.startsWith("/"), `${href} must be an internal path`);
      assert.equal(/^[a-z]+:/i.test(href), false, `${href} must not be absolute or external`);
    }
  });
});

describe("operations summary: query contract", () => {
  it("accepts a workspace with and without client context", () => {
    assert.deepEqual(operationsSummaryQuerySchema.parse({ workspaceId: "ws_1" }), { workspaceId: "ws_1" });
    assert.deepEqual(
      operationsSummaryQuerySchema.parse({ workspaceId: "ws_1", clientId: "cl_a" }),
      { workspaceId: "ws_1", clientId: "cl_a" },
    );
  });

  it("rejects missing, oversized, unknown and structurally invalid input", () => {
    assert.equal(operationsSummaryQuerySchema.safeParse({}).success, false);
    assert.equal(operationsSummaryQuerySchema.safeParse({ workspaceId: "has space" }).success, false);
    assert.equal(operationsSummaryQuerySchema.safeParse({ workspaceId: "x".repeat(161) }).success, false);
    assert.equal(operationsSummaryQuerySchema.safeParse({ workspaceId: "ws_1", clientId: "x".repeat(161) }).success, false);
    assert.equal(operationsSummaryQuerySchema.safeParse({ workspaceId: "ws_1", extra: "1" }).success, false);
    assert.equal(operationsSummaryQuerySchema.safeParse({ workspaceId: "ws_1", clientId: 5 }).success, false);
  });

  it("publishes a stable contract version", () => {
    assert.equal(OPERATIONS_SUMMARY_VERSION, "operations-summary-v1");
  });
});

describe("operations summary: truncated evidence", () => {
  it("fails closed on truncation instead of reporting ready or empty", () => {
    const truncatedClean = operationsSection(
      { value: 0 },
      { attention: false, empty: false, truncated: true, limit: 25, href: "/sources" },
    );
    assert.equal(truncatedClean.state, "attention");
    assert.equal(truncatedClean.truncated, true);

    const truncatedEmpty = operationsSection(
      { value: 0 },
      { attention: false, empty: true, truncated: true, limit: 25, href: "/clients" },
    );
    assert.equal(truncatedEmpty.state, "attention");
    assert.equal(truncatedEmpty.truncated, true);

    // Untruncated sections keep the original, non-fail-closed semantics.
    assert.equal(
      operationsSection({ value: 0 }, { attention: false, empty: true, truncated: false, limit: 25, href: "/sources" }).state,
      "empty",
    );
    assert.equal(
      operationsSection({ value: 0 }, { attention: false, empty: false, truncated: false, limit: 25, href: "/sources" }).state,
      "ready",
    );
  });
});
