import prisma from "@/lib/prisma";
import { extractAccountsFromConnection } from "@/lib/oauth-framework/account-extractor";
import { RbacError } from "@/lib/rbac";
import type { ScopedTransaction } from "@/lib/warehouse-query";

export interface AssignClientAccountInput {
  workspaceId: string;
  clientId: string;
  provider: string;
  accountId: string;
  connectionId: string;
  actorUserId?: string | null;
}

export interface BulkAssignClientAccountsInput {
  workspaceId: string;
  clientId: string;
  items: Array<{
    provider: string;
    accountId: string;
    connectionId: string;
  }>;
  actorUserId?: string | null;
}

export interface UnassignClientAccountInput {
  workspaceId: string;
  provider: string;
  accountId: string;
  actorUserId?: string | null;
}

export interface SwitchConnectionInput {
  workspaceId: string;
  provider: string;
  accountId: string;
  newConnectionId: string;
  actorUserId?: string | null;
}

export interface DiscoveredAccount {
  provider: string;
  accountId: string;
  accountName: string;
  assignedClient: {
    id: string;
    name: string;
  } | null;
  authoritativeConnectionId: string | null;
  assignedAt: Date | null;
  assignedBy: string | null;
  isAssigned: boolean;
  hasMultipleRootConnections: boolean;
  availableConnections: Array<{
    id: string;
    name: string;
    provider: string;
    status: string;
    isAuthoritative: boolean;
  }>;
}

/**
 * Assign a provider account to a client within a workspace.
 * Concurrency-safe: utilizes the @@unique([workspaceId, provider, accountId]) constraint.
 * Records audited events: client_account.assigned, client_account.reassigned, or client_account.authoritative_connection_switched.
 */
export async function assignClientProviderAccount(
  input: AssignClientAccountInput,
  db: ScopedTransaction = prisma,
) {
  const { workspaceId, clientId, provider, accountId, connectionId, actorUserId } = input;

  if (!workspaceId || !clientId || !provider || !accountId || !connectionId) {
    throw new RbacError("workspaceId, clientId, provider, accountId, and connectionId are required", "INVALID_REQUEST", 400);
  }

  const cleanAccountId = accountId.trim();
  if (!cleanAccountId) {
    throw new RbacError("accountId cannot be empty", "INVALID_REQUEST", 400);
  }

  // 1. Verify client belongs to workspace
  const client = await db.client.findFirst({
    where: { id: clientId, workspaceId },
    select: { id: true, name: true },
  });
  if (!client) {
    throw new RbacError("Client not found in workspace", "NOT_FOUND", 404);
  }

  // 2. Verify connection belongs to workspace and matches provider
  const connection = await db.connection.findFirst({
    where: { id: connectionId, workspaceId },
    select: { id: true, name: true, provider: true },
  });
  if (!connection) {
    throw new RbacError("Connection not found in workspace", "NOT_FOUND", 404);
  }
  if (connection.provider !== provider) {
    throw new RbacError(
      `Connection provider '${connection.provider}' does not match requested provider '${provider}'`,
      "INVALID_REQUEST",
      400,
    );
  }

  const now = new Date();

  // 3. Upsert assignment atomically
  const existing = await db.clientProviderAccountAssignment.findUnique({
    where: {
      workspaceId_provider_accountId: {
        workspaceId,
        provider,
        accountId: cleanAccountId,
      },
    },
  });

  if (existing) {
    if (existing.clientId !== clientId) {
      // Reassign to a different client
      const updated = await db.clientProviderAccountAssignment.update({
        where: { id: existing.id },
        data: {
          clientId,
          connectionId,
          status: "active",
          assignedAt: now,
          assignedBy: actorUserId ?? null,
        },
      });

      await db.auditEvent.create({
        data: {
          workspaceId,
          actorUserId: actorUserId ?? null,
          action: "client_account.reassigned",
          resource: "client_provider_account_assignment",
          resourceId: updated.id,
          metadata: {
            provider,
            accountId: cleanAccountId,
            previousClientId: existing.clientId,
            newClientId: clientId,
            previousConnectionId: existing.connectionId,
            newConnectionId: connectionId,
          },
        },
      });

      return { assignment: updated, action: "reassigned" as const };
    }

    if (existing.connectionId !== connectionId) {
      // Switch authoritative connection for the same client
      const updated = await db.clientProviderAccountAssignment.update({
        where: { id: existing.id },
        data: {
          connectionId,
          status: "active",
          assignedAt: now,
          assignedBy: actorUserId ?? null,
        },
      });

      await db.auditEvent.create({
        data: {
          workspaceId,
          actorUserId: actorUserId ?? null,
          action: "client_account.authoritative_connection_switched",
          resource: "client_provider_account_assignment",
          resourceId: updated.id,
          metadata: {
            provider,
            accountId: cleanAccountId,
            clientId,
            previousConnectionId: existing.connectionId,
            newConnectionId: connectionId,
          },
        },
      });

      return { assignment: updated, action: "authoritative_connection_switched" as const };
    }

    // Identical assignment already exists
    return { assignment: existing, action: "unchanged" as const };
  }

  // Create brand new assignment
  const created = await db.clientProviderAccountAssignment.create({
    data: {
      workspaceId,
      clientId,
      provider,
      accountId: cleanAccountId,
      connectionId,
      status: "active",
      assignedAt: now,
      assignedBy: actorUserId ?? null,
    },
  });

  await db.auditEvent.create({
    data: {
      workspaceId,
      actorUserId: actorUserId ?? null,
      action: "client_account.assigned",
      resource: "client_provider_account_assignment",
      resourceId: created.id,
      metadata: {
        provider,
        accountId: cleanAccountId,
        clientId,
        connectionId,
      },
    },
  });

  return { assignment: created, action: "assigned" as const };
}

/**
 * Bulk assign multiple provider accounts to a single client.
 */
export async function bulkAssignClientProviderAccounts(
  input: BulkAssignClientAccountsInput,
  db: ScopedTransaction = prisma,
) {
  const { workspaceId, clientId, items, actorUserId } = input;
  if (!items || items.length === 0) return [];

  const results = [];
  for (const item of items) {
    const res = await assignClientProviderAccount(
      {
        workspaceId,
        clientId,
        provider: item.provider,
        accountId: item.accountId,
        connectionId: item.connectionId,
        actorUserId,
      },
      db,
    );
    results.push(res);
  }
  return results;
}

/**
 * Unassign a provider account from its client.
 * Deleting the active assignment record makes the account visibly Unassigned.
 */
export async function unassignClientProviderAccount(
  input: UnassignClientAccountInput,
  db: ScopedTransaction = prisma,
) {
  const { workspaceId, provider, accountId, actorUserId } = input;
  const cleanAccountId = accountId.trim();

  const existing = await db.clientProviderAccountAssignment.findUnique({
    where: {
      workspaceId_provider_accountId: {
        workspaceId,
        provider,
        accountId: cleanAccountId,
      },
    },
  });

  if (!existing) {
    return { unassigned: false, previousAssignment: null };
  }

  await db.clientProviderAccountAssignment.delete({
    where: { id: existing.id },
  });

  await db.auditEvent.create({
    data: {
      workspaceId,
      actorUserId: actorUserId ?? null,
      action: "client_account.unassigned",
      resource: "client_provider_account_assignment",
      resourceId: existing.id,
      metadata: {
        provider,
        accountId: cleanAccountId,
        previousClientId: existing.clientId,
        previousConnectionId: existing.connectionId,
      },
    },
  });

  return { unassigned: true, previousAssignment: existing };
}

/**
 * Switch the authoritative connection for an already assigned account.
 */
export async function switchAuthoritativeConnection(
  input: SwitchConnectionInput,
  db: ScopedTransaction = prisma,
) {
  const { workspaceId, provider, accountId, newConnectionId, actorUserId } = input;
  const cleanAccountId = accountId.trim();

  const existing = await db.clientProviderAccountAssignment.findUnique({
    where: {
      workspaceId_provider_accountId: {
        workspaceId,
        provider,
        accountId: cleanAccountId,
      },
    },
  });

  if (!existing) {
    throw new RbacError("Assignment not found to switch connection", "NOT_FOUND", 404);
  }

  const connection = await db.connection.findFirst({
    where: { id: newConnectionId, workspaceId },
    select: { id: true, provider: true },
  });

  if (!connection) {
    throw new RbacError("Target connection not found in workspace", "NOT_FOUND", 404);
  }
  if (connection.provider !== provider) {
    throw new RbacError(
      `Connection provider '${connection.provider}' does not match assignment provider '${provider}'`,
      "INVALID_REQUEST",
      400,
    );
  }

  if (existing.connectionId === newConnectionId) {
    return { assignment: existing, changed: false };
  }

  const updated = await db.clientProviderAccountAssignment.update({
    where: { id: existing.id },
    data: {
      connectionId: newConnectionId,
      assignedAt: new Date(),
      assignedBy: actorUserId ?? null,
    },
  });

  await db.auditEvent.create({
    data: {
      workspaceId,
      actorUserId: actorUserId ?? null,
      action: "client_account.authoritative_connection_switched",
      resource: "client_provider_account_assignment",
      resourceId: updated.id,
      metadata: {
        provider,
        accountId: cleanAccountId,
        clientId: existing.clientId,
        previousConnectionId: existing.connectionId,
        newConnectionId,
      },
    },
  });

  return { assignment: updated, changed: true };
}

/**
 * Get all active assignments for a client with authoritative connection details.
 */
export async function getClientAssignedAccounts(
  workspaceId: string,
  clientId: string,
  db: ScopedTransaction = prisma,
) {
  return db.clientProviderAccountAssignment.findMany({
    where: {
      workspaceId,
      clientId,
      status: "active",
    },
    include: {
      connection: {
        select: {
          id: true,
          name: true,
          provider: true,
          status: true,
          lastSyncAt: true,
          lastError: true,
        },
      },
    },
    orderBy: [{ provider: "asc" }, { accountId: "asc" }],
  });
}

/**
 * Discover all provider accounts across the workspace from:
 * 1. Root connection credentials (via extractAccountsFromConnection)
 * 2. ProviderAccountHealth table
 * 3. CampaignMetric distinct accounts
 * 4. Connection.remoteAccountId
 *
 * Joins each discovered account with its active assignment (if any).
 * Flags duplicate root connections when the same account is discovered via >1 connection.
 */
export async function getWorkspaceDiscoveredAccounts(
  workspaceId: string,
  db: ScopedTransaction = prisma,
): Promise<DiscoveredAccount[]> {
  const [connections, healthRows, metricRows, assignments] = await Promise.all([
    db.connection.findMany({
      where: { workspaceId, type: "source" },
      select: {
        id: true,
        name: true,
        provider: true,
        credentials: true,
        remoteAccountId: true,
        status: true,
      },
    }),
    db.providerAccountHealth.findMany({
      where: { workspaceId },
      select: {
        connectionId: true,
        provider: true,
        accountId: true,
        accountName: true,
        status: true,
      },
    }),
    db.campaignMetric.findMany({
      where: { workspaceId },
      distinct: ["connectionId", "platform", "accountId"],
      select: {
        connectionId: true,
        platform: true,
        accountId: true,
        accountName: true,
      },
    }),
    db.clientProviderAccountAssignment.findMany({
      where: { workspaceId, status: "active" },
      include: {
        client: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
  ]);

  // Map assignments by `${provider}:${accountId}`
  const assignmentMap = new Map<string, typeof assignments[0]>();
  for (const a of assignments) {
    assignmentMap.set(`${a.provider}:${a.accountId}`, a);
  }

  // Aggregate accounts keyed by `${provider}:${accountId}`
  type DiscoveredEntry = {
    provider: string;
    accountId: string;
    accountName: string;
    connections: Map<string, { id: string; name: string; provider: string; status: string }>;
  };

  const accountMap = new Map<string, DiscoveredEntry>();

  const getOrCreate = (provider: string, accountId: string, defaultName?: string) => {
    const key = `${provider}:${accountId}`;
    let entry = accountMap.get(key);
    if (!entry) {
      entry = {
        provider,
        accountId,
        accountName: defaultName || accountId,
        connections: new Map(),
      };
      accountMap.set(key, entry);
    } else if (defaultName && entry.accountName === accountId) {
      entry.accountName = defaultName;
    }
    return entry;
  };

  // 1. From connections
  for (const conn of connections) {
    // 1a. Credentials accounts
    let extracted: any[] = [];
    try {
      extracted = extractAccountsFromConnection(conn.provider, conn.credentials);
      for (const acc of extracted) {
        if (!acc.id) continue;
        const entry = getOrCreate(conn.provider, acc.id, acc.name);
        entry.connections.set(conn.id, {
          id: conn.id,
          name: conn.name,
          provider: conn.provider,
          status: conn.status,
        });
      }
    } catch {
      // Credentials decrypt/parse errors handled safely
    }

    // 1b. RemoteAccountId (single account connectors where credentials did not yield child accounts)
    if (extracted.length === 0 && conn.remoteAccountId && conn.remoteAccountId.trim()) {
      const entry = getOrCreate(conn.provider, conn.remoteAccountId.trim(), conn.name);
      entry.connections.set(conn.id, {
        id: conn.id,
        name: conn.name,
        provider: conn.provider,
        status: conn.status,
      });
    }
  }

  // 2. From ProviderAccountHealth
  for (const h of healthRows) {
    if (!h.accountId) continue;
    const entry = getOrCreate(h.provider, h.accountId, h.accountName || undefined);
    const conn = connections.find((c) => c.id === h.connectionId);
    if (conn) {
      entry.connections.set(conn.id, {
        id: conn.id,
        name: conn.name,
        provider: conn.provider,
        status: h.status || conn.status,
      });
    }
  }

  // 3. From CampaignMetric
  for (const m of metricRows) {
    if (!m.accountId) continue;
    const entry = getOrCreate(m.platform, m.accountId, m.accountName || undefined);
    const conn = connections.find((c) => c.id === m.connectionId);
    if (conn) {
      entry.connections.set(conn.id, {
        id: conn.id,
        name: conn.name,
        provider: conn.provider,
        status: conn.status,
      });
    }
  }

  // 4. Ensure any already-assigned accounts are present in discovery even if un-synced
  for (const a of assignments) {
    const key = `${a.provider}:${a.accountId}`;
    if (!accountMap.has(key)) {
      const conn = connections.find((c) => c.id === a.connectionId);
      const entry = getOrCreate(a.provider, a.accountId);
      if (conn) {
        entry.connections.set(conn.id, {
          id: conn.id,
          name: conn.name,
          provider: conn.provider,
          status: conn.status,
        });
      }
    }
  }

  // Transform into final array
  const result: DiscoveredAccount[] = [];

  for (const entry of accountMap.values()) {
    const key = `${entry.provider}:${entry.accountId}`;
    const assignment = assignmentMap.get(key);

    const availableConnections = Array.from(entry.connections.values()).map((c) => ({
      ...c,
      isAuthoritative: assignment ? assignment.connectionId === c.id : false,
    }));

    result.push({
      provider: entry.provider,
      accountId: entry.accountId,
      accountName: entry.accountName,
      assignedClient: assignment
        ? {
            id: assignment.client.id,
            name: assignment.client.name,
          }
        : null,
      authoritativeConnectionId: assignment?.connectionId ?? null,
      assignedAt: assignment?.assignedAt ?? null,
      assignedBy: assignment?.assignedBy ?? null,
      isAssigned: Boolean(assignment),
      hasMultipleRootConnections: availableConnections.length > 1,
      availableConnections,
    });
  }

  // Stable ordering: unassigned first, then provider, then accountId
  result.sort((a, b) => {
    if (a.isAssigned !== b.isAssigned) return a.isAssigned ? 1 : -1;
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    return a.accountId.localeCompare(b.accountId);
  });

  return result;
}

/**
 * Safe cutover helper:
 * For workspaces where Connection.clientId was historically set, backfills
 * only provably unambiguous accounts into ClientProviderAccountAssignment.
 * If an account appears under >1 connection in the workspace, it is skipped
 * (left visibly unassigned) to prevent competing sources of truth or double-counting.
 */
export async function cutoverUnambiguousAssignments(
  workspaceId: string,
  clientId: string,
  db: ScopedTransaction = prisma,
) {
  const legacyConnections = await db.connection.findMany({
    where: { workspaceId, clientId, type: "source" },
    select: { id: true },
  });

  if (legacyConnections.length === 0) return [];
  const legacyConnIds = new Set(legacyConnections.map((c) => c.id));

  const allDiscovered = await getWorkspaceDiscoveredAccounts(workspaceId, db);
  const createdAssignments = [];

  for (const acc of allDiscovered) {
    if (acc.hasMultipleRootConnections) {
      continue;
    }
    if (acc.availableConnections.length !== 1) {
      continue;
    }
    const conn = acc.availableConnections[0];
    if (!legacyConnIds.has(conn.id)) {
      continue;
    }

    try {
      const assignment = await db.clientProviderAccountAssignment.upsert({
        where: {
          workspaceId_provider_accountId: {
            workspaceId,
            provider: acc.provider,
            accountId: acc.accountId,
          },
        },
        create: {
          workspaceId,
          clientId,
          provider: acc.provider,
          accountId: acc.accountId,
          connectionId: conn.id,
          status: "active",
          assignedAt: new Date(),
        },
        update: {},
      });
      createdAssignments.push(assignment);
    } catch {
      // Safe conflict ignore
    }
  }

  return createdAssignments;
}
