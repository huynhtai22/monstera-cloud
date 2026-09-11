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
import type { OperationsSummary } from "./operations-summary";

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
