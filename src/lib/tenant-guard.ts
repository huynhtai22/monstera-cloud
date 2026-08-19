import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Application-layer stand-in for Postgres RLS.
 *
 * Bulk reads/writes on tenant models must include workspaceId (or a membership
 * nested filter). Fleet cron/webhooks wrap work in withSystemScope().
 */

export const TENANT_GUARDED_MODELS = new Set([
  "Connection",
  "CampaignMetric",
  "WarehouseImportJob",
  "ApiKey",
]);

const LIST_OR_BULK_OPS = new Set([
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
  "createMany",
]);

const CREATE_OPS = new Set(["create", "createMany", "upsert"]);

type GuardStore = { skip: boolean };

const guardStore = new AsyncLocalStorage<GuardStore>();

export function withSystemScope<T>(fn: () => T): T {
  return guardStore.run({ skip: true }, fn);
}

export function shouldSkipTenantGuard(): boolean {
  return guardStore.getStore()?.skip === true;
}

export class TenantScopeError extends Error {
  readonly code = "TENANT_SCOPE_REQUIRED";

  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSinglePrimaryKey(where: unknown): boolean {
  if (!where || typeof where !== "object" || Array.isArray(where)) return false;
  return isNonEmptyString((where as { id?: unknown }).id);
}

function nodeHasWorkspaceScope(node: unknown, depth = 0): boolean {
  if (!node || typeof node !== "object" || depth > 5) return false;
  const record = node as Record<string, unknown>;

  if (isNonEmptyString(record.workspaceId)) return true;

  if (record.workspace && typeof record.workspace === "object") {
    const workspace = record.workspace as Record<string, unknown>;
    if (isNonEmptyString(workspace.id) || isNonEmptyString(workspace.workspaceId)) return true;
    if ("members" in workspace) return true;
    if (workspace.is && nodeHasWorkspaceScope(workspace.is, depth + 1)) return true;
  }

  if (record.pipeline && nodeHasWorkspaceScope(record.pipeline, depth + 1)) return true;

  if (Array.isArray(record.AND) && record.AND.some((item) => nodeHasWorkspaceScope(item, depth + 1))) {
    return true;
  }

  return false;
}

export function argsHaveWorkspaceScope(args: unknown): boolean {
  if (!args || typeof args !== "object") return false;
  const record = args as Record<string, unknown>;
  if (nodeHasWorkspaceScope(record.where)) return true;
  if (nodeHasWorkspaceScope(record.data)) return true;
  if (Array.isArray(record.data) && record.data.length > 0 && record.data.every((item) => nodeHasWorkspaceScope(item))) {
    return true;
  }
  if (record.create && nodeHasWorkspaceScope(record.create)) return true;
  return false;
}

export function assertTenantScoped(model: string | undefined, operation: string, args: unknown): void {
  if (!model || !TENANT_GUARDED_MODELS.has(model)) return;

  if (CREATE_OPS.has(operation) && !argsHaveWorkspaceScope(args) && !isSinglePrimaryKey((args as { where?: unknown })?.where)) {
    throw new TenantScopeError(`${model}.${operation} requires workspaceId`);
  }

  if (!LIST_OR_BULK_OPS.has(operation)) return;

  if (operation === "updateMany" || operation === "deleteMany") {
    if (isSinglePrimaryKey((args as { where?: unknown })?.where) || argsHaveWorkspaceScope(args)) return;
    throw new TenantScopeError(`${model}.${operation} requires workspaceId or a single id`);
  }

  if (!argsHaveWorkspaceScope(args)) {
    throw new TenantScopeError(`${model}.${operation} requires workspaceId`);
  }
}
