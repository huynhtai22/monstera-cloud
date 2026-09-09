import prisma from "@/lib/prisma";
import {
  CLIENT_CONTEXT_SURFACE_POLICY,
  parseRequestedClientId,
  type ClientContextSurface,
  type ParsedClientRequest,
} from "@/lib/client-context";

export const CLIENT_CONTEXT_NOT_FOUND_MESSAGE = "Client not found in workspace";

export type ClientContextStatus =
  | "none"
  | "all"
  | "unassigned"
  | "resolved"
  | "not_found"
  | "malformed"
  | "unsupported_all"
  | "unsupported_unassigned";

export type ResolvedClient = {
  id: string;
  name: string;
  workspaceId: string;
  accountAssignmentsConfiguredAt: Date | null;
};

export type ClientContextResolution =
  | { status: "none"; requested: ParsedClientRequest }
  | { status: "all"; requested: ParsedClientRequest }
  | { status: "unassigned"; requested: ParsedClientRequest }
  | { status: "resolved"; requested: ParsedClientRequest; client: ResolvedClient }
  | { status: "not_found"; requested: ParsedClientRequest }
  | { status: "malformed"; requested: ParsedClientRequest }
  | { status: "unsupported_all"; requested: ParsedClientRequest }
  | { status: "unsupported_unassigned"; requested: ParsedClientRequest };

export type ClientContextErrorCode = "CLIENT_NOT_FOUND" | "INVALID_CLIENT" | "UNSUPPORTED_CLIENT_SCOPE";

export class ClientContextError extends Error {
  code: ClientContextErrorCode;
  statusCode: number;

  constructor(message: string, code: ClientContextErrorCode, statusCode: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

type ClientRecord = {
  id: string;
  name: string;
  workspaceId: string;
  accountAssignmentsConfiguredAt?: Date | null;
};

type ClientLookupDb = {
  client: {
    findFirst: (args: Record<string, unknown>) => Promise<ClientRecord | null>;
  };
  clientProviderAccountAssignment?: {
    findMany: (args: Record<string, unknown>) => Promise<Array<{
      provider?: string;
      accountId?: string;
      connectionId: string;
    }>>;
  };
  connection?: {
    findMany: (args: Record<string, unknown>) => Promise<Array<{ id: string }>>;
  };
};

/**
 * Tenant-safe client context resolution. Always qualifies by workspaceId;
 * never looks up a client id in isolation.
 */
export async function resolveClientContext(
  input: {
    workspaceId: string;
    requestedClientId: string | null | undefined;
    surface: ClientContextSurface;
  },
  db: ClientLookupDb = prisma as unknown as ClientLookupDb,
): Promise<ClientContextResolution> {
  const requested = parseRequestedClientId(input.requestedClientId);
  const policy = CLIENT_CONTEXT_SURFACE_POLICY[input.surface];

  if (requested.kind === "malformed") return { status: "malformed", requested };
  if (requested.kind === "missing") return { status: "none", requested };

  if (requested.kind === "all") {
    if (!policy.allowsAllClients) return { status: "unsupported_all", requested };
    return { status: "all", requested };
  }

  if (requested.kind === "unassigned") {
    if (!policy.allowsUnassigned) return { status: "unsupported_unassigned", requested };
    return { status: "unassigned", requested };
  }

  const client = await db.client.findFirst({
    where: { id: requested.raw, workspaceId: input.workspaceId },
    select: { id: true, name: true, workspaceId: true, accountAssignmentsConfiguredAt: true },
  });
  if (!client) return { status: "not_found", requested };
  return {
    status: "resolved",
    requested,
    client: {
      ...client,
      accountAssignmentsConfiguredAt: client.accountAssignmentsConfiguredAt ?? null,
    },
  };
}

export type ClientAssignmentTuple = {
  provider: string;
  accountId: string;
  connectionId: string;
};

export type ClientDataScope = {
  resolution: ClientContextResolution;
  ownershipMode: "workspace" | "unassigned" | "legacy" | "explicit";
  assignments: ClientAssignmentTuple[];
  connectionIds: string[];
};

type ClientScopeDb = ClientLookupDb & {
  clientProviderAccountAssignment: NonNullable<ClientLookupDb["clientProviderAccountAssignment"]>;
  connection: NonNullable<ClientLookupDb["connection"]>;
};

type TransactionalClientScopeDb = ClientScopeDb & {
  $transaction: <T>(
    callback: (tx: ClientScopeDb) => Promise<T>,
    options: { isolationLevel: "RepeatableRead" },
  ) => Promise<T>;
};

function supportsTransactions(db: ClientScopeDb): db is TransactionalClientScopeDb {
  return "$transaction" in db && typeof (db as Partial<TransactionalClientScopeDb>).$transaction === "function";
}

/**
 * Resolve the cutover marker and its ownership rows from one repeatable-read
 * snapshot. Routes must not combine legacy pointers with authoritative
 * assignments from different moments during a concurrent cutover.
 */
export async function resolveClientDataScope(
  input: {
    workspaceId: string;
    requestedClientId: string | null | undefined;
    surface: ClientContextSurface;
  },
  db: ClientScopeDb = prisma as unknown as ClientScopeDb,
): Promise<ClientDataScope> {
  const read = async (tx: ClientScopeDb): Promise<ClientDataScope> => {
    const resolution = await resolveClientContext(input, tx);
    assertQueryableClientContext(resolution);

    if (resolution.status === "unassigned") {
      return { resolution, ownershipMode: "unassigned", assignments: [], connectionIds: [] };
    }
    if (resolution.status !== "resolved") {
      return { resolution, ownershipMode: "workspace", assignments: [], connectionIds: [] };
    }

    if (resolution.client.accountAssignmentsConfiguredAt != null) {
      const rows = await tx.clientProviderAccountAssignment.findMany({
        where: { workspaceId: input.workspaceId, clientId: resolution.client.id },
        select: { provider: true, accountId: true, connectionId: true },
      });
      const assignments = rows.flatMap((row) =>
        typeof row.provider === "string" && typeof row.accountId === "string"
          ? [{ provider: row.provider, accountId: row.accountId, connectionId: row.connectionId }]
          : [],
      );
      return {
        resolution,
        ownershipMode: "explicit",
        assignments,
        connectionIds: [...new Set(assignments.map((row) => row.connectionId))],
      };
    }

    const rows = await tx.connection.findMany({
      where: { workspaceId: input.workspaceId, clientId: resolution.client.id, type: "source" },
      select: { id: true },
    });
    return {
      resolution,
      ownershipMode: "legacy",
      assignments: [],
      connectionIds: rows.map((row) => row.id),
    };
  };

  return supportsTransactions(db)
    ? db.$transaction(read, { isolationLevel: "RepeatableRead" })
    : read(db);
}

export function assertQueryableClientContext(
  resolution: ClientContextResolution,
  options: { requireExplicitClient?: boolean } = {},
): ClientContextResolution {
  if (resolution.status === "malformed") {
    throw new ClientContextError(CLIENT_CONTEXT_NOT_FOUND_MESSAGE, "INVALID_CLIENT", 400);
  }
  if (resolution.status === "not_found") {
    throw new ClientContextError(CLIENT_CONTEXT_NOT_FOUND_MESSAGE, "CLIENT_NOT_FOUND", 404);
  }
  if (resolution.status === "unsupported_all" || resolution.status === "unsupported_unassigned") {
    throw new ClientContextError(CLIENT_CONTEXT_NOT_FOUND_MESSAGE, "UNSUPPORTED_CLIENT_SCOPE", 400);
  }
  if (
    options.requireExplicitClient
    && (resolution.status === "none" || resolution.status === "all" || resolution.status === "unassigned")
  ) {
    throw new ClientContextError("clientId is required", "INVALID_CLIENT", 400);
  }
  return resolution;
}

export function toClientContextResponse(error: unknown): Response | null {
  if (!(error instanceof ClientContextError)) return null;
  return Response.json(
    { error: error.message, code: error.code },
    { status: error.statusCode },
  );
}

/**
 * Value to pass into `queryWarehouse` / `queryMetricsAggregate`.
 * Never returns the `all` token — missing and all-clients both mean workspace-wide.
 */
export function warehouseClientId(resolution: ClientContextResolution): string | undefined {
  if (resolution.status === "unassigned") return "unassigned";
  if (resolution.status === "resolved") return resolution.client.id;
  return undefined;
}

export function resolvedClientPayload(
  resolution: ClientContextResolution,
): { id: string; name: string } | null {
  return resolution.status === "resolved"
    ? { id: resolution.client.id, name: resolution.client.name }
    : null;
}

export async function sourceConnectionIdsForClient(
  workspaceId: string,
  clientId: string,
  db: ClientLookupDb = prisma as unknown as ClientLookupDb,
): Promise<string[]> {
  const client = await db.client.findFirst({
    where: { id: clientId, workspaceId },
    select: { id: true, name: true, workspaceId: true, accountAssignmentsConfiguredAt: true },
  });
  if (!client) return [];
  if (client.accountAssignmentsConfiguredAt != null && db.clientProviderAccountAssignment?.findMany) {
    const assignments = await db.clientProviderAccountAssignment.findMany({
      where: { workspaceId, clientId },
      select: { connectionId: true },
    });
    return [...new Set(assignments.map((row) => row.connectionId))];
  }
  if (!db.connection?.findMany) return [];
  const connections = await db.connection.findMany({
    where: { workspaceId, clientId, type: "source" },
    select: { id: true },
  });
  return connections.map((row) => row.id);
}
