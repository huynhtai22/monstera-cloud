import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
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

const SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS = 2;

function isSerializationConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "P2034";
}

/**
 * Runs an assignment mutation as one serializable unit. Retrying invokes the
 * callback again so every read and write is recreated from a fresh snapshot.
 */
export async function runSerializableAssignmentTransaction<T>(
  db: ScopedTransaction,
  operation: (tx: ScopedTransaction) => Promise<T>,
): Promise<T> {
  if (!("$transaction" in db) || typeof (db as any).$transaction !== "function") {
    return operation(db);
  }

  for (let attempt = 0; attempt < SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await (db as any).$transaction(
        (tx: ScopedTransaction) => operation(tx),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isSerializationConflict(error)) throw error;
      if (attempt + 1 === SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS) {
        throw new RbacError("Concurrent assignment conflict; retry the operation.", "CONFLICT", 409);
      }
    }
  }

  throw new RbacError("Concurrent assignment conflict; retry the operation.", "CONFLICT", 409);
}

type CutoverTestHooks = {
  afterOwnershipValidation?: () => void | Promise<void>;
};

let cutoverTestHooks: CutoverTestHooks | undefined;

/** Test-only deterministic synchronization point; never configured by routes. */
export function _setCutoverTestHooks(hooks: CutoverTestHooks | undefined): void {
  cutoverTestHooks = hooks;
}

/**
 * Canonicalizes provider account IDs to ensure consistent identity across
 * discovery, assignment, warehouse queries, reports, and evidence.
 *
 * - google_ads: strips hyphens/non-digits if >=8 digits, e.g. "123-456-7890" -> "1234567890".
 * - meta_ads: ensures "act_" prefix, e.g. "123456789" -> "act_123456789".
 * - other providers: trimmed string preserving casing and digits.
 */
export function canonicalizeAccountId(
  provider: string,
  rawId: string | null | undefined,
): string {
  const str = (rawId || "").trim();
  if (!str) return "";

  if (provider === "google_ads") {
    const cleanDigits = str.replace(/\D/g, "");
    return cleanDigits.length >= 8 ? cleanDigits : str;
  }

  if (provider === "meta_ads") {
    if (str.startsWith("act_")) {
      const cleanDigits = str.slice(4).replace(/\D/g, "");
      return cleanDigits.length > 0 ? `act_${cleanDigits}` : str;
    }
    const cleanDigits = str.replace(/\D/g, "");
    return cleanDigits.length >= 6 ? `act_${cleanDigits}` : str;
  }

  return str;
}

/**
 * Checks whether an account was discovered for a specific connection in a workspace.
 */
async function isAccountDiscoveredForConnection(
  workspaceId: string,
  connection: {
    id: string;
    provider: string;
    credentials?: unknown;
    remoteAccountId?: string | null;
  },
  canonicalAccountId: string,
  db: ScopedTransaction,
): Promise<boolean> {
  const provider = connection.provider;

  // 1. Check connection.remoteAccountId
  if (connection.remoteAccountId) {
    if (canonicalizeAccountId(provider, connection.remoteAccountId) === canonicalAccountId) {
      return true;
    }
  }

  // 2. Check extracted accounts from connection credentials
  if (connection.credentials) {
    try {
      const extracted = extractAccountsFromConnection(provider, connection.credentials);
      if (
        extracted.some(
          (acc) => canonicalizeAccountId(provider, acc.id) === canonicalAccountId,
        )
      ) {
        return true;
      }
    } catch {
      // Ignore credential parse errors
    }
  }

  // 3. Check ProviderAccountHealth
  if (db.providerAccountHealth?.findFirst) {
    const health = await db.providerAccountHealth.findFirst({
      where: {
        workspaceId,
        connectionId: connection.id,
      },
      select: { accountId: true },
    });
    if (health && canonicalizeAccountId(provider, health.accountId) === canonicalAccountId) {
      return true;
    }
  }
  if (db.providerAccountHealth?.findMany) {
    const healthRows = await db.providerAccountHealth.findMany({
      where: {
        workspaceId,
        connectionId: connection.id,
      },
      select: { accountId: true },
      take: 100,
    });
    if (
      healthRows.some(
        (h) => canonicalizeAccountId(provider, h.accountId) === canonicalAccountId,
      )
    ) {
      return true;
    }
  }

  // 4. Check CampaignMetric
  if (db.campaignMetric?.findFirst) {
    const metric = await db.campaignMetric.findFirst({
      where: {
        workspaceId,
        connectionId: connection.id,
      },
      select: { accountId: true },
    });
    if (metric && canonicalizeAccountId(provider, metric.accountId) === canonicalAccountId) {
      return true;
    }
  }
  if (db.campaignMetric?.findMany) {
    const metrics = await db.campaignMetric.findMany({
      where: {
        workspaceId,
        connectionId: connection.id,
      },
      distinct: ["accountId"],
      select: { accountId: true },
      take: 100,
    });
    if (
      metrics.some(
        (m) => canonicalizeAccountId(provider, m.accountId) === canonicalAccountId,
      )
    ) {
      return true;
    }
  }

  // 5. Check AccountReportingContext
  if (db.accountReportingContext?.findFirst) {
    const context = await db.accountReportingContext.findFirst({
      where: {
        workspaceId,
        connectionId: connection.id,
      },
      select: { accountId: true },
    });
    if (context && canonicalizeAccountId(provider, context.accountId) === canonicalAccountId) {
      return true;
    }
  }

  return false;
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
  return runSerializableAssignmentTransaction(db, (tx) =>
    assignClientProviderAccountInTransaction(input, tx),
  );
}

async function assignClientProviderAccountInTransaction(
  input: AssignClientAccountInput,
  db: ScopedTransaction,
) {
  const { workspaceId, clientId, provider, accountId, connectionId, actorUserId } = input;

  if (!workspaceId || !clientId || !provider || !accountId || !connectionId) {
    throw new RbacError(
      "workspaceId, clientId, provider, accountId, and connectionId are required",
      "INVALID_REQUEST",
      400,
    );
  }

  const cleanAccountId = canonicalizeAccountId(provider, accountId);
  if (!cleanAccountId) {
    throw new RbacError("accountId cannot be empty", "INVALID_REQUEST", 400);
  }

  // 1. Verify client belongs to workspace
  const client = await db.client.findFirst({
    where: { id: clientId, workspaceId },
    select: { id: true, name: true, accountAssignmentsConfiguredAt: true },
  });
  if (!client) {
    throw new RbacError("Client not found in workspace", "NOT_FOUND", 404);
  }

  // 2. Verify connection belongs to workspace and matches provider
  const connection = await db.connection.findFirst({
    where: { id: connectionId, workspaceId },
    select: {
      id: true,
      name: true,
      provider: true,
      credentials: true,
      remoteAccountId: true,
    },
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

  // 3. P2-4: Validate account was discovered for this connection
  const discovered = await isAccountDiscoveredForConnection(
    workspaceId,
    connection,
    cleanAccountId,
    db,
  );
  if (!discovered) {
    throw new RbacError(
      `Account '${cleanAccountId}' was not discovered on connection '${connection.name}' (${connection.id})`,
      "INVALID_REQUEST",
      400,
    );
  }

  const now = new Date();

  // 4. Mark client as explicit mode if not already marked
  if (!client.accountAssignmentsConfiguredAt) {
    await db.client.update({
      where: { workspaceId_id: { workspaceId, id: clientId } },
      data: { accountAssignmentsConfiguredAt: now },
    });
  }

  // 5. Concurrency-safe upsert with P2002 handling
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

      return {
        assignment: updated,
        action: "authoritative_connection_switched" as const,
      };
    }

    // Identical assignment already exists
    return { assignment: existing, action: "unchanged" as const };
  }

  // Try creating new assignment, catching P2002 if concurrent creation occurred
  try {
    const created = await db.clientProviderAccountAssignment.create({
      data: {
        workspaceId,
        clientId,
        provider,
        accountId: cleanAccountId,
        connectionId,
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
  } catch (err: any) {
    if (err?.code === "P2002" || String(err?.message).includes("Unique constraint")) {
      const racer = await db.clientProviderAccountAssignment.findUnique({
        where: {
          workspaceId_provider_accountId: {
            workspaceId,
            provider,
            accountId: cleanAccountId,
          },
        },
      });
      if (racer) {
        if (racer.clientId === clientId && racer.connectionId === connectionId) {
          return { assignment: racer, action: "unchanged" as const };
        }
        if (racer.clientId === clientId && racer.connectionId !== connectionId) {
          const switched = await db.clientProviderAccountAssignment.update({
            where: { id: racer.id },
            data: { connectionId, assignedAt: now, assignedBy: actorUserId ?? null },
          });
          return {
            assignment: switched,
            action: "authoritative_connection_switched" as const,
          };
        }
        throw new RbacError(
          `Account '${cleanAccountId}' was already assigned to another client by a concurrent operation`,
          "CONFLICT",
          409,
        );
      }
    }
    throw err;
  }
}

/**
 * Bulk assign multiple provider accounts to a single client atomically.
 * Wrapped in db.$transaction if available.
 */
export async function bulkAssignClientProviderAccounts(
  input: BulkAssignClientAccountsInput,
  db: ScopedTransaction = prisma,
) {
  const { workspaceId, clientId, items, actorUserId } = input;
  if (!items || items.length === 0) return [];

  // Deduplicate items by provider:canonicalAccountId
  const uniqueItemsMap = new Map<string, (typeof items)[0]>();
  for (const item of items) {
    const key = `${item.provider}:${canonicalizeAccountId(item.provider, item.accountId)}`;
    if (!uniqueItemsMap.has(key)) {
      uniqueItemsMap.set(key, item);
    }
  }
  const deduplicatedItems = Array.from(uniqueItemsMap.values());

  const executeBulk = async (tx: ScopedTransaction) => {
    // Bulk assignment is deliberately limited to accounts with one discovered
    // root. A multi-root account remains assignable through the single-account
    // flow, where the operator must choose its authoritative connection.
    const discoveredAccounts = await getWorkspaceDiscoveredAccounts(workspaceId, tx);
    const discoveredByTuple = new Map(
      discoveredAccounts.map((account) => [`${account.provider}:${account.accountId}`, account]),
    );
    for (const item of deduplicatedItems) {
      const accountId = canonicalizeAccountId(item.provider, item.accountId);
      const account = discoveredByTuple.get(`${item.provider}:${accountId}`);
      if (!account) {
        throw new RbacError("Bulk assignment account was not discovered in this workspace", "INVALID_REQUEST", 400);
      }
      if (account.hasMultipleRootConnections || account.availableConnections.length !== 1) {
        throw new RbacError(
          "Bulk assignment requires one unambiguous source; choose an authoritative root manually",
          "CONFLICT",
          409,
        );
      }
      if (account.availableConnections[0]?.id !== item.connectionId) {
        throw new RbacError(
          "Bulk assignment connection is not the eligible source for this provider account",
          "INVALID_REQUEST",
          400,
        );
      }
    }

    const results = [];
    for (const item of deduplicatedItems) {
      const res = await assignClientProviderAccount(
        {
          workspaceId,
          clientId,
          provider: item.provider,
          accountId: item.accountId,
          connectionId: item.connectionId,
          actorUserId,
        },
        tx,
      );
      results.push(res);
    }
    return results;
  };

  return runSerializableAssignmentTransaction(db, executeBulk);
}

/**
 * Unassign a provider account from its client.
 * Deleting the active assignment record makes the account visibly Unassigned.
 * Note: client.accountAssignmentsConfiguredAt remains set, preserving explicit empty scope!
 */
export async function unassignClientProviderAccount(
  input: UnassignClientAccountInput,
  db: ScopedTransaction = prisma,
) {
  const { workspaceId, provider, accountId, actorUserId } = input;
  const cleanAccountId = canonicalizeAccountId(provider, accountId);

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
  const cleanAccountId = canonicalizeAccountId(provider, accountId);

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
    select: {
      id: true,
      name: true,
      provider: true,
      credentials: true,
      remoteAccountId: true,
    },
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

  const discovered = await isAccountDiscoveredForConnection(
    workspaceId,
    connection,
    cleanAccountId,
    db,
  );
  if (!discovered) {
    throw new RbacError(
      `Account '${cleanAccountId}' was not discovered on target connection '${connection.name}' (${connection.id})`,
      "INVALID_REQUEST",
      400,
    );
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
      where: { workspaceId },
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

  const assignmentMap = new Map<string, (typeof assignments)[0]>();
  for (const a of assignments) {
    const canonicalId = canonicalizeAccountId(a.provider, a.accountId);
    assignmentMap.set(`${a.provider}:${canonicalId}`, a);
  }

  type DiscoveredEntry = {
    provider: string;
    accountId: string;
    accountName: string;
    connections: Map<string, { id: string; name: string; provider: string; status: string }>;
  };

  const accountMap = new Map<string, DiscoveredEntry>();

  const getOrCreate = (provider: string, rawAccountId: string, defaultName?: string) => {
    const accountId = canonicalizeAccountId(provider, rawAccountId);
    if (!accountId) return null;
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

  for (const conn of connections) {
    let extracted: any[] = [];
    try {
      extracted = extractAccountsFromConnection(conn.provider, conn.credentials);
      for (const acc of extracted) {
        if (!acc.id) continue;
        const entry = getOrCreate(conn.provider, acc.id, acc.name);
        if (entry) {
          entry.connections.set(conn.id, {
            id: conn.id,
            name: conn.name,
            provider: conn.provider,
            status: conn.status,
          });
        }
      }
    } catch {
      // Safe
    }

    if (conn.remoteAccountId && conn.remoteAccountId.trim()) {
      const isMultiRoot =
        (conn.provider === "google_ads" || conn.provider === "meta_ads") && extracted.length > 0;
      if (!isMultiRoot) {
        const entry = getOrCreate(conn.provider, conn.remoteAccountId.trim(), conn.name);
        if (entry) {
          entry.connections.set(conn.id, {
            id: conn.id,
            name: conn.name,
            provider: conn.provider,
            status: conn.status,
          });
        }
      }
    }
  }

  for (const h of healthRows) {
    if (!h.accountId) continue;
    const entry = getOrCreate(h.provider, h.accountId, h.accountName || undefined);
    if (entry) {
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
  }

  for (const m of metricRows) {
    if (!m.accountId) continue;
    const entry = getOrCreate(m.platform, m.accountId, m.accountName || undefined);
    if (entry) {
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
  }

  for (const a of assignments) {
    const canonicalId = canonicalizeAccountId(a.provider, a.accountId);
    const key = `${a.provider}:${canonicalId}`;
    if (!accountMap.has(key)) {
      const conn = connections.find((c) => c.id === a.connectionId);
      const entry = getOrCreate(a.provider, a.accountId);
      if (entry && conn) {
        entry.connections.set(conn.id, {
          id: conn.id,
          name: conn.name,
          provider: conn.provider,
          status: conn.status,
        });
      }
    }
  }

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

  result.sort((a, b) => {
    if (a.isAssigned !== b.isAssigned) return a.isAssigned ? 1 : -1;
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    return a.accountId.localeCompare(b.accountId);
  });

  return result;
}

/**
 * Safe cutover helper (explicit operator mutation):
 * For workspaces where Connection.clientId was historically set, backfills
 * only provably unambiguous accounts into ClientProviderAccountAssignment,
 * then marks the client as explicitly configured (accountAssignmentsConfiguredAt = now).
 * If an account appears under >1 connection in the workspace, it is skipped
 * (left visibly unassigned) to prevent competing sources of truth or double-counting.
 */
/**
 * Transaction-scoped cutover primitive. Callers that coordinate more than one
 * client must pass their existing transaction so all markers, assignments, and
 * audit events share one commit boundary.
 */
export async function cutoverUnambiguousAssignmentsInTransaction(
  workspaceId: string,
  clientId: string,
  tx: ScopedTransaction,
  actorUserId?: string | null,
) {
  const client = await tx.client.findFirst({
    where: { id: clientId, workspaceId },
    select: { id: true, accountAssignmentsConfiguredAt: true },
  });
  if (!client) {
    throw new RbacError("Client not found in workspace", "NOT_FOUND", 404);
  }

  const legacyConnections = await tx.connection.findMany({
    where: { workspaceId, clientId, type: "source" },
    select: { id: true },
  });

  const legacyConnIds = new Set(legacyConnections.map((c) => c.id));
  const allDiscovered = await getWorkspaceDiscoveredAccounts(workspaceId, tx);
  const candidates: Array<{ provider: string; accountId: string; connectionId: string }> = [];
  const now = new Date();

  for (const acc of allDiscovered) {
    const isLegacyConnAccount = acc.availableConnections.some((c) => legacyConnIds.has(c.id));
    if (!isLegacyConnAccount) {
      continue;
    }

    if (acc.hasMultipleRootConnections || acc.availableConnections.length > 1) {
      throw new RbacError("Cutover has an unresolved authoritative-source conflict", "CONFLICT", 409);
    }

    const conn = acc.availableConnections[0];
    if (!legacyConnIds.has(conn.id)) {
      throw new RbacError("Cutover has an unresolved candidate connection", "CONFLICT", 409);
    }
    const existing = await tx.clientProviderAccountAssignment.findUnique({
      where: { workspaceId_provider_accountId: { workspaceId, provider: acc.provider, accountId: acc.accountId } },
    });
    if (existing && (existing.clientId !== clientId || existing.connectionId !== conn.id)) {
      throw new RbacError("Cutover has an account ownership conflict", "CONFLICT", 409);
    }
    candidates.push({ provider: acc.provider, accountId: acc.accountId, connectionId: conn.id });
  }

  await cutoverTestHooks?.afterOwnershipValidation?.();

  const createdAssignments = [];
  for (const candidate of candidates) {
    const existing = await tx.clientProviderAccountAssignment.findUnique({
      where: { workspaceId_provider_accountId: { workspaceId, provider: candidate.provider, accountId: candidate.accountId } },
    });
    if (existing) {
      if (existing.clientId !== clientId || existing.connectionId !== candidate.connectionId) {
        throw new RbacError("Cutover has an account ownership conflict", "CONFLICT", 409);
      }
      createdAssignments.push(existing);
      continue;
    }
    createdAssignments.push(await tx.clientProviderAccountAssignment.create({ data: {
      workspaceId, clientId, provider: candidate.provider, accountId: candidate.accountId,
      connectionId: candidate.connectionId, assignedAt: now, assignedBy: actorUserId ?? null,
    } }));
  }

  const configuredAt = client.accountAssignmentsConfiguredAt ?? now;
  if (!client.accountAssignmentsConfiguredAt) {
    await tx.client.update({
      where: { workspaceId_id: { workspaceId, id: clientId } },
      data: { accountAssignmentsConfiguredAt: configuredAt },
    });
  }

  await tx.auditEvent.create({
    data: {
      workspaceId,
      actorUserId: actorUserId ?? null,
      action: "client_account.cutover_completed",
      resource: "client",
      resourceId: clientId,
      metadata: {
        assignedCount: createdAssignments.length,
        skippedAmbiguousCount: 0,
        legacyConnectionCount: legacyConnections.length,
        alreadyConfigured: Boolean(client.accountAssignmentsConfiguredAt),
      },
    },
  });

  return {
    assignedCount: createdAssignments.length,
    assignments: createdAssignments,
    skippedAmbiguousCount: 0,
    ambiguousAccounts: [],
    configuredAt: configuredAt.toISOString(),
    alreadyConfigured: Boolean(client.accountAssignmentsConfiguredAt),
  };
}

export async function cutoverUnambiguousAssignments(
  workspaceId: string,
  clientId: string,
  db: ScopedTransaction = prisma,
  actorUserId?: string | null,
) {
  return runSerializableAssignmentTransaction(db, (tx) =>
    cutoverUnambiguousAssignmentsInTransaction(workspaceId, clientId, tx, actorUserId),
  );
}
