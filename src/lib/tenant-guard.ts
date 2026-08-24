import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Application-layer stand-in for Postgres RLS.
 *
 * Bulk reads/writes on tenant models must include workspaceId (or a membership
 * nested filter). Fleet cron/webhooks wrap work in withSystemScope().
 */

/**
 * Models guarded because they carry a DIRECT, NON-NULL `workspaceId` column,
 * so workspace scope can be enforced correctly at the application layer.
 *
 * Deliberately NOT guarded yet (future RLS / architecture decision):
 * - SyncJob, SyncLog, SyncLogDetail, TransformationRule: owned indirectly via
 *   `pipelineId → Pipeline.workspaceId`. Nested `where.pipeline.workspaceId`
 *   filters satisfy the checker, but fleet cron claims these rows globally by
 *   status/priority, so every call site must be migrated first.
 * - SyncCheckpoint: has `pipelineId` but NO Prisma relation declared, so a
 *   nested ownership filter cannot even be expressed.
 * - WorkspaceInvitation: nullable workspaceId (pre-provisioning invitations).
 * - WorkspaceMember: membership join queried by userId during auth.
 * - WorkspaceProviderAccess: provider entitlements are checked through a
 *   workspace-authorized route before access is granted.
 * - SyncLock: system lease infra keyed by provider scope string.
 * - DashboardTemplate, SchemaVersion: global platform catalogs.
 * - User/Account/Session/VerificationToken/PasswordResetToken: identity tables.
 */
export const TENANT_GUARDED_MODELS = new Set([
  // Existing guards
  "Connection",
  "CampaignMetric",
  "WarehouseImportJob",
  "ApiKey",
  "SupportTicket",
  // Coverage extension (audit 2026-08): direct non-null workspaceId owners
  "Client",
  "Pipeline",
  "RetailOrder",
  "AuditEvent",
  "OAuthAttempt",
  "AttributionSnapshot",
  "DataQualityRule",
  "DataQualityViolation",
  "UserDashboard",
  "LookerJob",
  // No call sites today; guarded so future code cannot regress silently
  "UtmMappingRule",
  "AttributionTouch",
  "ReportSchedule",
]);

/**
 * Direct workspace-owned models that intentionally use a different access
 * pattern. The schema coverage test rejects any new direct owner unless it is
 * guarded here or explicitly documented below.
 */
export const TENANT_GUARD_EXEMPTIONS: Readonly<Record<string, string>> = {
  WorkspaceMember: "Membership joins are queried by user ID during authentication.",
  WorkspaceProviderAccess: "Provider entitlements are accessed through workspace-authorized routes.",
  SyncLock: "System lease infrastructure is keyed by provider scope.",
};

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
    if (workspace.is && typeof workspace.is === "object") {
      const relationTarget = workspace.is as Record<string, unknown>;
      if (isNonEmptyString(relationTarget.id) || isNonEmptyString(relationTarget.workspaceId)) return true;
      if (nodeHasWorkspaceScope(relationTarget, depth + 1)) return true;
    }
  }

  if (record.pipeline && typeof record.pipeline === "object") {
    const pipeline = record.pipeline as Record<string, unknown>;
    const pipelineNode = pipeline.is ?? pipeline;
    if (nodeHasWorkspaceScope(pipelineNode, depth + 1)) return true;
  }

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
