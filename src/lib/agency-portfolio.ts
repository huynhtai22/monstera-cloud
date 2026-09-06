/**
 * Multi-client agency portfolio health and triage helpers.
 * Computes unified operational status across agency workspaces and client brands.
 */

export type PortfolioHealthStatus = "healthy" | "needs_attention" | "pending";

export interface PortfolioConnection {
  id: string;
  name: string;
  provider: string;
  status: string;
  lastSyncAt?: string | null;
  lastError?: string | null;
  hasError?: boolean;
}

export interface WorkspacePortfolioItem {
  id: string;
  name: string;
  slug: string;
  role: string;
  plan: string;
  status: string;
  subscriptionEndsAt?: string | null;
  createdAt: string;
  enabledProviders: string[];
  counts: {
    members: number;
    clients: number;
    connections: number;
    sourceConnections: number;
    pipelines: number;
    apiKeys: number;
  };
  sources?: PortfolioConnection[];
  health: {
    status: "healthy" | "error" | "not_synced";
    latestSyncAt: string | null;
    latestJobStatus: string | null;
    latestJobFinishedAt: string | null;
    failingConnections: number;
    failingDetails?: Array<{
      id: string;
      name: string;
      provider: string;
      errorMsg?: string | null;
    }>;
  };
}

export interface ClientWithConnections {
  id: string;
  name: string;
  description?: string | null;
  logoUrl?: string | null;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  isDemo?: boolean;
  requiredProviders?: string[];
  requiredDestinations?: string[];
  requirementsConfiguredAt?: string | null;
  _count?: { pipelines?: number; connections?: number; accountAssignments?: number };
  connections?: PortfolioConnection[];
  accountAssignments?: Array<{
    id: string;
    provider: string;
    accountId: string;
    connectionId: string;
    assignedAt?: string | Date;
    connection?: PortfolioConnection;
  }>;
}

export interface ClientHealthSummary {
  status: PortfolioHealthStatus;
  label: string;
  badgeClass: string;
  failingCount: number;
  latestSyncAt: string | null;
  connectedProviders: string[];
  assignedAccountsCount: number;
  missingRequiredProviders: string[];
}

/**
 * Derive unified health for an individual client from its assigned connections or account assignments.
 */
export function deriveClientHealth(client: {
  connections?: PortfolioConnection[];
  accountAssignments?: Array<{
    id: string;
    provider: string;
    accountId: string;
    connectionId: string;
    connection?: PortfolioConnection;
  }>;
  requiredProviders?: string[];
  _count?: { accountAssignments?: number; connections?: number };
}): ClientHealthSummary {
  const assignedAccountsCount = client.accountAssignments !== undefined
    ? client.accountAssignments.length
    : (client._count?.accountAssignments ?? 0);

  // Derive providers from active account assignments, or fallback to connections
  const assignmentProviders = client.accountAssignments?.map((a) => a.provider) ?? [];
  const connectionProviders = client.connections?.map((c) => c.provider) ?? [];
  const connectedProviders = Array.from(new Set([...assignmentProviders, ...connectionProviders]));

  // Missing required providers check
  const required = client.requiredProviders ?? [];
  const missingRequiredProviders = required.filter((rp) => !connectedProviders.includes(rp));

  // Determine connections to evaluate for health
  let connections: PortfolioConnection[] = [];
  if (client.accountAssignments && client.accountAssignments.length > 0) {
    const fromAssignments = client.accountAssignments.map((a) => a.connection).filter(Boolean) as PortfolioConnection[];
    const seen = new Set<string>();
    for (const conn of fromAssignments) {
      if (!seen.has(conn.id)) {
        seen.add(conn.id);
        connections.push(conn);
      }
    }
  }
  if (connections.length === 0) {
    connections = client.connections ?? [];
  }

  if (connections.length === 0 && assignedAccountsCount === 0) {
    return {
      status: "pending",
      label: missingRequiredProviders.length > 0 ? "Missing required sources" : "No sources",
      badgeClass: missingRequiredProviders.length > 0 ? "border-amber-900/40 bg-amber-950/20 text-amber-300" : "border-line bg-panel text-ink-mute",
      failingCount: 0,
      latestSyncAt: null,
      connectedProviders,
      assignedAccountsCount,
      missingRequiredProviders,
    };
  }

  const failing = connections.filter(
    (c) => c.status === "error" || c.status === "disconnected" || Boolean(c.lastError) || Boolean(c.hasError),
  );

  let latestSync: Date | null = null;
  for (const c of connections) {
    if (c.lastSyncAt) {
      const d = new Date(c.lastSyncAt);
      if (Number.isFinite(d.getTime())) {
        if (!latestSync || d > latestSync) {
          latestSync = d;
        }
      }
    }
  }

  if (failing.length > 0) {
    return {
      status: "needs_attention",
      label: failing.length === 1 ? "1 source needs attention" : `${failing.length} sources need attention`,
      badgeClass: "border-red-900/40 bg-red-950/30 text-red-300",
      failingCount: failing.length,
      latestSyncAt: latestSync ? latestSync.toISOString() : null,
      connectedProviders,
      assignedAccountsCount,
      missingRequiredProviders,
    };
  }

  if (missingRequiredProviders.length > 0) {
    return {
      status: "needs_attention",
      label: `Missing ${missingRequiredProviders.length} required provider${missingRequiredProviders.length === 1 ? "" : "s"}`,
      badgeClass: "border-amber-900/40 bg-amber-950/20 text-amber-300",
      failingCount: 0,
      latestSyncAt: latestSync ? latestSync.toISOString() : null,
      connectedProviders,
      assignedAccountsCount,
      missingRequiredProviders,
    };
  }

  if (latestSync) {
    return {
      status: "healthy",
      label: "All sources healthy",
      badgeClass: "border-emerald-900/40 bg-emerald-950/20 text-emerald-300",
      failingCount: 0,
      latestSyncAt: latestSync.toISOString(),
      connectedProviders,
      assignedAccountsCount,
      missingRequiredProviders,
    };
  }

  return {
    status: "pending",
    label: "Pending initial sync",
    badgeClass: "border-line bg-panel text-ink-mute",
    failingCount: 0,
    latestSyncAt: null,
    connectedProviders,
    assignedAccountsCount,
    missingRequiredProviders,
  };
}

/**
 * Compute top-level portfolio rollup metrics across an agency's workspaces.
 */
export function summarizeWorkspacesPortfolio(workspaces: WorkspacePortfolioItem[]): {
  totalWorkspaces: number;
  totalClients: number;
  totalSources: number;
  healthyCount: number;
  attentionCount: number;
  pendingCount: number;
} {
  let totalClients = 0;
  let totalSources = 0;
  let healthyCount = 0;
  let attentionCount = 0;
  let pendingCount = 0;

  for (const ws of workspaces) {
    totalClients += ws.counts?.clients ?? 0;
    totalSources += ws.counts?.sourceConnections ?? 0;

    if (ws.health.status === "error" || (ws.health.failingConnections ?? 0) > 0) {
      attentionCount++;
    } else if (ws.health.status === "healthy") {
      healthyCount++;
    } else {
      pendingCount++;
    }
  }

  return {
    totalWorkspaces: workspaces.length,
    totalClients,
    totalSources,
    healthyCount,
    attentionCount,
    pendingCount,
  };
}

/**
 * Compute top-level rollup metrics for a list of clients in a workspace.
 */
export function summarizeClientsPortfolio(clients: ClientWithConnections[]): {
  totalClients: number;
  healthyCount: number;
  attentionCount: number;
  pendingCount: number;
} {
  let healthyCount = 0;
  let attentionCount = 0;
  let pendingCount = 0;

  for (const c of clients) {
    const h = deriveClientHealth(c);
    if (h.status === "needs_attention") attentionCount++;
    else if (h.status === "healthy") healthyCount++;
    else pendingCount++;
  }

  return {
    totalClients: clients.length,
    healthyCount,
    attentionCount,
    pendingCount,
  };
}
