export type ImportJobTone = "queued" | "running" | "completed" | "partial" | "failed";

export type ImportJobStatusInput = {
  status: string;
  completedItems?: number;
  totalItems?: number;
  approximateRows?: number;
  retryCount?: number;
  maxRetries?: number;
  heartbeatAt?: string | null;
  errorMsg?: string | null;
};

export type ImportJobStatusView = {
  tone: ImportJobTone;
  title: string;
  detail: string;
};

export function formatAge(iso: string | null | undefined, nowMs: number = Date.now()): string | null {
  if (!iso) return null;
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return null;
  const seconds = Math.max(0, Math.round((nowMs - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/** Copy for the Data Explorer import card — matches Hobby recovery timing. */
export function describeImportJob(
  job: ImportJobStatusInput,
  nowMs: number = Date.now(),
): ImportJobStatusView {
  const completed = job.completedItems ?? 0;
  const total = job.totalItems ?? 0;
  const rows = job.approximateRows ?? 0;
  const retry = job.retryCount ?? 0;
  const maxRetries = job.maxRetries ?? 3;
  const heartbeat = formatAge(job.heartbeatAt, nowMs);

  if (job.status === "failed") {
    return {
      tone: "failed",
      title: "Import failed",
      detail: (job.errorMsg || "The warehouse worker stopped before this job finished.").slice(0, 400),
    };
  }

  if (job.status === "completed") {
    return {
      tone: "completed",
      title: "Import finished",
      detail: `${completed}/${total || completed} source(s) refreshed (~${rows.toLocaleString()} rows).`,
    };
  }

  if (job.status === "partial") {
    return {
      tone: "partial",
      title: "Import partially completed",
      detail: (job.errorMsg || `${completed}/${total || completed} source(s) completed; review failed provider or account scopes before treating this refresh as complete.`).slice(0, 400),
    };
  }

  if (job.status === "running") {
    return {
      tone: "running",
      title: `Running ${completed}/${total || "?"} source(s)`,
      detail: [
        rows ? `~${rows.toLocaleString()} rows so far` : "Ingesting rows",
        heartbeat ? `last heartbeat ${heartbeat}` : "waiting for first heartbeat",
        `retry ${retry}/${maxRetries}`,
      ].join(" · "),
    };
  }

  return {
    tone: "queued",
    title: "Queued — not running yet",
    detail: `A worker picks this up within about 15 minutes (retry ${retry}/${maxRetries}). You can leave this page; the job stays in the queue.`,
  };
}
