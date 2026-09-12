import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeOperationsReason,
  formatEvidenceDay,
  formatEvidenceTimestamp,
  operationsStateLabel,
  operationsStateTone,
  operationsTruncationNotice,
} from "./operations-view";

describe("operations view helpers", () => {
  it("maps every section state onto a presentation tone", () => {
    assert.equal(operationsStateTone("ready"), "ok");
    assert.equal(operationsStateTone("attention"), "warn");
    assert.equal(operationsStateTone("unavailable"), "danger");
    assert.equal(operationsStateTone("unsupported"), "info");
    assert.equal(operationsStateTone("empty"), "neutral");
  });

  it("labels every section state with non-empty copy", () => {
    const states = ["ready", "attention", "empty", "unsupported", "unavailable"] as const;
    for (const state of states) {
      const label = operationsStateLabel(state);
      assert.equal(typeof label, "string");
      assert.ok(label.length > 0, `${state} must have a label`);
    }
    assert.equal(operationsStateLabel("attention"), "Needs attention");
    assert.equal(operationsStateLabel("unsupported"), "Not applicable");
  });

  it("explains the client-scoped ingestion gap in user terms without leaking the reason code", () => {
    const copy = describeOperationsReason("import_jobs_not_client_attributable");
    assert.match(copy, /All clients/);
    assert.equal(copy.includes("import_jobs_not_client_attributable"), false);
  });

  it("falls back to a generic explanation for a missing or unknown reason", () => {
    assert.equal(describeOperationsReason(null), describeOperationsReason("operations_section_unavailable"));
    assert.equal(describeOperationsReason(undefined), describeOperationsReason("operations_section_unavailable"));
    assert.match(describeOperationsReason("some_future_reason"), /no evidence/i);
  });

  it("formats evidence timestamps and days deterministically in UTC", () => {
    assert.equal(formatEvidenceTimestamp("2026-09-04T12:34:56.000Z"), "2026-09-04 12:34 UTC");
    assert.equal(formatEvidenceTimestamp(null), "—");
    assert.equal(formatEvidenceTimestamp(undefined), "—");
    assert.equal(formatEvidenceTimestamp("not-a-date"), "not-a-date");
    assert.equal(formatEvidenceDay("2026-09-04T00:00:00.000Z"), "2026-09-04");
    assert.equal(formatEvidenceDay(null), "—");
    assert.equal(formatEvidenceDay("nonsense"), "nonsense");
  });

  it("phrases the truncation notice with the bound and the unit", () => {
    assert.equal(
      operationsTruncationNotice(25, "rows"),
      "Showing the first 25 rows. More exist in this scope.",
    );
    assert.equal(
      operationsTruncationNotice(10, "clients"),
      "Showing the first 10 clients. More exist in this scope.",
    );
  });
});

import {
  deriveOperationsActions,
  operationsPriorityLabel,
  operationsPriorityTone,
  OPERATIONS_SECTION_ORDER,
} from "./operations-view";
import type {
  AnomaliesData,
  ConnectorHealthData,
  DeliveryData,
  FreshnessData,
  IngestionData,
  OperationsSummary,
  ReadinessData,
} from "./operations-summary";

function createStubSummary(overrides?: Partial<OperationsSummary["sections"]>): OperationsSummary {
  return {
    version: "operations-summary-v1",
    workspaceId: "ws-test",
    generatedAt: "2026-09-04T12:00:00.000Z",
    clientContext: { status: "none", client: null, scope: "workspace" },
    navigation: {
      sources: "/sources",
      reports: "/reports",
      clients: "/clients",
      explorer: "/explorer",
      exports: "/exports",
      operations: "/operations",
    },
    sections: {
      connectorHealth: {
        state: "ready",
        data: {
          quarantineThreshold: 3,
          totals: { total: 1, healthy: 1, degraded: 0, quarantined: 0, reconnectRequired: 0, unknown: 0 },
          attention: [],
        },
        truncated: false,
        limit: 25,
        reason: null,
        href: "/sources",
      },
      freshness: {
        state: "ready",
        data: {
          sourceFreshnessHours: 24,
          escalationHours: 26,
          totals: { fresh: 1, stale: 0, syncing: 0, pending: 0, error: 0, partial: 0, disconnected: 0, unknown: 0 },
          attention: [],
        },
        truncated: false,
        limit: 25,
        reason: null,
        href: "/sources",
      },
      ingestion: {
        state: "ready",
        data: {
          windowDays: 7,
          totals: { total: 1, queued: 0, running: 0, completed: 1, partial: 0, failed: 0 },
          recentFailures: [],
          syncLogErrors: [],
          syncLogErrorTotal: 0,
        },
        truncated: false,
        limit: 25,
        reason: null,
        href: "/reports",
      },
      readiness: {
        state: "ready",
        data: {
          window: { start: "2026-08-28", end: "2026-09-04" },
          evaluatedClients: 1,
          totals: { ready: 1, notReady: 0, warning: 0, unknown: 0 },
          clients: [],
        },
        truncated: false,
        limit: 10,
        reason: null,
        href: "/reports",
      },
      delivery: {
        state: "ready",
        data: {
          recencyHours: 168,
          totals: { receipts: 1, stale: 0, clients: 1 },
          latest: [],
        },
        truncated: false,
        limit: 25,
        reason: null,
        href: "/exports",
      },
      anomalies: {
        state: "ready",
        data: {
          windowDays: 14,
          totals: { total: 0, critical: 0, warning: 0 },
          items: [],
        },
        truncated: false,
        limit: 25,
        reason: null,
        href: "/clients",
      },
      ...overrides,
    },
  };
}

describe("Actionable Readiness v1 (deriveOperationsActions)", () => {
  it("maps priority to tone and label correctly", () => {
    assert.equal(operationsPriorityTone("high"), "danger");
    assert.equal(operationsPriorityTone("medium"), "warn");
    assert.equal(operationsPriorityTone("low"), "neutral");

    assert.equal(operationsPriorityLabel("high"), "High priority");
    assert.equal(operationsPriorityLabel("medium"), "Medium priority");
    assert.equal(operationsPriorityLabel("low"), "Low priority");
  });

  it("returns an empty array when input is null, undefined, or missing sections", () => {
    assert.deepEqual(deriveOperationsActions(null), []);
    assert.deepEqual(deriveOperationsActions(undefined), []);
    assert.deepEqual(deriveOperationsActions({} as unknown as OperationsSummary), []);
  });

  it("produces zero actions in the all-ready calm state", () => {
    const summary = createStubSummary();
    const actions = deriveOperationsActions(summary);
    assert.equal(actions.length, 0);
  });

  it("derives high priority action for connectorHealth in attention state", () => {
    const summary = createStubSummary({
      connectorHealth: {
        state: "attention",
        data: {
          quarantineThreshold: 3,
          totals: { total: 2, healthy: 1, degraded: 0, quarantined: 1, reconnectRequired: 0, unknown: 0 },
          attention: [
            {
              connectionId: "c1",
              provider: "google_ads",
              accountId: "acc-1",
              accountName: "Client A",
              status: "quarantined",
              errorCategory: "AUTH_EXPIRED",
              consecutiveFailures: 3,
              lastSuccessAt: "2026-09-04T10:00:00.000Z",
              lastErrorSummary: "token expired",
            },
          ],
        },
        truncated: false,
        limit: 25,
        reason: null,
        href: "/sources",
      },
    });

    const actions = deriveOperationsActions(summary);
    assert.equal(actions.length, 1);
    const action = actions[0];
    assert.equal(action.id, "action-connectorHealth");
    assert.equal(action.sectionKey, "connectorHealth");
    assert.equal(action.priority, "high");
    assert.equal(action.state, "attention");
    assert.match(action.title, /quarantined/i);
    assert.match(action.explanation, /quarantined/i);
    assert.equal(action.count, 1);
    assert.equal(action.latestEvidenceAt, "2026-09-04T10:00:00.000Z");
    assert.equal(action.cta.href, "/sources");
    assert.equal(action.truncated, false);
  });

  it("prioritizes reconnectRequired in connectorHealth attention copy", () => {
    const summary = createStubSummary({
      connectorHealth: {
        state: "attention",
        data: {
          quarantineThreshold: 3,
          totals: { total: 3, healthy: 1, degraded: 1, quarantined: 1, reconnectRequired: 1, unknown: 0 },
          attention: [
            {
              connectionId: "c1",
              provider: "google_ads",
              accountId: "acc-1",
              accountName: "Client A",
              status: "reconnect_required",
              errorCategory: "AUTH_REVOKED",
              consecutiveFailures: 1,
              lastSuccessAt: null,
              lastErrorSummary: "reauth needed",
            },
          ],
        },
        truncated: true,
        limit: 25,
        reason: null,
        href: "/sources",
      },
    });

    const actions = deriveOperationsActions(summary);
    assert.equal(actions.length, 1);
    const action = actions[0];
    assert.match(action.title, /Reconnect/i);
    assert.match(action.explanation, /re-authentication/i);
    assert.equal(action.truncated, true);
  });

  it("derives medium priority action for unavailable sections without leaking reasons", () => {
    const summary = createStubSummary({
      readiness: {
        state: "unavailable",
        data: null,
        truncated: false,
        limit: 0,
        reason: "operations_section_unavailable",
        href: "/reports",
      },
    });

    const actions = deriveOperationsActions(summary);
    assert.equal(actions.length, 1);
    const action = actions[0];
    assert.equal(action.priority, "medium");
    assert.equal(action.state, "unavailable");
    assert.match(action.title, /service/i);
    assert.equal(action.explanation.includes("operations_section_unavailable"), false);
    assert.match(action.explanation, /could not be read/i);
  });

  it("derives low priority action for unsupported sections (e.g. ingestion in client scope)", () => {
    const summary = createStubSummary({
      ingestion: {
        state: "unsupported",
        data: null,
        truncated: false,
        limit: 0,
        reason: "import_jobs_not_client_attributable",
        href: "/reports",
      },
    });

    const actions = deriveOperationsActions(summary);
    assert.equal(actions.length, 1);
    const action = actions[0];
    assert.equal(action.priority, "low");
    assert.equal(action.state, "unsupported");
    assert.match(action.title, /ingestion/i);
    assert.equal(action.explanation.includes("import_jobs_not_client_attributable"), false);
    assert.match(action.explanation, /All clients/i);
  });

  it("derives low priority setup action for empty sections", () => {
    const summary = createStubSummary({
      connectorHealth: {
        state: "empty",
        data: {
          quarantineThreshold: 3,
          totals: { total: 0, healthy: 0, degraded: 0, quarantined: 0, reconnectRequired: 0, unknown: 0 },
          attention: [],
        },
        truncated: false,
        limit: 25,
        reason: null,
        href: "/sources",
      },
    });

    const actions = deriveOperationsActions(summary);
    assert.equal(actions.length, 1);
    const action = actions[0];
    assert.equal(action.priority, "low");
    assert.equal(action.state, "empty");
    assert.match(action.title, /Connect/i);
  });

  it("sorts deterministically by priority rank then section order", () => {
    // We set up:
    // connectorHealth: empty (low, section order 1)
    // freshness: unavailable (medium, section order 2)
    // ingestion: unsupported (low, section order 3)
    // readiness: attention (high, section order 4)
    // delivery: attention (high, section order 5)
    // anomalies: unavailable (medium, section order 6)
    const summary = createStubSummary({
      connectorHealth: {
        state: "empty",
        data: {
          quarantineThreshold: 3,
          totals: { total: 0, healthy: 0, degraded: 0, quarantined: 0, reconnectRequired: 0, unknown: 0 },
          attention: [],
        },
        truncated: false,
        limit: 25,
        reason: null,
        href: "/sources",
      },
      freshness: {
        state: "unavailable",
        data: null,
        truncated: false,
        limit: 0,
        reason: "operations_section_unavailable",
        href: "/sources",
      },
      ingestion: {
        state: "unsupported",
        data: null,
        truncated: false,
        limit: 0,
        reason: "import_jobs_not_client_attributable",
        href: "/reports",
      },
      readiness: {
        state: "attention",
        data: {
          window: { start: "2026-08-28", end: "2026-09-04" },
          evaluatedClients: 2,
          totals: { ready: 1, notReady: 1, warning: 0, unknown: 0 },
          clients: [
            {
              clientId: "c-1",
              clientName: "Brand X",
              status: "NOT_READY",
              blockers: ["DATA_STALE"],
              warnings: [],
            },
          ],
        },
        truncated: false,
        limit: 10,
        reason: null,
        href: "/reports",
      },
      delivery: {
        state: "attention",
        data: {
          recencyHours: 168,
          totals: { receipts: 2, stale: 1, clients: 1 },
          latest: [
            {
              clientId: "c-1",
              destination: "google_sheets",
              windowStart: "2026-08-01",
              windowEnd: "2026-08-07",
              dataThroughDate: "2026-08-07",
              rowCount: 10,
              retrievedAt: "2026-08-08T00:00:00.000Z",
              stale: true,
            },
          ],
        },
        truncated: false,
        limit: 25,
        reason: null,
        href: "/exports",
      },
      anomalies: {
        state: "unavailable",
        data: null,
        truncated: false,
        limit: 0,
        reason: "operations_section_unavailable",
        href: "/clients",
      },
    });

    const actions = deriveOperationsActions(summary);

    // Expected order:
    // 1. High priority:
    //    - readiness (section order 4)
    //    - delivery (section order 5)
    // 2. Medium priority:
    //    - freshness (section order 2)
    //    - anomalies (section order 6)
    // 3. Low priority:
    //    - connectorHealth (section order 1)
    //    - ingestion (section order 3)
    assert.deepEqual(
      actions.map((a) => ({ key: a.sectionKey, priority: a.priority })),
      [
        { key: "readiness", priority: "high" },
        { key: "delivery", priority: "high" },
        { key: "freshness", priority: "medium" },
        { key: "anomalies", priority: "medium" },
        { key: "connectorHealth", priority: "low" },
        { key: "ingestion", priority: "low" },
      ],
    );
  });

  it("ensures exactly 1 primary action per section (no duplicates)", () => {
    const summary = createStubSummary({
      freshness: {
        state: "attention",
        data: {
          sourceFreshnessHours: 24,
          escalationHours: 26,
          totals: { fresh: 0, stale: 3, syncing: 0, pending: 0, error: 2, partial: 0, disconnected: 0, unknown: 0 },
          attention: [
            { connectionId: "c1", provider: "meta", name: "Meta", state: "stale", lastSyncAt: null, lastDataThrough: null },
            { connectionId: "c2", provider: "google_ads", name: "Google", state: "error", lastSyncAt: null, lastDataThrough: null },
          ],
        },
        truncated: false,
        limit: 25,
        reason: null,
        href: "/sources",
      },
    });

    const actions = deriveOperationsActions(summary);
    const freshnessActions = actions.filter((a) => a.sectionKey === "freshness");
    assert.equal(freshnessActions.length, 1);
  });

  it("does not mutate the input summary or sections (immutability)", () => {
    const summary = createStubSummary({
      anomalies: {
        state: "attention",
        data: {
          windowDays: 14,
          totals: { total: 2, critical: 1, warning: 1 },
          items: [
            {
              id: "anom-1",
              type: "budget_runaway",
              severity: "critical",
              platform: "google_ads",
              campaignName: "Test Campaign",
              accountName: "Account 1",
              clientId: "c-1",
            },
          ],
        },
        truncated: false,
        limit: 25,
        reason: null,
        href: "/clients",
      },
    });

    const snapshotBefore = JSON.stringify(summary);
    deriveOperationsActions(summary);
    assert.equal(JSON.stringify(summary), snapshotBefore);
  });

  it("is completely deterministic on identical inputs", () => {
    const summary = createStubSummary({
      delivery: {
        state: "attention",
        data: {
          recencyHours: 168,
          totals: { receipts: 1, stale: 1, clients: 1 },
          latest: [
            {
              clientId: "c-1",
              destination: "google_sheets",
              windowStart: "2026-08-01",
              windowEnd: "2026-08-07",
              dataThroughDate: "2026-08-07",
              rowCount: 10,
              retrievedAt: "2026-08-08T00:00:00.000Z",
              stale: true,
            },
          ],
        },
        truncated: false,
        limit: 25,
        reason: null,
        href: "/exports",
      },
    });

    const res1 = deriveOperationsActions(summary);
    const res2 = deriveOperationsActions(summary);
    assert.deepEqual(res1, res2);
  });

  it("exports OPERATIONS_SECTION_ORDER containing all 6 section keys", () => {
    assert.deepEqual(OPERATIONS_SECTION_ORDER, [
      "connectorHealth",
      "freshness",
      "ingestion",
      "readiness",
      "delivery",
      "anomalies",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* Actionable Readiness v1 — remediation regressions                          */
/* -------------------------------------------------------------------------- */

type FreshnessSection = OperationsSummary["sections"]["freshness"];
type IngestionSection = OperationsSummary["sections"]["ingestion"];
type ReadinessSection = OperationsSummary["sections"]["readiness"];
type DeliverySection = OperationsSummary["sections"]["delivery"];
type AnomaliesSection = OperationsSummary["sections"]["anomalies"];
type ConnectorHealthSection = OperationsSummary["sections"]["connectorHealth"];

function attentionSource(
  connectionId: string,
  state: FreshnessData["attention"][number]["state"],
  lastSyncAt: string | null = "2026-09-01T00:00:00.000Z",
): FreshnessData["attention"][number] {
  return {
    connectionId,
    provider: "google_ads",
    name: `Source ${connectionId}`,
    state,
    lastSyncAt,
    lastDataThrough: null,
  };
}

function freshnessSection(
  totals: Partial<FreshnessData["totals"]>,
  attention: FreshnessData["attention"] = [],
  truncated = false,
): FreshnessSection {
  const base: FreshnessData["totals"] = {
    fresh: 0,
    stale: 0,
    syncing: 0,
    pending: 0,
    error: 0,
    partial: 0,
    disconnected: 0,
    unknown: 0,
  };
  return {
    state: "attention",
    data: { sourceFreshnessHours: 24, escalationHours: 26, totals: { ...base, ...totals }, attention },
    truncated,
    limit: 25,
    reason: null,
    href: "/sources",
  };
}

function ingestionSection(options: {
  totals?: Partial<IngestionData["totals"]>;
  recentFailures?: IngestionData["recentFailures"];
  syncLogErrors?: IngestionData["syncLogErrors"];
  syncLogErrorTotal?: number;
  truncated?: boolean;
  state?: "attention" | "empty";
}): IngestionSection {
  const base: IngestionData["totals"] = {
    total: 0,
    queued: 0,
    running: 0,
    completed: 0,
    partial: 0,
    failed: 0,
  };
  return {
    state: options.state ?? "attention",
    data: {
      windowDays: 7,
      totals: { ...base, ...options.totals },
      recentFailures: options.recentFailures ?? [],
      syncLogErrors: options.syncLogErrors ?? [],
      syncLogErrorTotal: options.syncLogErrorTotal ?? 0,
    },
    truncated: options.truncated ?? false,
    limit: 25,
    reason: null,
    href: "/reports",
  };
}

function readinessSection(
  totals: Partial<ReadinessData["totals"]>,
  options: { evaluatedClients?: number; truncated?: boolean } = {},
): ReadinessSection {
  return {
    state: "attention",
    data: {
      window: { start: "2026-08-28", end: "2026-09-04" },
      evaluatedClients: options.evaluatedClients ?? 1,
      totals: { ready: 0, notReady: 0, warning: 0, unknown: 0, ...totals },
      clients: [],
    },
    truncated: options.truncated ?? false,
    limit: 10,
    reason: null,
    href: "/reports",
  };
}

function deliverySection(totals: Partial<DeliveryData["totals"]>, latest: DeliveryData["latest"] = []): DeliverySection {
  return {
    state: "attention",
    data: { recencyHours: 168, totals: { receipts: 0, stale: 0, clients: 0, ...totals }, latest },
    truncated: false,
    limit: 25,
    reason: null,
    href: "/exports",
  };
}

function anomaliesSection(
  totals: Partial<AnomaliesData["totals"]>,
  options: { truncated?: boolean; state?: "attention" | "ready" } = {},
): AnomaliesSection {
  return {
    state: options.state ?? "attention",
    data: {
      windowDays: 14,
      totals: { total: 0, critical: 0, warning: 0, ...totals },
      items: [],
    },
    truncated: options.truncated ?? false,
    limit: 25,
    reason: null,
    href: "/clients",
  };
}

function connectorHealthSection(
  totals: Partial<ConnectorHealthData["totals"]>,
  attention: ConnectorHealthData["attention"] = [],
  truncated = false,
): ConnectorHealthSection {
  return {
    state: "attention",
    data: {
      quarantineThreshold: 3,
      totals: { total: 0, healthy: 0, degraded: 0, quarantined: 0, reconnectRequired: 0, unknown: 0, ...totals },
      attention,
    },
    truncated,
    limit: 25,
    reason: null,
    href: "/sources",
  };
}

describe("Actionable Readiness v1 regressions (T1 freshness truthfulness)", () => {
  it("reports genuinely stale sources against the freshness window", () => {
    const actions = deriveOperationsActions(
      createStubSummary({ freshness: freshnessSection({ stale: 2 }, [attentionSource("c1", "stale")]) }),
    );
    assert.equal(actions.length, 1);
    const action = actions[0]!;
    assert.equal(action.sectionKey, "freshness");
    assert.equal(action.priority, "high");
    assert.equal(action.count, 2);
    assert.match(action.title, /stale/i);
    assert.match(action.explanation, /have not synced within the 24h freshness window/);
    assert.equal(/exceed/i.test(action.explanation), false);
  });

  it("describes a pending source as awaiting its first sync, never as stale", () => {
    const actions = deriveOperationsActions(
      createStubSummary({ freshness: freshnessSection({ pending: 1 }, [attentionSource("c1", "pending", null)]) }),
    );
    const action = actions[0]!;
    assert.equal(action.priority, "low");
    assert.equal(action.count, 1);
    assert.equal(/stale|exceed|freshness window/i.test(`${action.title} ${action.explanation}`), false);
    assert.match(action.title, /first sync/i);
    assert.match(action.explanation, /pending or syncing/);
  });

  it("treats syncing-only evidence as monitoring rather than an incident", () => {
    const actions = deriveOperationsActions(
      createStubSummary({ freshness: freshnessSection({ syncing: 3 }, [attentionSource("c1", "syncing")]) }),
    );
    const action = actions[0]!;
    assert.equal(action.priority, "low");
    assert.equal(action.count, 3);
    assert.equal(/stale/i.test(action.explanation), false);
  });

  it("keeps high priority for failing, partial and disconnected connections", () => {
    const actions = deriveOperationsActions(
      createStubSummary({
        freshness: freshnessSection({ error: 1, partial: 1, disconnected: 1 }, [
          attentionSource("c1", "error"),
          attentionSource("c2", "partial"),
          attentionSource("c3", "disconnected"),
        ]),
      }),
    );
    const action = actions[0]!;
    assert.equal(action.priority, "high");
    assert.equal(action.count, 3);
    assert.match(action.title, /failing/i);
    assert.match(action.explanation, /failing, partial, or disconnected/);
  });

  it("distinguishes stale from pending in a mixed population", () => {
    const actions = deriveOperationsActions(
      createStubSummary({
        freshness: freshnessSection({ stale: 2, pending: 5 }, [attentionSource("c1", "stale")]),
      }),
    );
    const action = actions[0]!;
    assert.equal(action.priority, "high");
    assert.equal(action.count, 2);
    assert.match(action.explanation, /2 source connection\(s\) have not synced/);
    assert.equal(/pending/i.test(action.explanation), false);
  });

  it("uses authoritative totals when the attention list is capped", () => {
    const attention = Array.from({ length: 25 }, (_, index) => attentionSource(`c${index}`, "stale"));
    const actions = deriveOperationsActions(
      createStubSummary({ freshness: freshnessSection({ stale: 40 }, attention, true) }),
    );
    const action = actions[0]!;
    assert.equal(action.count, 40);
    assert.match(action.explanation, /40 source connection\(s\)/);
    assert.equal(action.truncated, true);
  });

  it("falls back to explicitly bounded language when no category accounts for attention", () => {
    const actions = deriveOperationsActions(
      createStubSummary({ freshness: freshnessSection({}, [attentionSource("c1", "stale")]) }),
    );
    const action = actions[0]!;
    assert.equal(action.priority, "medium");
    assert.equal(action.count, undefined);
    assert.match(action.explanation, /Showing 1 source connection\(s\)/);
    assert.match(action.explanation, /More may exist/);
    assert.equal(action.truncated, true);
  });
});

describe("Actionable Readiness v1 regressions (T2 authoritative ingestion counts)", () => {
  it("counts failures from authoritative totals, not the capped evidence slice", () => {
    const recentFailures = Array.from({ length: 25 }, (_, index) => ({
      id: `j${index}`,
      status: "failed" as const,
      errorSummary: null,
      finishedAt: "2026-09-10T00:00:00.000Z",
      since: "2026-09-01",
      until: "2026-09-07",
    }));
    const actions = deriveOperationsActions(
      createStubSummary({
        ingestion: ingestionSection({
          totals: { total: 30, failed: 30 },
          recentFailures,
          syncLogErrorTotal: 0,
          truncated: true,
        }),
      }),
    );
    const action = actions[0]!;
    assert.equal(action.priority, "high");
    assert.equal(action.count, 30);
    assert.match(action.explanation, /30 failed import job\(s\)/);
    assert.equal(action.truncated, true);
  });

  it("does not claim zero failures when an older failure triggered attention", () => {
    const actions = deriveOperationsActions(
      createStubSummary({
        ingestion: ingestionSection({
          totals: { total: 27, failed: 1 },
          recentFailures: [],
          syncLogErrorTotal: 0,
          truncated: true,
        }),
      }),
    );
    const action = actions[0]!;
    assert.equal(action.priority, "high");
    assert.equal(action.count, 1);
    assert.match(action.explanation, /1 failed import job\(s\)/);
    assert.equal(/0 failed/.test(action.explanation), false);
  });

  it("reports import failures with zero sync-log errors", () => {
    const actions = deriveOperationsActions(
      createStubSummary({ ingestion: ingestionSection({ totals: { total: 3, failed: 2, partial: 1 }, syncLogErrorTotal: 0 }) }),
    );
    const action = actions[0]!;
    assert.equal(action.count, 3);
    assert.match(action.explanation, /2 failed import job\(s\), 1 partial import job\(s\)/);
    assert.equal(/sync-log/.test(action.explanation), false);
  });

  it("reports sync-log errors with zero failed imports", () => {
    const actions = deriveOperationsActions(
      createStubSummary({ ingestion: ingestionSection({ totals: { total: 4, completed: 4 }, syncLogErrorTotal: 5 }) }),
    );
    const action = actions[0]!;
    assert.equal(action.count, 5);
    assert.match(action.explanation, /5 sync-log error\(s\)/);
    assert.equal(/failed import/.test(action.explanation), false);
  });

  it("combines import and sync-log failures into an exact authoritative total", () => {
    const actions = deriveOperationsActions(
      createStubSummary({ ingestion: ingestionSection({ totals: { total: 9, failed: 2, partial: 3 }, syncLogErrorTotal: 4 }) }),
    );
    const action = actions[0]!;
    assert.equal(action.count, 9);
    assert.match(action.explanation, /2 failed import job\(s\), 3 partial import job\(s\), 4 sync-log error\(s\)/);
  });

  it("never asserts a zero failure count for an attention state", () => {
    const actions = deriveOperationsActions(
      createStubSummary({ ingestion: ingestionSection({ totals: { total: 1, completed: 1 }, syncLogErrorTotal: 0 }) }),
    );
    const action = actions[0]!;
    assert.equal(action.priority, "high");
    assert.equal(action.count, undefined);
    assert.equal(/0 failed|0 partial|0 sync-log/.test(action.explanation), false);
    assert.match(action.explanation, /requires review/);
  });
});

describe("Actionable Readiness v1 regressions (T3/T4 scope-aware CTA navigation)", () => {
  it("routes the client-scoped ingestion action to All Clients on the Operations surface", () => {
    const actions = deriveOperationsActions(
      createStubSummary({
        ingestion: {
          state: "unsupported",
          data: null,
          truncated: false,
          limit: 0,
          reason: "import_jobs_not_client_attributable",
          href: "/reports",
        },
      }),
    );
    const action = actions[0]!;
    assert.equal(action.state, "unsupported");
    assert.equal(action.priority, "low");
    assert.equal(action.cta.href, "/operations");
    assert.equal(action.cta.targetScope, "all");
    assert.match(action.cta.label, /All clients/i);
    assert.equal(action.explanation.includes("import_jobs_not_client_attributable"), false);
  });

  it("routes the empty ingestion action to the data explorer importer", () => {
    const actions = deriveOperationsActions(
      createStubSummary({ ingestion: ingestionSection({ state: "empty", totals: { total: 0 }, syncLogErrorTotal: 0 }) }),
    );
    const action = actions[0]!;
    assert.equal(action.state, "empty");
    assert.equal(action.cta.href, "/explorer");
    assert.equal(action.cta.targetScope, undefined);
    assert.equal(action.cta.label, "Open data explorer");
    assert.equal(/trigger/i.test(action.title), false);
  });
});

describe("Actionable Readiness v1 regressions (T5 readiness truthfulness)", () => {
  it("reports confirmed blockers at high priority", () => {
    const actions = deriveOperationsActions(createStubSummary({ readiness: readinessSection({ notReady: 2 }) }));
    const action = actions[0]!;
    assert.equal(action.priority, "high");
    assert.equal(action.count, 2);
    assert.match(action.explanation, /2 client\(s\) cannot produce verified reports/);
  });

  it("reports warning-only readiness at high priority", () => {
    const actions = deriveOperationsActions(createStubSummary({ readiness: readinessSection({ warning: 3 }) }));
    const action = actions[0]!;
    assert.equal(action.priority, "high");
    assert.equal(action.count, 3);
    assert.match(action.explanation, /3 client\(s\) have report readiness warnings/);
  });

  it("never labels unknown-only readiness as a confirmed warning or a zero", () => {
    const actions = deriveOperationsActions(createStubSummary({ readiness: readinessSection({ unknown: 4 }) }));
    const action = actions[0]!;
    assert.equal(action.priority, "medium");
    assert.equal(action.count, 4);
    assert.match(action.explanation, /4 client\(s\) could not be evaluated/);
    assert.equal(/0 client/.test(action.explanation), false);
    assert.equal(/warnings/.test(action.explanation), false);
  });

  it("distinguishes known blockers from unknown clients in a mixed population", () => {
    const actions = deriveOperationsActions(
      createStubSummary({ readiness: readinessSection({ notReady: 1, warning: 2, unknown: 3 }) }),
    );
    const action = actions[0]!;
    assert.equal(action.priority, "high");
    assert.equal(action.count, 6);
    assert.match(action.explanation, /1 client\(s\) cannot produce verified reports/);
    assert.match(action.explanation, /2 client\(s\) have report readiness warnings/);
    assert.match(action.explanation, /3 client\(s\) could not be evaluated/);
  });

  it("treats a non-exhaustive all-ready evaluation as incomplete coverage, not zero warnings", () => {
    const actions = deriveOperationsActions(
      createStubSummary({ readiness: readinessSection({ ready: 50 }, { evaluatedClients: 50, truncated: true }) }),
    );
    const action = actions[0]!;
    assert.equal(action.priority, "medium");
    assert.equal(action.count, undefined);
    assert.match(action.title, /incomplete/i);
    assert.match(action.explanation, /could not be evaluated for every client/);
    assert.equal(/0 client/.test(action.explanation), false);
  });
});

describe("Actionable Readiness v1 regressions (T6 anomaly scan truthfulness)", () => {
  it("reports confirmed critical anomalies at high priority", () => {
    const actions = deriveOperationsActions(createStubSummary({ anomalies: anomaliesSection({ total: 2, critical: 2 }) }));
    const action = actions[0]!;
    assert.equal(action.priority, "high");
    assert.equal(action.count, 2);
    assert.match(action.explanation, /2 critical marketing anomaly/);
  });

  it("reports warning-severity anomalies", () => {
    const actions = deriveOperationsActions(createStubSummary({ anomalies: anomaliesSection({ total: 3, warning: 3 }) }));
    const action = actions[0]!;
    assert.equal(action.priority, "high");
    assert.match(action.explanation, /3 marketing anomaly\/anomalies at warning severity/);
  });

  it("reports mixed severities", () => {
    const actions = deriveOperationsActions(
      createStubSummary({ anomalies: anomaliesSection({ total: 4, critical: 1, warning: 3 }) }),
    );
    const action = actions[0]!;
    assert.equal(action.count, 4);
    assert.match(action.explanation, /1 critical marketing anomaly/);
    assert.match(action.explanation, /3 marketing anomaly\/anomalies at warning severity/);
  });

  it("describes a truncated scan with no detected anomaly as incomplete, never as zero", () => {
    const actions = deriveOperationsActions(
      createStubSummary({ anomalies: anomaliesSection({ total: 0 }, { truncated: true }) }),
    );
    const action = actions[0]!;
    assert.equal(action.priority, "medium");
    assert.equal(action.count, undefined);
    assert.match(action.title, /incomplete/i);
    assert.equal(/0 marketing anomaly/.test(action.explanation), false);
    assert.match(action.explanation, /could not cover every campaign metric row/);
  });

  it("keeps confirmed anomalies actionable even when the scan was truncated", () => {
    const actions = deriveOperationsActions(
      createStubSummary({ anomalies: anomaliesSection({ total: 5, critical: 1, warning: 4 }, { truncated: true }) }),
    );
    const action = actions[0]!;
    assert.equal(action.priority, "high");
    assert.equal(action.count, 5);
    assert.equal(action.truncated, true);
  });

  it("produces no action when the anomalies section is authoritative and clean", () => {
    const actions = deriveOperationsActions(
      createStubSummary({ anomalies: anomaliesSection({ total: 0 }, { state: "ready" }) }),
    );
    assert.deepEqual(actions, []);
  });
});

describe("Actionable Readiness v1 regressions (A1/A2 authoritative counts and invariants)", () => {
  it("uses the authoritative connector total when the attention list is capped", () => {
    const attention = Array.from({ length: 25 }, (_, index) => ({
      connectionId: `c${index}`,
      provider: "google_ads",
      accountId: `a${index}`,
      accountName: null,
      status: "unknown" as const,
      errorCategory: null,
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastErrorSummary: null,
    }));
    const actions = deriveOperationsActions(
      createStubSummary({ connectorHealth: connectorHealthSection({ total: 60, healthy: 5, unknown: 55 }, attention, true) }),
    );
    const action = actions[0]!;
    assert.equal(action.count, 55);
    assert.match(action.explanation, /55 provider account\(s\) report an unrecognized health state/);
    assert.equal(/25 provider account/.test(action.explanation), false);
  });

  it("never exposes internal reason codes or evidence identifiers in action copy", () => {
    const actions = deriveOperationsActions(
      createStubSummary({
        ingestion: {
          state: "unsupported",
          data: null,
          truncated: false,
          limit: 0,
          reason: "import_jobs_not_client_attributable",
          href: "/reports",
        },
        anomalies: anomaliesSection({ total: 1, critical: 1 }),
        freshness: freshnessSection({ stale: 1 }, [
          {
            connectionId: "conn-secret-999",
            provider: "google_ads",
            name: "Secret Source",
            state: "stale",
            lastSyncAt: "2026-09-01T00:00:00.000Z",
            lastDataThrough: null,
          },
        ]),
      }),
    );
    for (const action of actions) {
      assert.equal(/import_jobs_not_client_attributable|operations_section_unavailable/.test(action.explanation), false);
      assert.equal(/conn-secret-999/.test(action.explanation), false);
      assert.equal(/conn-secret-999/.test(action.title), false);
    }
  });

  it("emits at most one action per section and at most six in total", () => {
    const actions = deriveOperationsActions(
      createStubSummary({
        connectorHealth: connectorHealthSection({ total: 2, healthy: 1, quarantined: 1 }),
        freshness: freshnessSection({ stale: 1 }),
        ingestion: ingestionSection({ totals: { total: 2, failed: 1 }, syncLogErrorTotal: 1 }),
        readiness: readinessSection({ notReady: 1 }),
        delivery: deliverySection({ receipts: 1, stale: 1 }),
        anomalies: anomaliesSection({ total: 1, warning: 1 }),
      }),
    );
    assert.equal(actions.length, 6);
    assert.equal(new Set(actions.map((action) => action.sectionKey)).size, 6);
    assert.equal(new Set(actions.map((action) => action.id)).size, 6);
  });

  it("does not mutate the summary while correcting counts", () => {
    const summary = createStubSummary({
      freshness: freshnessSection({ stale: 40 }, [attentionSource("c1", "stale")], true),
    });
    const before = JSON.stringify(summary);
    deriveOperationsActions(summary);
    assert.equal(JSON.stringify(summary), before);
  });
});
