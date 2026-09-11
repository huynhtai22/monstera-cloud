/**
 * Pure presentation helpers for the Operations Hub page (`/operations`).
 *
 * Deliberately free of React, Prisma and every server-only import so the page's
 * client component can use them and they stay trivially unit-testable. Nothing
 * here is derived from customer evidence; it only labels and formats.
 */

export type OperationsSectionStateView =
  | "ready"
  | "attention"
  | "empty"
  | "unsupported"
  | "unavailable";

export type OperationsTone = "ok" | "warn" | "danger" | "info" | "neutral";

/** Map a section state onto a presentation tone. */
export function operationsStateTone(state: OperationsSectionStateView): OperationsTone {
  switch (state) {
    case "ready":
      return "ok";
    case "attention":
      return "warn";
    case "unavailable":
      return "danger";
    case "unsupported":
      return "info";
    case "empty":
    default:
      return "neutral";
  }
}

/** Human label for a section state. */
export function operationsStateLabel(state: OperationsSectionStateView): string {
  switch (state) {
    case "ready":
      return "Ready";
    case "attention":
      return "Needs attention";
    case "unavailable":
      return "Unavailable";
    case "unsupported":
      return "Not applicable";
    case "empty":
    default:
      return "No data";
  }
}

const REASON_COPY: Record<string, string> = {
  import_jobs_not_client_attributable:
    "Import jobs are workspace-scoped — they carry no client reference — so ingestion health is not attributable to a single client. Switch to All clients to see it.",
  operations_section_unavailable:
    "This section could not be read. The rest of the summary is unaffected — retry in a moment.",
};

/**
 * Explain, in user terms, why a section carries no evidence. Never leaks the
 * internal reason code into the UI.
 */
export function describeOperationsReason(reason: string | null | undefined): string {
  if (!reason) return REASON_COPY.operations_section_unavailable;
  return REASON_COPY[reason] ?? "This section carries no evidence for the current scope.";
}

/** Deterministic UTC timestamp for evidence rows. Invalid input is returned verbatim. */
export function formatEvidenceTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/** Deterministic UTC calendar day for evidence rows. */
export function formatEvidenceDay(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}

/** Copy for a list that was capped for display while the state stayed authoritative. */
export function operationsTruncationNotice(limit: number, unit: string): string {
  return "Showing the first " + limit + " " + unit + ". More exist in this scope.";
}

/* -------------------------------------------------------------------------- */
/* Actionable Readiness v1 (Slice 1)                                          */
/* -------------------------------------------------------------------------- */

import type { OperationsSummary } from "./operations-summary";

export type OperationsActionPriority = "high" | "medium" | "low";

export type OperationsSectionKey =
  | "connectorHealth"
  | "freshness"
  | "ingestion"
  | "readiness"
  | "delivery"
  | "anomalies";

export type OperationsAction = {
  id: string;
  sectionKey: OperationsSectionKey;
  priority: OperationsActionPriority;
  title: string;
  explanation: string;
  state: OperationsSectionStateView;
  cta: { label: string; href: string };
  count?: number;
  latestEvidenceAt?: string;
  truncated?: boolean;
};

export const OPERATIONS_SECTION_ORDER: readonly OperationsSectionKey[] = [
  "connectorHealth",
  "freshness",
  "ingestion",
  "readiness",
  "delivery",
  "anomalies",
] as const;

const PRIORITY_ORDER: Record<OperationsActionPriority, number> = {
  high: 1,
  medium: 2,
  low: 3,
};

const SECTION_ORDER: Record<OperationsSectionKey, number> = {
  connectorHealth: 1,
  freshness: 2,
  ingestion: 3,
  readiness: 4,
  delivery: 5,
  anomalies: 6,
};

export function operationsPriorityTone(priority: OperationsActionPriority): OperationsTone {
  switch (priority) {
    case "high":
      return "danger";
    case "medium":
      return "warn";
    case "low":
    default:
      return "neutral";
  }
}

export function operationsPriorityLabel(priority: OperationsActionPriority): string {
  switch (priority) {
    case "high":
      return "High priority";
    case "medium":
      return "Medium priority";
    case "low":
    default:
      return "Low priority";
  }
}

function getLatestTimestamp(timestamps: (string | null | undefined)[]): string | undefined {
  let maxTime = -Infinity;
  let latest: string | undefined = undefined;
  for (const ts of timestamps) {
    if (!ts) continue;
    const time = new Date(ts).getTime();
    if (!Number.isNaN(time) && time > maxTime) {
      maxTime = time;
      latest = ts;
    }
  }
  return latest;
}

function deriveConnectorHealthAction(summary: OperationsSummary): OperationsAction | null {
  const section = summary.sections.connectorHealth;
  const href = section.href || summary.navigation.sources;

  if (section.state === "ready") return null;

  if (section.state === "attention") {
    if (section.data) {
      const { totals, attention } = section.data;
      const count = totals.reconnectRequired + totals.quarantined + totals.degraded + totals.unknown;
      const latestEvidenceAt = getLatestTimestamp(attention.map((a) => a.lastSuccessAt));

      let title = "Resolve connector health issues";
      let explanation = `${attention.length > 0 ? attention.length : totals.total} provider account(s) need attention.`;

      if (totals.reconnectRequired > 0) {
        title = "Reconnect provider accounts";
        explanation = `${totals.reconnectRequired} provider account(s) require re-authentication.`;
      } else if (totals.quarantined > 0) {
        title = "Resolve quarantined accounts";
        explanation = `${totals.quarantined} provider account(s) are quarantined after consecutive sync failures.`;
      } else if (totals.degraded > 0) {
        title = "Address degraded connectors";
        explanation = `${totals.degraded} provider account(s) are experiencing sync degradation.`;
      }

      return {
        id: "action-connectorHealth",
        sectionKey: "connectorHealth",
        priority: "high",
        title,
        explanation,
        state: "attention",
        cta: { label: "Open sources", href },
        count: count > 0 ? count : undefined,
        latestEvidenceAt,
        truncated: section.truncated,
      };
    }

    return {
      id: "action-connectorHealth",
      sectionKey: "connectorHealth",
      priority: "high",
      title: "Resolve connector health issues",
      explanation: "One or more provider accounts require attention.",
      state: "attention",
      cta: { label: "Open sources", href },
    };
  }

  if (section.state === "unavailable") {
    return {
      id: "action-connectorHealth",
      sectionKey: "connectorHealth",
      priority: "medium",
      title: "Verify connector health service",
      explanation: describeOperationsReason(section.reason),
      state: "unavailable",
      cta: { label: "Open sources", href },
    };
  }

  if (section.state === "unsupported") {
    return {
      id: "action-connectorHealth",
      sectionKey: "connectorHealth",
      priority: "low",
      title: "Connector health not supported",
      explanation: describeOperationsReason(section.reason),
      state: "unsupported",
      cta: { label: "Open sources", href },
    };
  }

  // section.state === "empty"
  return {
    id: "action-connectorHealth",
    sectionKey: "connectorHealth",
    priority: "low",
    title: "Connect provider accounts",
    explanation: "No provider accounts are configured for this scope. Connect a source to begin monitoring.",
    state: "empty",
    cta: { label: "Open sources", href },
  };
}

function deriveFreshnessAction(summary: OperationsSummary): OperationsAction | null {
  const section = summary.sections.freshness;
  const href = section.href || summary.navigation.sources;

  if (section.state === "ready") return null;

  if (section.state === "attention") {
    if (section.data) {
      const { attention, sourceFreshnessHours } = section.data;
      const count = attention.length;
      const latestEvidenceAt = getLatestTimestamp(attention.map((s) => s.lastSyncAt));

      return {
        id: "action-freshness",
        sectionKey: "freshness",
        priority: "high",
        title: "Investigate stale source connections",
        explanation: `${count} source connection(s) exceed the ${sourceFreshnessHours}h freshness window.`,
        state: "attention",
        cta: { label: "Open sources", href },
        count: count > 0 ? count : undefined,
        latestEvidenceAt,
        truncated: section.truncated,
      };
    }

    return {
      id: "action-freshness",
      sectionKey: "freshness",
      priority: "high",
      title: "Investigate stale source connections",
      explanation: "One or more source connections are stale or failing.",
      state: "attention",
      cta: { label: "Open sources", href },
    };
  }

  if (section.state === "unavailable") {
    return {
      id: "action-freshness",
      sectionKey: "freshness",
      priority: "medium",
      title: "Verify source freshness service",
      explanation: describeOperationsReason(section.reason),
      state: "unavailable",
      cta: { label: "Open sources", href },
    };
  }

  if (section.state === "unsupported") {
    return {
      id: "action-freshness",
      sectionKey: "freshness",
      priority: "low",
      title: "Source freshness not supported",
      explanation: describeOperationsReason(section.reason),
      state: "unsupported",
      cta: { label: "Open sources", href },
    };
  }

  // section.state === "empty"
  return {
    id: "action-freshness",
    sectionKey: "freshness",
    priority: "low",
    title: "Add source connections",
    explanation: "No source connections are configured in this scope.",
    state: "empty",
    cta: { label: "Open sources", href },
  };
}

function deriveIngestionAction(summary: OperationsSummary): OperationsAction | null {
  const section = summary.sections.ingestion;
  const href = section.href || summary.navigation.reports;

  if (section.state === "ready") return null;

  if (section.state === "attention") {
    if (section.data) {
      const { recentFailures, syncLogErrors, windowDays } = section.data;
      const count = recentFailures.length + syncLogErrors.length;
      const latestEvidenceAt = getLatestTimestamp([
        ...recentFailures.map((f) => f.finishedAt),
        ...syncLogErrors.map((s) => s.createdAt),
      ]);

      return {
        id: "action-ingestion",
        sectionKey: "ingestion",
        priority: "high",
        title: "Resolve warehouse ingestion failures",
        explanation: `${recentFailures.length} failed or partial import job(s) and ${syncLogErrors.length} sync-log error(s) in the last ${windowDays} days.`,
        state: "attention",
        cta: { label: "Open reports", href },
        count: count > 0 ? count : undefined,
        latestEvidenceAt,
        truncated: section.truncated,
      };
    }

    return {
      id: "action-ingestion",
      sectionKey: "ingestion",
      priority: "high",
      title: "Resolve warehouse ingestion failures",
      explanation: "Ingestion failures detected in the warehouse pipeline.",
      state: "attention",
      cta: { label: "Open reports", href },
    };
  }

  if (section.state === "unavailable") {
    return {
      id: "action-ingestion",
      sectionKey: "ingestion",
      priority: "medium",
      title: "Verify warehouse ingestion service",
      explanation: describeOperationsReason(section.reason),
      state: "unavailable",
      cta: { label: "Open reports", href },
    };
  }

  if (section.state === "unsupported") {
    return {
      id: "action-ingestion",
      sectionKey: "ingestion",
      priority: "low",
      title: "Switch scope to inspect ingestion",
      explanation: describeOperationsReason(section.reason),
      state: "unsupported",
      cta: { label: "Open reports", href },
    };
  }

  // section.state === "empty"
  return {
    id: "action-ingestion",
    sectionKey: "ingestion",
    priority: "low",
    title: "Trigger initial data ingestion",
    explanation: "No import jobs or sync logs exist in the current window.",
    state: "empty",
    cta: { label: "Open reports", href },
  };
}

function deriveReadinessAction(summary: OperationsSummary): OperationsAction | null {
  const section = summary.sections.readiness;
  const href = section.href || summary.navigation.reports;

  if (section.state === "ready") return null;

  if (section.state === "attention") {
    if (section.data) {
      const { totals } = section.data;
      const count = totals.notReady + totals.warning;

      const explanation =
        totals.notReady > 0
          ? `${totals.notReady} client(s) cannot produce verified reports due to active blockers.`
          : `${totals.warning} client(s) have report readiness warnings.`;

      return {
        id: "action-readiness",
        sectionKey: "readiness",
        priority: "high",
        title: "Resolve report readiness blockers",
        explanation,
        state: "attention",
        cta: { label: "Open reports", href },
        count: count > 0 ? count : undefined,
        truncated: section.truncated,
      };
    }

    return {
      id: "action-readiness",
      sectionKey: "readiness",
      priority: "high",
      title: "Resolve report readiness blockers",
      explanation: "One or more clients have report readiness issues.",
      state: "attention",
      cta: { label: "Open reports", href },
    };
  }

  if (section.state === "unavailable") {
    return {
      id: "action-readiness",
      sectionKey: "readiness",
      priority: "medium",
      title: "Verify report readiness service",
      explanation: describeOperationsReason(section.reason),
      state: "unavailable",
      cta: { label: "Open reports", href },
    };
  }

  if (section.state === "unsupported") {
    return {
      id: "action-readiness",
      sectionKey: "readiness",
      priority: "low",
      title: "Report readiness not supported",
      explanation: describeOperationsReason(section.reason),
      state: "unsupported",
      cta: { label: "Open reports", href },
    };
  }

  // section.state === "empty"
  return {
    id: "action-readiness",
    sectionKey: "readiness",
    priority: "low",
    title: "Configure client reporting",
    explanation: "No clients are in scope to evaluate for report readiness.",
    state: "empty",
    cta: { label: "Open reports", href },
  };
}

function deriveDeliveryAction(summary: OperationsSummary): OperationsAction | null {
  const section = summary.sections.delivery;
  const href = section.href || summary.navigation.exports;

  if (section.state === "ready") return null;

  if (section.state === "attention") {
    if (section.data) {
      const { totals, latest, recencyHours } = section.data;
      const count = totals.stale;
      const staleEntries = latest.filter((e) => e.stale);
      const latestEvidenceAt = getLatestTimestamp(staleEntries.map((e) => e.retrievedAt));

      return {
        id: "action-delivery",
        sectionKey: "delivery",
        priority: "high",
        title: "Inspect stale destination deliveries",
        explanation: `${totals.stale} destination delivery receipt(s) exceed the ${recencyHours}h recency threshold.`,
        state: "attention",
        cta: { label: "Open exports", href },
        count: count > 0 ? count : undefined,
        latestEvidenceAt,
        truncated: section.truncated,
      };
    }

    return {
      id: "action-delivery",
      sectionKey: "delivery",
      priority: "high",
      title: "Inspect stale destination deliveries",
      explanation: "One or more destination deliveries are stale.",
      state: "attention",
      cta: { label: "Open exports", href },
    };
  }

  if (section.state === "unavailable") {
    return {
      id: "action-delivery",
      sectionKey: "delivery",
      priority: "medium",
      title: "Verify destination delivery service",
      explanation: describeOperationsReason(section.reason),
      state: "unavailable",
      cta: { label: "Open exports", href },
    };
  }

  if (section.state === "unsupported") {
    return {
      id: "action-delivery",
      sectionKey: "delivery",
      priority: "low",
      title: "Destination delivery not supported",
      explanation: describeOperationsReason(section.reason),
      state: "unsupported",
      cta: { label: "Open exports", href },
    };
  }

  // section.state === "empty"
  return {
    id: "action-delivery",
    sectionKey: "delivery",
    priority: "low",
    title: "Configure export destinations",
    explanation: "No destination delivery receipts recorded in this scope.",
    state: "empty",
    cta: { label: "Open exports", href },
  };
}

function deriveAnomaliesAction(summary: OperationsSummary): OperationsAction | null {
  const section = summary.sections.anomalies;
  const href = section.href || summary.navigation.clients;

  if (section.state === "ready") return null;

  if (section.state === "attention") {
    if (section.data) {
      const { totals, windowDays } = section.data;
      const count = totals.total;

      const explanation =
        totals.critical > 0
          ? `${totals.critical} critical marketing anomaly/anomalies detected in the last ${windowDays} days.`
          : `${totals.warning} marketing anomaly/anomalies detected in the last ${windowDays} days.`;

      return {
        id: "action-anomalies",
        sectionKey: "anomalies",
        priority: "high",
        title: "Review marketing anomalies",
        explanation,
        state: "attention",
        cta: { label: "Open clients", href },
        count: count > 0 ? count : undefined,
        truncated: section.truncated,
      };
    }

    return {
      id: "action-anomalies",
      sectionKey: "anomalies",
      priority: "high",
      title: "Review marketing anomalies",
      explanation: "Marketing anomalies detected in campaign metrics.",
      state: "attention",
      cta: { label: "Open clients", href },
    };
  }

  if (section.state === "unavailable") {
    return {
      id: "action-anomalies",
      sectionKey: "anomalies",
      priority: "medium",
      title: "Verify anomaly detection service",
      explanation: describeOperationsReason(section.reason),
      state: "unavailable",
      cta: { label: "Open clients", href },
    };
  }

  if (section.state === "unsupported") {
    return {
      id: "action-anomalies",
      sectionKey: "anomalies",
      priority: "low",
      title: "Anomaly detection not supported",
      explanation: describeOperationsReason(section.reason),
      state: "unsupported",
      cta: { label: "Open clients", href },
    };
  }

  // section.state === "empty"
  return {
    id: "action-anomalies",
    sectionKey: "anomalies",
    priority: "low",
    title: "Collect campaign metrics",
    explanation: "No campaign metrics available in the last 14 days to evaluate anomalies.",
    state: "empty",
    cta: { label: "Open clients", href },
  };
}

/**
 * Derives a small, deterministic, prioritized list of next actions from the
 * operational summary evidence.
 *
 * Ordering:
 * 1. Priority rank: high (1) > medium (2) > low (3)
 * 2. Section order: connectorHealth > freshness > ingestion > readiness > delivery > anomalies
 * 3. Action ID: deterministic localeCompare tiebreaker
 */
export function deriveOperationsActions(summary?: OperationsSummary | null): OperationsAction[] {
  if (!summary || !summary.sections) return [];

  const rawActions: OperationsAction[] = [];

  const actionMakers: Record<OperationsSectionKey, () => OperationsAction | null> = {
    connectorHealth: () => deriveConnectorHealthAction(summary),
    freshness: () => deriveFreshnessAction(summary),
    ingestion: () => deriveIngestionAction(summary),
    readiness: () => deriveReadinessAction(summary),
    delivery: () => deriveDeliveryAction(summary),
    anomalies: () => deriveAnomaliesAction(summary),
  };

  for (const sectionKey of OPERATIONS_SECTION_ORDER) {
    const action = actionMakers[sectionKey]();
    if (action) {
      rawActions.push(action);
    }
  }

  return rawActions.slice().sort((a, b) => {
    const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (pDiff !== 0) return pDiff;

    const sDiff = SECTION_ORDER[a.sectionKey] - SECTION_ORDER[b.sectionKey];
    if (sDiff !== 0) return sDiff;

    return a.id.localeCompare(b.id);
  });
}
