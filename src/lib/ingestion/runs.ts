import { classifyIngestionError, nextActionForError, type IngestionNextAction } from "./error-taxonomy";

export type RunKind = "warehouse_import" | "pipeline_sync";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "partial" | "success" | "error";

export type RunRecord = {
  id: string;
  kind: RunKind;
  status: RunStatus;
  title: string;
  tag: string | null;
  errorKind: string | null;
  action: IngestionNextAction;
  rows: number;
  durationMs: number;
  retryCount: number;
  maxRetries: number;
  workspaceId: string;
  connectionId: string | null;
  pipelineId: string | null;
  errorMsg: string | null;
  createdAt: string;
  heartbeatAt: string | null;
};

export function mapWarehouseJobToRun(job: {
  id: string;
  workspaceId: string;
  status: string;
  approximateRows: number;
  retryCount: number;
  maxRetries: number;
  errorMsg: string | null;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  createdAt: Date | string;
  heartbeatAt: Date | string | null;
  items?: unknown;
  results?: unknown;
}): RunRecord {
  const results = Array.isArray(job.results) ? (job.results as Array<{ ok?: boolean; error?: string; connectionId?: string }>) : [];
  const failed = results.filter((row) => row && row.ok === false);
  let status = job.status as RunStatus;
  if (job.status === "completed" && failed.length > 0) status = "partial";

  const errorText = job.errorMsg || failed[0]?.error || null;
  const classified = errorText ? classifyIngestionError(errorText) : null;
  const items = Array.isArray(job.items) ? (job.items as Array<{ connectionId?: string }>) : [];
  const connectionId = items[0]?.connectionId || failed[0]?.connectionId || null;
  const started = job.startedAt ? new Date(job.startedAt).getTime() : null;
  const finished = job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now();

  return {
    id: job.id,
    kind: "warehouse_import",
    status,
    title: "Warehouse import",
    tag: classified?.tag ?? null,
    errorKind: classified?.kind ?? null,
    action: nextActionForError(classified),
    rows: job.approximateRows ?? 0,
    durationMs: started ? Math.max(0, finished - started) : 0,
    retryCount: job.retryCount ?? 0,
    maxRetries: job.maxRetries ?? 3,
    workspaceId: job.workspaceId,
    connectionId,
    pipelineId: null,
    errorMsg: errorText,
    createdAt: new Date(job.createdAt).toISOString(),
    heartbeatAt: job.heartbeatAt ? new Date(job.heartbeatAt).toISOString() : null,
  };
}

export function mapSyncLogToRun(log: {
  id: string;
  status: string;
  rowsSynced: number;
  durationMs: number;
  errorMsg: string | null;
  createdAt: Date | string;
  pipeline: { id: string; name: string; sourceConnectionId: string | null; workspaceId: string };
}): RunRecord {
  const classified = log.status === "error" && log.errorMsg ? classifyIngestionError(log.errorMsg) : null;
  return {
    id: log.id,
    kind: "pipeline_sync",
    status: log.status === "error" ? "error" : log.status === "success" ? "success" : (log.status as RunStatus),
    title: log.pipeline?.name || "Pipeline sync",
    tag: classified?.tag ?? null,
    errorKind: classified?.kind ?? null,
    action: nextActionForError(classified),
    rows: log.rowsSynced ?? 0,
    durationMs: log.durationMs ?? 0,
    retryCount: 0,
    maxRetries: 0,
    workspaceId: log.pipeline.workspaceId,
    connectionId: log.pipeline.sourceConnectionId,
    pipelineId: log.pipeline.id,
    errorMsg: log.errorMsg,
    createdAt: new Date(log.createdAt).toISOString(),
    heartbeatAt: null,
  };
}

export function formatRunDiagnostics(run: RunRecord): string {
  return [
    `workspaceId=${run.workspaceId}`,
    `runId=${run.id}`,
    `kind=${run.kind}`,
    `status=${run.status}`,
    run.connectionId ? `connectionId=${run.connectionId}` : null,
    run.pipelineId ? `pipelineId=${run.pipelineId}` : null,
    run.tag ? `tag=${run.tag}` : null,
    `rows=${run.rows}`,
    `durationMs=${run.durationMs}`,
    run.errorMsg ? `error=${run.errorMsg.slice(0, 400)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
