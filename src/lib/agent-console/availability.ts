type MonitoringEnvironment = {
  NODE_ENV?: string;
  ENABLE_AGENT_CONSOLE_MONITORING?: string;
  ENABLE_AGENT_CONSOLE_WORKER?: string;
  AGENT_CONSOLE_WORKSPACE_IDS?: string;
};

export function getAgentConsoleMonitoringWorkspaceIds(
  env: MonitoringEnvironment = process.env as MonitoringEnvironment
): string[] {
  return (env.AGENT_CONSOLE_WORKSPACE_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isAgentConsoleMonitoringRuntimeAvailable(
  env: MonitoringEnvironment = process.env as MonitoringEnvironment
): boolean {
  if (env.ENABLE_AGENT_CONSOLE_MONITORING !== "1" || env.ENABLE_AGENT_CONSOLE_WORKER !== "1") return false;
  return env.NODE_ENV !== "production" || getAgentConsoleMonitoringWorkspaceIds(env).length > 0;
}

/** Monitoring is usable only when both the feature and its scheduled worker are enabled. */
export function isAgentConsoleMonitoringAvailable(
  workspaceId: string,
  env: MonitoringEnvironment = process.env as MonitoringEnvironment
): boolean {
  if (!isAgentConsoleMonitoringRuntimeAvailable(env)) return false;
  const workspaceIds = getAgentConsoleMonitoringWorkspaceIds(env);
  return workspaceIds.length === 0 || workspaceIds.includes(workspaceId);
}
