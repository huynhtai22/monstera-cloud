import type { AgentSnapshot } from "@/hooks/use-agent-run";
import type { DataPreview } from "./AgentTaskSetup";
export type FirstResultPreviews = Record<string, { scopeRevision: number; data: DataPreview }>;
export function confirmedFirstResultTasks(tasks: AgentSnapshot["tasks"], previews: FirstResultPreviews) {
  return tasks.filter(task => {
    const preview = previews[task.id];
    return task.state === "ready" && !!task.confirmedScope && preview?.scopeRevision === task.scopeRevision && preview.data.provider === task.provider && preview.data.verified && preview.data.rowsCount > 0 && preview.data.window.since === task.confirmedScope.since && preview.data.window.until === task.confirmedScope.until;
  });
}
export function firstResultKey(snapshot: AgentSnapshot | null, previews: FirstResultPreviews) {
  if (!snapshot) return "";
  return JSON.stringify({ runId: snapshot.run.id, tasks: snapshot.tasks.map(task => ({ id: task.id, state: task.state, scopeRevision: task.scopeRevision, version: task.version, preview: task.state === "ready" ? previews[task.id] : undefined })) });
}
