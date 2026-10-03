import type { AgentSnapshot } from "@/hooks/use-agent-run";

type Task = AgentSnapshot["tasks"][number];

/** Connection approval and warehouse evidence are separate milestones. */
export type WarehouseEvidence = { verified: boolean; rowsCount: number; scopeRevision: number };
export function taskPresentation(task: Task, evidence?: WarehouseEvidence) {
  const connected = Boolean(task.confirmedScope || task.requestedScope?.connectionId) && task.reasonCode !== "reconnect_required";
  const currentEvidence = evidence?.scopeRevision === task.scopeRevision ? evidence : undefined;
  const imported = task.state === "ready" && currentEvidence?.verified === true && currentEvidence.rowsCount > 0;
  const importing = ["queued", "importing", "verifying"].includes(task.state);
  const label = imported ? "Data in warehouse"
    : task.state === "ready" ? currentEvidence?.rowsCount === 0 ? "Connected · no data for these dates" : "Connected · checking warehouse…"
    : task.state === "deferred" ? connected ? "Connected · saved for later" : "Not connected · saved for later"
    : task.reasonCode === "reconnect_required" ? "Reconnect required"
    : task.state === "waiting_authorization" ? "Connect account"
    : task.state === "discovering_accounts" ? "Finding your accounts…"
    : task.state === "waiting_selection" ? "Connected · choose accounts"
    : importing ? task.state === "queued" ? "Connected · import queued" : "Connected · importing data…"
    : task.reasonCode === "no_data_found" ? "Connected · no data for these dates"
    : connected ? "Connected · needs attention" : "Connection needs attention";
  return { connected, imported, importing, label };
}
