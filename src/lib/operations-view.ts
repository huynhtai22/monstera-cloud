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
