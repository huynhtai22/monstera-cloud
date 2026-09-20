import type { Prisma, PrismaClient } from "@prisma/client";

function assertWorkspaceContext(workspaceId: string): void {
  if (!/^[A-Za-z0-9_-]{1,191}$/.test(workspaceId)) {
    throw new Error("Invalid workspace context");
  }
}

/**
 * Execute database work with a transaction-local RLS workspace. This helper
 * is the required integration point for the future non-owner runtime role;
 * SET LOCAL semantics prevent tenant context leaking through the Prisma pool.
 */
export async function withDatabaseTenantContext<T>(
  client: PrismaClient,
  workspaceId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  assertWorkspaceContext(workspaceId);
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('monstera.workspace_id', ${workspaceId}, true)`;
    return operation(tx);
  });
}

/** Audited fleet/system work must be narrow and transaction-local. */
export async function withDatabaseSystemContext<T>(
  client: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('monstera.system_scope', '1', true)`;
    return operation(tx);
  });
}
