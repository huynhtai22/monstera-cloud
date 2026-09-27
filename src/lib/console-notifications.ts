import type { OperationsSummary } from "./operations-summary";
import { deriveOperationsActions } from "./operations-view";
import { READINESS_MESSAGES } from "./report-readiness";
import { reportRecoveryHref, sourceRecoveryHref } from "./console-recovery";
import { withClientContext } from "./client-context";

export type ConsoleNotification = { id: string; title: string; detail: string; href: string; tone: "error" | "warn" | "info" };
/** Uses the same current evidence as Operations, rather than treating historical errors as open incidents. */
export function consoleNotifications(summary: OperationsSummary): ConsoleNotification[] {
  const items: ConsoleNotification[] = [];
  const clientId = summary.clientContext.client?.id ?? "all";
  const sourceIds = new Set<string>();
  for (const account of summary.sections.connectorHealth.data?.attention ?? []) {
    sourceIds.add(account.connectionId);
    items.push({ id: `account-${account.connectionId}-${account.accountId}`, title: `${account.accountName || account.accountId} · ${account.provider.replaceAll("_", " ")}`,
      detail: `${account.status.replaceAll("_", " ")}. Imports for this account need review before reporting.`, href: sourceRecoveryHref(account.connectionId, clientId), tone: "error" });
  }
  for (const source of summary.sections.freshness.data?.attention ?? []) {
    if (sourceIds.has(source.connectionId)) continue;
    items.push({ id: `source-${source.connectionId}`, title: source.name,
      detail: `${source.state.replaceAll("_", " ")}. Data through ${source.lastDataThrough?.slice(0, 10) || "not confirmed"}; check affected reports.`, href: sourceRecoveryHref(source.connectionId, clientId), tone: "warn" });
  }
  for (const client of summary.sections.readiness.data?.clients ?? []) {
    if (client.status === "READY") continue;
    const code = client.blockers[0] ?? client.warnings[0];
    items.push({ id: `client-${client.clientId}`, title: `${client.clientName} · report ${client.status === "NOT_READY" ? "blocked" : "needs review"}`,
      detail: code ? READINESS_MESSAGES[code] : "Readiness could not be confirmed for this reporting window.", href: reportRecoveryHref(client.clientId, summary.sections.readiness.data?.window), tone: "warn" });
  }
  for (const action of deriveOperationsActions(summary)) {
    const section = summary.sections[action.sectionKey];
    const hasSpecific = action.sectionKey === "connectorHealth" ? (section.data && items.some(i => i.id.startsWith("account-"))) : action.sectionKey === "freshness" ? items.some(i => i.id.startsWith("source-")) || sourceIds.size > 0 : action.sectionKey === "readiness" ? items.some(i => i.id.startsWith("client-")) : false;
    if (hasSpecific && !section.truncated) continue;
    // Keep incomplete coverage and unavailable sections visible; never imply all clear.
    items.push({ id: action.id, title: action.title, detail: action.explanation, href: withClientContext(`/operations#operations-${action.sectionKey}`, clientId), tone: action.priority === "high" ? "error" : "warn" });
  }
  return items;
}
