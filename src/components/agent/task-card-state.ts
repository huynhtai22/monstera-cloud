import type { AgentSnapshot } from "@/hooks/use-agent-run";
import type { TaskCardStatus } from "./MonsteraTaskCard";

export function taskCardState(
  task: AgentSnapshot["tasks"][number],
  paused: boolean,
): { status: TaskCardStatus; label: string } {
  if (paused)
    return {
      status: "paused",
      label: ["queued", "importing", "verifying"].includes(task.state)
        ? "Setup paused · started imports may still run"
        : "Task paused",
    };
  if (
    ["queued", "importing", "verifying", "discovering_accounts"].includes(
      task.state,
    )
  ) {
    const labels: Record<string, string> = {
      queued: "Import queued",
      importing: "Importing approved accounts",
      verifying: "Checking imported data",
      discovering_accounts: "Finding available accounts",
    };
    return { status: "running", label: labels[task.state] };
  }
  if (
    task.state === "ready" &&
    task.result?.verified &&
    task.result.rowsCount > 0
  )
    return {
      status: "complete",
      label: `${task.result.rowsCount.toLocaleString()} rows imported · output review remains separate`,
    };
  if (task.state === "needs_attention")
    return {
      status: "attention",
      label:
        task.reasonCode === "reconnect_required"
          ? "Reconnect to continue"
          : "Review required before continuing",
    };
  return {
    status: "waiting",
    label:
      task.state === "waiting_authorization"
        ? "Waiting for your consent"
        : task.state === "waiting_selection"
          ? "Choose accounts and reporting dates"
          : task.state === "deferred"
            ? "Saved for later"
            : "Review imported data",
  };
}

export function taskImportProgress(task: AgentSnapshot["tasks"][number]) {
  const completed = task.result?.completedItems,
    total = task.result?.totalItems;
  return Number.isFinite(completed) && Number.isFinite(total)
    ? `${completed} of ${total} account imports checked`
    : task.state === "queued"
      ? "Import queued"
      : "No import outcome recorded yet";
}
