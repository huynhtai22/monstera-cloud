/**
 * Pure presentation helpers for the Operations Hub page (`/operations`).
 *
 * Deliberately free of React, Prisma and every server-only import so the page's
 * client component can use them and they stay trivially unit-testable. Nothing
 * here is derived from customer evidence; it only labels and formats.
 */

// Type-only import: erased at compile time, so this module stays client-safe
// even though the operations summary loader itself is server-only.
import type { OperationsSummary } from "./operations-summary";

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

export type OperationsActionPriority = "high" | "medium" | "low";

export type OperationsSectionKey =
  | "connectorHealth"
  | "freshness"
  | "ingestion"
  | "readiness"
  | "delivery"
  | "anomalies";

export type OperationsActionTargetScope = "preserve" | "all";

export type OperationsAction = {
  id: string;
  sectionKey: OperationsSectionKey;
  priority: OperationsActionPriority;
  title: string;
  explanation: string;
  state: OperationsSectionStateView;
  /**
   * CTA intent, never encoded as ad-hoc URL semantics:
   * - `preserve` (default) keeps the operator's current client scope.
   * - `all` switches to the canonical All Clients scope so workspace-level
   *   evidence becomes visible on the destination surface.
   */
  cta: { label: string; href: string; targetScope?: OperationsActionTargetScope };
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
      // Authoritative: `totals` covers the WHOLE scoped population, so this
      // generic branch never reports the capped display slice as a total.
      let explanation = `${Math.max(0, totals.total - totals.healthy)} provider account(s) need attention.`;
      if (totals.unknown > 0) {
        explanation = `${totals.unknown} provider account(s) report an unrecognized health state that needs review.`;
      }

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
      const { attention, totals, sourceFreshnessHours } = section.data;
      const latestEvidenceAt = getLatestTimestamp(attention.map((s) => s.lastSyncAt));

      // Authoritative classification over the WHOLE scoped population. Only
      // `stale` proves the freshness window was exceeded; `pending` and
      // `syncing` are in flight, and `error`/`partial`/`disconnected`/`unknown`
      // are different conditions that must never be described as stale.
      const staleCount = totals.stale;
      const failingCount = totals.error + totals.partial + totals.disconnected;
      const inProgressCount = totals.pending + totals.syncing;
      const unknownCount = totals.unknown;

      if (staleCount + failingCount > 0) {
        const parts: string[] = [];
        if (staleCount > 0) {
          parts.push(`${staleCount} source connection(s) have not synced within the ${sourceFreshnessHours}h freshness window`);
        }
        if (failingCount > 0) {
          parts.push(`${failingCount} source connection(s) are failing, partial, or disconnected`);
        }
        return {
          id: "action-freshness",
          sectionKey: "freshness",
          priority: "high",
          title: failingCount > 0 ? "Investigate failing source connections" : "Investigate stale source connections",
          explanation: `${parts.join(", and ")}.`,
          state: "attention",
          cta: { label: "Open sources", href },
          count: staleCount + failingCount,
          latestEvidenceAt,
          truncated: section.truncated,
        };
      }

      if (unknownCount > 0) {
        return {
          id: "action-freshness",
          sectionKey: "freshness",
          priority: "medium",
          title: "Review unrecognized source connection states",
          explanation: `${unknownCount} source connection(s) report a state that could not be classified. Review them on the Sources page.`,
          state: "attention",
          cta: { label: "Open sources", href },
          count: unknownCount,
          latestEvidenceAt,
          truncated: section.truncated,
        };
      }

      if (inProgressCount > 0) {
        return {
          id: "action-freshness",
          sectionKey: "freshness",
          priority: "low",
          title: "Source connections are still completing their first sync",
          explanation: `${inProgressCount} source connection(s) are pending or syncing and have not completed a sync yet. No action is required unless they remain in this state.`,
          state: "attention",
          cta: { label: "Open sources", href },
          count: inProgressCount,
          latestEvidenceAt,
          truncated: section.truncated,
        };
      }

      // Contract fallback: the section is in `attention` but no authoritative
      // category accounts for it. Stay explicitly bounded rather than asserting
      // a total derived from the capped display slice.
      return {
        id: "action-freshness",
        sectionKey: "freshness",
        priority: "medium",
        title: "Review source connection freshness",
        explanation: `Showing ${attention.length} source connection(s) that need attention. More may exist in this scope.`,
        state: "attention",
        cta: { label: "Open sources", href },
        latestEvidenceAt,
        truncated: true,
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
      const { recentFailures, syncLogErrors, totals, syncLogErrorTotal, windowDays } = section.data;
      const latestEvidenceAt = getLatestTimestamp([
        ...recentFailures.map((f) => f.finishedAt),
        ...syncLogErrors.map((s) => s.createdAt),
      ]);

      // Authoritative: `totals` is grouped over the whole window and
      // `syncLogErrorTotal` is an authoritative count. The `recentFailures` and
      // `syncLogErrors` arrays are capped display slices and must never be
      // presented as totals.
      const parts: string[] = [];
      if (totals.failed > 0) parts.push(`${totals.failed} failed import job(s)`);
      if (totals.partial > 0) parts.push(`${totals.partial} partial import job(s)`);
      if (syncLogErrorTotal > 0) parts.push(`${syncLogErrorTotal} sync-log error(s)`);
      const authoritativeCount = totals.failed + totals.partial + syncLogErrorTotal;

      return {
        id: "action-ingestion",
        sectionKey: "ingestion",
        priority: "high",
        title: "Resolve warehouse ingestion failures",
        explanation: parts.length > 0
          ? `${parts.join(", ")} in the last ${windowDays} days.`
          : `Ingestion requires review, but no failed import job or sync-log error was counted in the last ${windowDays} days.`,
        state: "attention",
        cta: { label: "Open reports", href },
        count: authoritativeCount > 0 ? authoritativeCount : undefined,
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
      title: "Switch to All clients to inspect ingestion",
      explanation: describeOperationsReason(section.reason),
      state: "unsupported",
      // Ingestion evidence is workspace-scoped, so the corrective action is a
      // scope switch on THIS surface, not a different page. `targetScope: "all"`
      // makes the CTA land on the Operations view in the canonical All Clients
      // scope; the shared client-context navigation contract builds the URL.
      cta: { label: "View ingestion for All clients", href: summary.navigation.operations, targetScope: "all" },
    };
  }

  // section.state === "empty"
  return {
    id: "action-ingestion",
    sectionKey: "ingestion",
    priority: "low",
    title: "Import initial warehouse data",
    explanation: "No import jobs or sync logs exist in the current window. Start the first warehouse import from the data explorer.",
    state: "empty",
    // The importer lives on the warehouse surface, not Reports. This CTA only
    // navigates; it never triggers a write.
    cta: { label: "Open data explorer", href: summary.navigation.explorer },
  };
}

function deriveReadinessAction(summary: OperationsSummary): OperationsAction | null {
  const section = summary.sections.readiness;
  const href = section.href || summary.navigation.reports;

  if (section.state === "ready") return null;

  if (section.state === "attention") {
    if (section.data) {
      const { totals, evaluatedClients } = section.data;

      // Authoritative counts over every evaluated client. `unknown` is NOT a
      // confirmed warning, and a non-exhaustive evaluation is not a blocker.
      const knownBlockers = totals.notReady + totals.warning;

      if (knownBlockers > 0) {
        const parts: string[] = [];
        if (totals.notReady > 0) parts.push(`${totals.notReady} client(s) cannot produce verified reports due to active blockers`);
        if (totals.warning > 0) parts.push(`${totals.warning} client(s) have report readiness warnings`);
        if (totals.unknown > 0) parts.push(`${totals.unknown} client(s) could not be evaluated for report readiness`);
        return {
          id: "action-readiness",
          sectionKey: "readiness",
          priority: "high",
          title: "Resolve report readiness blockers",
          explanation: `${parts.join(", and ")}.`,
          state: "attention",
          cta: { label: "Open reports", href },
          count: knownBlockers + totals.unknown,
          truncated: section.truncated,
        };
      }

      if (totals.unknown > 0) {
        return {
          id: "action-readiness",
          sectionKey: "readiness",
          priority: "medium",
          title: "Review clients with incomplete readiness evidence",
          explanation: `${totals.unknown} client(s) could not be evaluated for report readiness. Review them on the Reports page.`,
          state: "attention",
          cta: { label: "Open reports", href },
          count: totals.unknown,
          truncated: section.truncated,
        };
      }

      // No confirmed blocker and no unknown client: the section failed closed
      // because evaluation was not exhaustive. Never report a zero warning count.
      return {
        id: "action-readiness",
        sectionKey: "readiness",
        priority: "medium",
        title: "Report readiness coverage is incomplete",
        explanation: `Readiness could not be evaluated for every client in this scope (${evaluatedClients} evaluated), so the summary cannot confirm that all clients are ready.`,
        state: "attention",
        cta: { label: "Open reports", href },
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

      if (totals.total > 0) {
        const parts: string[] = [];
        if (totals.critical > 0) parts.push(`${totals.critical} critical marketing anomaly/anomalies`);
        if (totals.warning > 0) parts.push(`${totals.warning} marketing anomaly/anomalies at warning severity`);
        return {
          id: "action-anomalies",
          sectionKey: "anomalies",
          priority: "high",
          title: "Review marketing anomalies",
          explanation: `${parts.join(", and ")} detected in the last ${windowDays} days.`,
          state: "attention",
          cta: { label: "Open clients", href },
          count: totals.total,
          truncated: section.truncated,
        };
      }

      // Fail-closed because the scan was truncated, not because an anomaly was
      // found. Never assert a zero count as the reason for this action.
      return {
        id: "action-anomalies",
        sectionKey: "anomalies",
        priority: "medium",
        title: "Anomaly evaluation is incomplete",
        explanation: `The marketing anomaly scan could not cover every campaign metric row in this scope, so no conclusion can be drawn about anomalies in the last ${windowDays} days.`,
        state: "attention",
        cta: { label: "Open clients", href },
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
