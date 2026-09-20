import type { Prisma } from "@prisma/client";
import type prisma from "./prisma";
import type { ScopedTransaction } from "./warehouse-query";
import { AsyncLocalStorage } from "node:async_hooks";

type TransactionOptions = { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number; maxWait?: number };
const context = new AsyncLocalStorage<{ workspaceId: string | null }>();

/** Never silently nest transactions or switch tenants midway through a unit of work. */
function assertNotNested(): void {
  if (context.getStore()) throw new Error("Database context already active; pass the supplied transaction instead");
}

async function assertRestrictedTenantRole(tx: ScopedTransaction): Promise<void> {
  const [role] = await tx.$queryRaw<Array<{ unsafe: boolean }>>`
    SELECT r.rolsuper OR r.rolbypassrls OR EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND pg_has_role(current_user, c.relowner, 'member')
    ) OR EXISTS (
      SELECT 1 FROM pg_roles s WHERE s.rolname = 'monstera_system' AND pg_has_role(current_user, s.oid, 'member')
    ) OR EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND (
        c.relname IN ('Workspace', 'SyncLog', 'SyncCheckpoint', 'TransformationRule', 'SyncJob', 'ShopeeCatalogSyncState', 'SchemaVersion', 'SyncLogDetail')
        OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'workspaceId' AND NOT a.attisdropped)
      ) AND (NOT c.relrowsecurity OR NOT EXISTS (
        SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'monstera_workspace_isolation' AND NOT p.polpermissive
      ))
    ) AS unsafe FROM pg_roles r WHERE r.rolname = current_user`;
  if (!role || role.unsafe) throw new Error("RLS requires active restrictive policies and a non-owner, non-bypass tenant database role");
}

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
  client: Pick<typeof prisma, "$transaction">,
  workspaceId: string,
  operation: (tx: ScopedTransaction) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  assertWorkspaceContext(workspaceId);
  assertNotNested();
  return context.run({ workspaceId }, () => client.$transaction(async (tx) => {
    if (process.env.DATABASE_RLS_ENFORCED === "1") await assertRestrictedTenantRole(tx);
    await tx.$executeRaw`SELECT set_config('monstera.system_scope', '0', true)`;
    await tx.$executeRaw`SELECT set_config('monstera.workspace_id', ${workspaceId}, true)`;
    return operation(tx);
  }, options));
}

/** Audited fleet/system work must be narrow and transaction-local. */
export async function withDatabaseSystemContext<T>(
  client: Pick<typeof prisma, "$transaction">,
  operation: (tx: ScopedTransaction) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  assertNotNested();
  return context.run({ workspaceId: null }, () => client.$transaction(async (tx) => {
    const [role] = await tx.$queryRaw<Array<{ allowed: boolean }>>`SELECT EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = 'monstera_system' AND pg_has_role(current_user, oid, 'member')
    ) AS allowed`;
    if (!role?.allowed) throw new Error("System database role membership required");
    await tx.$executeRaw`SELECT set_config('monstera.workspace_id', '', true)`;
    await tx.$executeRaw`SELECT set_config('monstera.system_scope', '1', true)`;
    return operation(tx);
  }, options));
}
