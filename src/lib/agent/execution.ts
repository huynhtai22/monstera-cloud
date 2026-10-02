import { z } from "zod";
import { META_CANONICAL_METRIC_GRAIN } from "@/lib/meta-ingest";
import { encrypt, safeDecrypt } from "@/lib/encryption";
import { Prisma } from "@prisma/client";
import { clampTimeRangeToPlanMaxDays } from "@/lib/plan-config";
import { isConnectEnabled } from "@/lib/integration-flags";
import { createImportJob, type BatchImportJobResult } from "@/lib/warehouse-import-job";
import { assertExecutableWarehouseRange } from "@/lib/warehouse-execution-guard";
import { assignClientProviderAccount } from "@/lib/client-account-assignment";
import { recordDashboardReviewMilestone, PilotActivationConflictError } from "@/lib/pilot-activation-store";
import { AgentError, VersionSchema, ConfirmScopeInputSchema, type AgentScope } from "./contracts";
import { agentTransaction, appendAgentEvent } from "./events";
import { assertRunWritable, requireAgentRun, type AgentTransaction } from "./scope";
import { discoverProviderAccounts, guidedProviders } from "./specialists";
import { ConfirmedScopeSchema, OfferedScopeSchema, initialImportWindow, scopeTargets } from "./execution-contracts";

function publicTask<T extends { connections: unknown }>(task: T): Omit<T, "connections"> {
  const { connections, ...result } = task;
  void connections;
  return result;
}

async function requireTask(tx: AgentTransaction, scope: AgentScope, taskId: string, write = true) {
  const task = await tx.agentTask.findFirst({ where: { id: taskId, workspaceId: scope.workspaceId }, include: { connections: { include: { connection: true } } } });
  if (!task) throw new AgentError("task_not_found", "Task not found", 404);
  const run = await requireAgentRun(tx, scope, task.runId, write);
  if (write) assertRunWritable(run.status);
  return { task, run };
}

async function assertProviderEnabled(tx: AgentTransaction, workspaceId: string, provider: string) {
  if (!guidedProviders.some(id => id === provider)) throw new AgentError("provider_not_available", "Guided setup is unavailable for this provider", 400);
  if (!isConnectEnabled(provider) || !await tx.workspaceProviderAccess.findFirst({ where: { workspaceId, provider, enabled: true } })) {
    throw new AgentError("provider_not_enabled", "This source is not enabled for this workspace", 403);
  }
}

function checkVersion(version: number, expected: number) {
  VersionSchema.parse(expected);
  if (version !== expected) throw new AgentError("stale_version", "Setup changed; refresh and try again", 409, version);
}

export async function validateAgentOAuthTask(scope: AgentScope, taskId: string, provider: string) {
  if (process.env.ENABLE_AGENT_ONBOARDING !== "1") throw new AgentError("not_found", "Not found", 404);
  return agentTransaction(async tx => {
    const { task } = await requireTask(tx, scope, taskId);
    await assertProviderEnabled(tx, scope.workspaceId, provider);
    if (task.provider !== provider || task.confirmedScope || !["waiting_authorization", "needs_attention"].includes(task.state)) throw new AgentError("invalid_transition", "This task cannot start authorization");
    return task;
  });
}

export async function recordTaskAuthorizationFailure(scope: AgentScope, taskId: string, reason: string) {
  return agentTransaction(async tx => {
    const { task } = await requireTask(tx, scope, taskId);
    if (!["waiting_authorization", "discovering_accounts", "needs_attention"].includes(task.state) || task.confirmedScope) return;
    if (task.state === "needs_attention" && task.reasonCode === reason) return;
    await tx.agentTask.update({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: taskId } }, data: { state: "needs_attention", reasonCode: reason, version: { increment: 1 } } });
    await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId: task.runId, taskId, type: "authorization_failed", payload: { reasonCode: reason } });
  });
}

export async function listTaskConnections(scope: AgentScope, taskId: string) {
  return agentTransaction(async tx => {
    const { task } = await requireTask(tx, scope, taskId);
    await assertProviderEnabled(tx, scope.workspaceId, task.provider);
    return tx.connection.findMany({ where: { workspaceId: scope.workspaceId, type: "source", provider: task.provider, status: "connected" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  });
}

export async function reuseTaskConnection(scope: AgentScope, taskId: string, connectionId: string | string[], expectedVersion: number) {
  const task = await agentTransaction(async tx => {
    const { task } = await requireTask(tx, scope, taskId);
    await assertProviderEnabled(tx, scope.workspaceId, task.provider);
    checkVersion(task.version, expectedVersion);
    if (task.confirmedScope || !["waiting_authorization", "needs_attention"].includes(task.state)) throw new AgentError("invalid_transition", "This task cannot reuse a source");
    const ids = [...new Set(z.array(z.string().min(1).max(200)).min(1).max(task.provider === "google_ads" ? 100 : 1).parse(Array.isArray(connectionId) ? connectionId : [connectionId]))];
    const connections = await tx.connection.findMany({ where: { workspaceId: scope.workspaceId, id: { in: ids }, provider: task.provider, type: "source", status: "connected" } });
    if (connections.length !== ids.length) throw new AgentError("connection_not_available", "Choose an authorized workspace source", 404);
    await tx.agentTaskConnection.deleteMany({ where: { workspaceId: scope.workspaceId, taskId } });
    await tx.agentTaskConnection.createMany({ data: ids.map(connectionId => ({ workspaceId: scope.workspaceId, taskId, connectionId })) });
    const updated = await tx.agentTask.update({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: taskId } }, data: { state: "discovering_accounts", requestedScope: Prisma.DbNull, reasonCode: null, version: { increment: 1 } } });
    await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId: task.runId, taskId, type: "connection_reused", payload: { connectionIds: ids } });
    return updated;
  });
  return discoverTaskAccounts(scope, taskId, task.version);
}

type BoundConnection = { id: string; name: string; credentials: string; status: string; provider: string; remoteAccountId: string | null };
function assertConnectionsUnchanged(current: { connection: BoundConnection }[], prior: { connection: BoundConnection }[]) {
  if (current.length !== prior.length || prior.some(({ connection: old }) => !current.some(({ connection }) => connection.id === old.id && connection.credentials === old.credentials && connection.remoteAccountId === old.remoteAccountId && connection.status === "connected"))) throw new AgentError("stale_connection", "Connection changed; refresh account discovery");
}
async function discoverBoundAccounts(links: { connection: BoundConnection }[]) {
  const groups = await Promise.all(links.map(async ({ connection }) => ({ connection, accounts: await discoverProviderAccounts(connection) })));
  // Selection keys distinguish a leaf accessible through two manager roots.
  return groups.flatMap(({ connection, accounts }) => accounts.map(account => ({ id: connection.provider === "google_ads" ? JSON.stringify([connection.id, account.id]) : account.id, accountId: account.id, connectionId: connection.id, name: groups.length > 1 ? `${account.name} · ${connection.name}` : account.name })));
}

/** Network discovery occurs outside the serializable write. Recheck ownership,
 * version and credentials afterwards, so consent cannot retarget running work. */
export async function discoverTaskAccounts(scope: AgentScope, taskId: string, expectedVersion: number) {
  const prepared = await agentTransaction(async tx => {
    const { task } = await requireTask(tx, scope, taskId);
    await assertProviderEnabled(tx, scope.workspaceId, task.provider);
    checkVersion(task.version, expectedVersion);
    if (task.confirmedScope || !["discovering_accounts", "needs_attention"].includes(task.state)) throw new AgentError("invalid_transition", "Account discovery is unavailable for this step");
    if (!task.connections.length || (task.provider !== "google_ads" && task.connections.length !== 1)) throw new AgentError("connection_required", "Choose authorized source connections");
    return task;
  });
  const connection = prepared.connections[0].connection;
  let accounts: Awaited<ReturnType<typeof discoverBoundAccounts>> = [];
  let failure: string | null = null;
  try { accounts = await discoverBoundAccounts(prepared.connections); if (!accounts.length) failure = "no_accounts"; }
  catch (error) { failure = error instanceof AgentError ? error.code : "discovery_failed"; }
  return agentTransaction(async tx => {
    const { task } = await requireTask(tx, scope, taskId);
    await assertProviderEnabled(tx, scope.workspaceId, task.provider);
    checkVersion(task.version, expectedVersion);
    assertConnectionsUnchanged(task.connections, prepared.connections);
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: scope.workspaceId }, select: { plan: true } });
    const rawWindow = initialImportWindow();
    const window = clampTimeRangeToPlanMaxDays(workspace.plan, rawWindow);
    const updated = await tx.agentTask.update({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: taskId } }, data: {
      state: failure ? "needs_attention" : "waiting_selection", reasonCode: failure, version: { increment: 1 },
      requestedScope: { connectionId: connection.id, accounts, window: { since: window.since, until: window.until }, discoveredAt: new Date().toISOString() },
    } });
    await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId: task.runId, taskId, type: "accounts_discovered", payload: { count: accounts.length, reasonCode: failure } });
    return updated;
  });
}

/** Atomic scope + job creation. Same-scope replay returns the existing job even
 * with the original version; a different selection never reuses that approval. */
export async function confirmTaskScopeAndEnqueueImport(scope: AgentScope, taskId: string, rawInput: unknown) {
  const input = ConfirmScopeInputSchema.parse(rawInput);
  const selected = [...new Set(input.selectedAccountIds)].sort();
  const prepared = await agentTransaction(async tx => {
    const { task } = await requireTask(tx, scope, taskId);
    await assertProviderEnabled(tx, scope.workspaceId, task.provider);
    const offered = OfferedScopeSchema.parse(task.requestedScope);
    const window = { since: input.since ?? offered.window.since, until: input.until ?? offered.window.until };
    const confirmed = ConfirmedScopeSchema.safeParse(task.confirmedScope);
    if (task.importJobId && confirmed.success) {
      const same = confirmed.data.since === window.since && confirmed.data.until === window.until && JSON.stringify([...confirmed.data.selectedAccountIds].sort()) === JSON.stringify(selected);
      if (!same) throw new AgentError("scope_conflict", "This import already has a confirmed scope");
      return { task, offered, window, replay: true };
    }
    checkVersion(task.version, input.expectedVersion);
    if (task.state !== "waiting_selection" || !task.connections.length) throw new AgentError("invalid_transition", "Discover accounts before confirming your import");
    if (selected.some(id => !offered.accounts.some(account => account.id === id))) throw new AgentError("unavailable_account", "Choose accounts from the authorized list", 400);
    return { task, offered, window, replay: false };
  });
  if (prepared.replay) return publicTask(prepared.task);
  const accounts = await discoverBoundAccounts(prepared.task.connections);
  if (selected.some(id => !accounts.some(account => account.id === id))) throw new AgentError("unavailable_account", "An account is no longer authorized; refresh the account list", 400);
  return agentTransaction(async tx => {
    const { task, run } = await requireTask(tx, scope, taskId);
    await assertProviderEnabled(tx, scope.workspaceId, task.provider);
    // A concurrent identical confirmation may have already committed.
    if (task.importJobId) {
      const prior = ConfirmedScopeSchema.parse(task.confirmedScope);
      if (prior.since === prepared.window.since && prior.until === prepared.window.until && JSON.stringify([...prior.selectedAccountIds].sort()) === JSON.stringify(selected)) return publicTask(task);
    }
    checkVersion(task.version, input.expectedVersion);
    if (task.state !== "waiting_selection") throw new AgentError("invalid_transition", "Choose accounts before importing");
    assertConnectionsUnchanged(task.connections, prepared.task.connections);
    const targets = selected.map(key => { const account = prepared.offered.accounts.find(row => row.id === key)!; return { key, connectionId: account.connectionId ?? prepared.offered.connectionId, accountId: account.accountId ?? account.id }; });
    if (new Set(targets.map(target => target.accountId)).size !== targets.length) throw new AgentError("duplicate_account", "Choose each account through only one connection", 400);
    const { since, until } = prepared.window;
    if (since > until || until > initialImportWindow().until || (new Date(`${until}T00:00:00Z`).getTime() - new Date(`${since}T00:00:00Z`).getTime()) / 86400000 >= 30) throw new AgentError("invalid_date_range", "Choose up to 30 complete days, ending yesterday or earlier", 400);
    assertExecutableWarehouseRange({ provider: task.provider, since, until });
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: scope.workspaceId }, select: { plan: true } });
    const clamped = clampTimeRangeToPlanMaxDays(workspace.plan, { since, until });
    if (clamped.since !== since || clamped.until !== until) throw new AgentError("scope_changed", `Your plan allows ${clamped.since} to ${clamped.until}. Review these dates and confirm again.`);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.workspaceId}), 8123)`;
    if (await tx.warehouseImportJob.count({ where: { workspaceId: scope.workspaceId, status: { in: ["queued", "running"] } } }) >= 5) throw new AgentError("concurrency_limit", "Wait for an active workspace import to finish", 429);
    await tx.agentTaskConnection.updateMany({ where: { workspaceId: scope.workspaceId, taskId }, data: { selectedAccountIds: [] } });
    for (const { connection } of task.connections.filter(link => targets.some(target => target.connectionId === link.connectionId))) {
      if (await tx.warehouseImportJob.findFirst({ where: { workspaceId: scope.workspaceId, status: { in: ["queued", "running"] }, items: { array_contains: [{ connectionId: connection.id }] } } })) throw new AgentError("connection_busy", "This connection already has an active import");
      const inventory = accounts.filter(account => account.connectionId === connection.id).map(account => ({ id: account.accountId, name: account.name }));
      if (["meta_ads", "tiktok_business"].includes(task.provider)) {
        const credentials = JSON.parse(safeDecrypt(connection.credentials));
        await tx.connection.update({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: connection.id } }, data: { credentials: encrypt(JSON.stringify({ ...credentials, ...(task.provider === "meta_ads" ? { adAccounts: inventory } : { advertiserIds: inventory.map(account => account.id) }) })) } });
      }
      await tx.agentTaskConnection.update({ where: { taskId_connectionId: { taskId, connectionId: connection.id } }, data: { selectedAccountIds: targets.filter(target => target.connectionId === connection.id).map(target => target.accountId) } });
    }
    if (run.clientId) {
      for (const { accountId, connectionId } of targets) {
        const assignment = await tx.clientProviderAccountAssignment.findFirst({ where: { workspaceId: scope.workspaceId, provider: task.provider, accountId } });
        if (assignment && (assignment.clientId !== run.clientId || assignment.connectionId !== connectionId)) throw new AgentError("client_scope_conflict", "This account is assigned elsewhere. Manage client assignments before importing.");
        await assignClientProviderAccount({ workspaceId: scope.workspaceId, clientId: run.clientId, provider: task.provider, accountId, connectionId, actorUserId: scope.userId }, tx);
      }
    }
    const revision = task.scopeRevision + 1;
    const job = await createImportJob({ workspaceId: scope.workspaceId, userId: scope.userId, plan: workspace.plan, since, until, items: targets.map(({ accountId, connectionId }) => ({ connectionId, accountId, ...(task.provider === "meta_ads" ? { adAccountId: accountId } : {}) })), idempotencyKey: `onboarding:${task.id}:${revision}`, client: tx });
    const confirmedScope = { provider: task.provider, connectionId: targets[0].connectionId, selectedAccountIds: selected, targets, since, until };
    const updated = await tx.agentTask.update({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: taskId } }, data: { state: "queued", reasonCode: null, confirmedScope, confirmedAt: new Date(), confirmedByUserId: scope.userId, scopeRevision: revision, importJobId: job.id, version: { increment: 1 } } });
    await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId: task.runId, taskId, type: "scope_confirmed", payload: { confirmedScope, jobId: job.id, revision } });
    return updated;
  });
}

type Recovery = { successfulAccountIds: string[]; importedRows: number; requestVersion: number };
const RecoverySchema = z.object({ successfulAccountIds: z.array(z.string()), importedRows: z.number().nonnegative(), requestVersion: VersionSchema });
function recoveryFrom(result: unknown): Recovery {
  const parsed = RecoverySchema.safeParse((result as { recovery?: unknown } | null)?.recovery);
  return parsed.success ? parsed.data : { successfulAccountIds: [], importedRows: 0, requestVersion: -1 };
}

/** User-requested retry preserves exact approval, prior receipts and one shared attempt budget. */
export async function retryFailedTaskAccounts(scope: AgentScope, taskId: string, expectedVersion: number) {
  const prepared = await agentTransaction(async tx => {
    const { task, run } = await requireTask(tx, scope, taskId);
    await assertProviderEnabled(tx, scope.workspaceId, task.provider);
    const recovery = recoveryFrom(task.result);
    if (task.state === "queued" && recovery.requestVersion === expectedVersion) return { task, replay: true as const };
    checkVersion(task.version, expectedVersion);
    if (task.state !== "needs_attention" || !task.importJobId || !["partial_import", "import_failed"].includes(task.reasonCode ?? "")) throw new AgentError("retry_unavailable", "This source does not have a finished failed import to retry");
    const job = await tx.warehouseImportJob.findFirst({ where: { workspaceId: scope.workspaceId, userId: scope.userId, id: task.importJobId } });
    if (!job || !["partial", "failed"].includes(job.status)) throw new AgentError("work_in_progress", "Wait for the current import to finish");
    if (job.retryCount >= job.maxRetries) throw new AgentError("retry_exhausted", "The retry limit was reached. Check source health, then choose accounts and dates again to approve a new import.");
    const confirmed = ConfirmedScopeSchema.parse(task.confirmedScope);
    await requireCurrentClientScope(tx, scope, run.clientId, confirmed);
    const receipts = (Array.isArray(job.results) ? job.results : []) as unknown as BatchImportJobResult[];
    const successful = [...new Set([...recovery.successfulAccountIds, ...scopeTargets(confirmed).filter(target => receipts.some(row => row.connectionId === target.connectionId && row.provider === task.provider && row.ok && (row.accountId ?? row.adAccountId) === target.accountId)).map(target => target.key)])].filter(id => confirmed.selectedAccountIds.includes(id));
    const failed = confirmed.selectedAccountIds.filter(id => !successful.includes(id));
    if (!failed.length) throw new AgentError("retry_unavailable", "No failed accounts remain; review source coverage instead");
    if (scopeTargets(confirmed).some(target => !task.connections.some(link => link.connectionId === target.connectionId))) throw new AgentError("connection_required", "Restore this source connection before retrying");
    return { task, job, confirmed, successful, failed, importedRows: recovery.importedRows + job.approximateRows, replay: false as const };
  });
  if (prepared.replay) return publicTask(prepared.task);
  const retryConnections = prepared.task.connections.filter(link => scopeTargets(prepared.confirmed).some(target => prepared.failed.includes(target.key) && target.connectionId === link.connectionId));
  const accounts = await discoverBoundAccounts(retryConnections);
  if (prepared.failed.some(id => !accounts.some(account => account.id === id))) throw new AgentError("reconnect_required", "A failed account is no longer authorized. Reconnect the source before importing again.");
  return agentTransaction(async tx => {
    const { task, run } = await requireTask(tx, scope, taskId);
    await assertProviderEnabled(tx, scope.workspaceId, task.provider);
    if (task.state === "queued" && recoveryFrom(task.result).requestVersion === expectedVersion) return publicTask(task);
    checkVersion(task.version, expectedVersion);
    if (task.importJobId !== prepared.job.id) throw new AgentError("stale_connection", "Import changed; refresh before retrying");
    assertConnectionsUnchanged(task.connections.filter(link => retryConnections.some(prior => prior.connectionId === link.connectionId)), retryConnections);
    await requireCurrentClientScope(tx, scope, run.clientId, prepared.confirmed);
    assertExecutableWarehouseRange({ provider: task.provider, since: prepared.confirmed.since, until: prepared.confirmed.until });
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: scope.workspaceId }, select: { plan: true } });
    const range = clampTimeRangeToPlanMaxDays(workspace.plan, prepared.confirmed);
    if (range.since !== prepared.confirmed.since || range.until !== prepared.confirmed.until) throw new AgentError("scope_changed", "Your plan changed. Choose accounts and dates again before importing.");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.workspaceId}), 8123)`;
    if (await tx.warehouseImportJob.count({ where: { workspaceId: scope.workspaceId, status: { in: ["queued", "running"] } } }) >= 5) throw new AgentError("concurrency_limit", "Wait for an active workspace import to finish", 429);
    const failedTargets = scopeTargets(prepared.confirmed).filter(target => prepared.failed.includes(target.key));
    for (const connectionId of new Set(failedTargets.map(target => target.connectionId))) {
      if (await tx.warehouseImportJob.findFirst({ where: { workspaceId: scope.workspaceId, status: { in: ["queued", "running"] }, items: { array_contains: [{ connectionId }] } } })) throw new AgentError("connection_busy", "This connection already has an active import");
    }
    const job = await createImportJob({ workspaceId: scope.workspaceId, userId: scope.userId, plan: workspace.plan, since: prepared.confirmed.since, until: prepared.confirmed.until, items: failedTargets.map(({ connectionId, accountId }) => ({ connectionId, accountId, ...(task.provider === "meta_ads" ? { adAccountId: accountId } : {}) })), idempotencyKey: `onboarding:${task.id}:${task.scopeRevision}:retry:${expectedVersion}`, client: tx });
    // Continue the same budget; the durable worker may consume the remaining attempts.
    await tx.warehouseImportJob.update({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: job.id } }, data: { retryCount: prepared.job.retryCount + 1, maxRetries: prepared.job.maxRetries } });
    const next = await tx.agentTask.update({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: taskId } }, data: { state: "queued", reasonCode: null, importJobId: job.id, result: { recovery: { successfulAccountIds: prepared.successful, importedRows: prepared.importedRows, requestVersion: expectedVersion } }, version: { increment: 1 } } });
    await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId: task.runId, taskId, type: "failed_accounts_retried", payload: { previousJobId: prepared.job.id, jobId: job.id, accountIds: prepared.failed, scopeRevision: task.scopeRevision } });
    return next;
  });
}

/** Explicit recovery opens a new approval, never silently retries a broader scope. */
export async function reopenTaskImportChoice(scope: AgentScope, taskId: string, expectedVersion: number) {
  const updated = await agentTransaction(async tx => {
    const { task } = await requireTask(tx, scope, taskId);
    await assertProviderEnabled(tx, scope.workspaceId, task.provider);
    checkVersion(task.version, expectedVersion);
    if (task.state !== "needs_attention" || !task.confirmedScope || !task.importJobId) throw new AgentError("invalid_transition", "Only a finished import needing attention can change scope");
    const job = await tx.warehouseImportJob.findFirst({ where: { workspaceId: scope.workspaceId, id: task.importJobId } });
    if (!job || !["completed", "partial", "failed"].includes(job.status)) throw new AgentError("work_in_progress", "Wait for the current import before changing its scope");
    const next = await tx.agentTask.update({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: taskId } }, data: { state: "discovering_accounts", confirmedScope: Prisma.DbNull, confirmedAt: null, confirmedByUserId: null, importJobId: null, result: Prisma.DbNull, version: { increment: 1 } } });
    await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId: task.runId, taskId, type: "scope_reopened", payload: { previousJobId: task.importJobId, previousScope: task.confirmedScope } });
    return next;
  });
  return discoverTaskAccounts(scope, taskId, updated.version);
}

export async function restoreDeferredImport(scope: AgentScope, taskId: string, expectedVersion: number) {
  return agentTransaction(async tx => {
    const { task } = await requireTask(tx, scope, taskId);
    checkVersion(task.version, expectedVersion);
    if (task.state !== "deferred" || !task.confirmedScope) throw new AgentError("invalid_transition", "This source has no deferred import to restore");
    const next = await tx.agentTask.update({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: taskId } }, data: { state: "needs_attention", reasonCode: "import_needs_review", version: { increment: 1 } } });
    await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId: task.runId, taskId, type: "deferred_import_restored", payload: {} });
    return next;
  });
}

function metricGrain(confirmed: z.infer<typeof ConfirmedScopeSchema>) {
  return confirmed.provider === "meta_ads" ? META_CANONICAL_METRIC_GRAIN : "campaign" as const;
}

function warehouseWhere(workspaceId: string, confirmed: z.infer<typeof ConfirmedScopeSchema>): Prisma.CampaignMetricWhereInput {
  const end = new Date(`${confirmed.until}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 1);
  return { workspaceId, OR: scopeTargets(confirmed).map(({ connectionId, accountId }) => ({ connectionId, accountId })), platform: confirmed.provider, level: metricGrain(confirmed), ...(confirmed.provider === "shopee" ? { breakdownHash: "day_orders", entityId: "shopee-orders-daily" } : { breakdownHash: "none" }), date: { gte: new Date(`${confirmed.since}T00:00:00Z`), lt: end } };
}

async function requireCurrentClientScope(tx: AgentTransaction, scope: AgentScope, clientId: string | null, confirmed: z.infer<typeof ConfirmedScopeSchema>) {
  if (!clientId) return;
  const count = await tx.clientProviderAccountAssignment.count({ where: { workspaceId: scope.workspaceId, clientId, provider: confirmed.provider, OR: scopeTargets(confirmed).map(({ connectionId, accountId }) => ({ connectionId, accountId })) } });
  if (count !== confirmed.selectedAccountIds.length) throw new AgentError("client_scope_changed", "Client account assignments changed. Review assignments in Sources before continuing.");
}

async function evidence(tx: AgentTransaction, workspaceId: string, confirmed: z.infer<typeof ConfirmedScopeSchema>) {
  const where = warehouseWhere(workspaceId, confirmed);
  const groups = await tx.campaignMetric.groupBy({ by: ["connectionId", "accountId", "currency"], where, _count: { _all: true }, _sum: { spend: true, conversions: true, revenue: true }, _max: { date: true } });
  const totalRows = groups.reduce((sum, row) => sum + row._count._all, 0);
  const totalSpend = groups.reduce((sum, row) => sum + (row._sum.spend ?? 0), 0);
  const totalConversions = groups.reduce((sum, row) => sum + (row._sum.conversions ?? 0), 0);
  const currencies = [...new Set(groups.map(r => r.currency).filter(Boolean))] as string[];
  const isMultiCurrency = currencies.length > 1;
  const hasUnknownCurrency = groups.some(row => !row.currency);
  const canSumSpend = currencies.length === 1 && !hasUnknownCurrency;

  const accounts = scopeTargets(confirmed).map(({ key, accountId, connectionId }) => {
    const accGroups = groups.filter(row => row.accountId === accountId && row.connectionId === connectionId);
    return {
      id: key, accountId, connectionId,
      groups: accGroups.map(row => ({
        currency: row.currency,
        rows: row._count._all,
        spend: row._sum.spend ?? 0,
        conversions: row._sum.conversions ?? 0,
        revenue: row._sum.revenue ?? 0,
        dataThroughDate: row._max.date?.toISOString().slice(0, 10) ?? null,
      })),
      totalRows: accGroups.reduce((sum, row) => sum + row._count._all, 0),
      totalSpend: new Set(accGroups.map(row => row.currency)).size === 1 && accGroups.every(row => row.currency) ? accGroups.reduce((sum, row) => sum + (row._sum.spend ?? 0), 0) : null,
      totalConversions: accGroups.reduce((sum, row) => sum + (row._sum.conversions ?? 0), 0),
    };
  });

  return {
    provider: confirmed.provider,
    rowsCount: totalRows,
    aggregates: {
      totalRows,
      totalSpend: confirmed.provider !== "shopee" && canSumSpend ? totalSpend : null,
      totalRevenue: confirmed.provider === "shopee" && canSumSpend ? groups.reduce((sum, row) => sum + (row._sum.revenue ?? 0), 0) : null,
      totalConversions,
      currency: canSumSpend ? currencies[0] : null,
      currencies,
      isMultiCurrency,
      grain: confirmed.provider === "shopee" ? "daily_orders" : metricGrain(confirmed),
    },
    coverage: {
      since: confirmed.since,
      until: confirmed.until,
      grain: confirmed.provider === "shopee" ? "daily_orders" : metricGrain(confirmed),
      limitations: [
        confirmed.provider === "shopee" ? "Order creation dates grouped by UTC day" : "Provider reporting dates; account timezone not verified",
        ...(confirmed.provider === "shopee" ? ["Order totals include all returned order statuses; they are not settled revenue", "Shopee Ads coverage is optional and is not included in order totals"] : []),
        ...(hasUnknownCurrency ? ["Some rows have unverified currency; monetary totals are shown only by currency group"] : []),
        ...(isMultiCurrency ? ["Multiple currencies detected in warehouse rows; aggregates are not blended"] : []),
      ],
    },
    accounts,
    window: { since: confirmed.since, until: confirmed.until },
    timezone: confirmed.provider === "shopee" ? "Order creation dates grouped by UTC day" : "Provider reporting dates; account timezone not verified",
        ...(confirmed.provider === "shopee" ? ["Order totals include all returned order statuses; they are not settled revenue", "Shopee Ads coverage is optional and is not included in order totals"] : []),
  };
}

export async function reconcileTaskImportOutcome(scope: AgentScope, taskId: string) {
  return agentTransaction(async tx => {
    const { task } = await requireTask(tx, scope, taskId, true);
    const recovering = task.state === "needs_attention" && ["lease_lost_or_stalled", "import_needs_review"].includes(task.reasonCode ?? "");
    if (!task.importJobId || (!recovering && !["queued", "importing", "verifying"].includes(task.state))) return publicTask(task);
    const job = await tx.warehouseImportJob.findFirst({ where: { id: task.importJobId, workspaceId: scope.workspaceId, userId: scope.userId } });
    if (!job) throw new AgentError("job_not_found", "Import job not found", 404);
    let state = task.state;
    if (job.status === "queued") return publicTask(task);
    if (state === "queued") {
      await tx.agentTask.update({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: taskId } }, data: { state: "importing", version: { increment: 1 } } });
      await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId: task.runId, taskId, type: "task_transitioned", payload: { from: state, to: "importing", jobId: job.id } });
      state = "importing";
    }

    const confirmed = ConfirmedScopeSchema.parse(task.confirmedScope);

    // Expired worker leases remain recoverable; detect lost/stalled leases when running lease expires
    if (job.status === "running") {
      const now = new Date();
      if (job.leaseExpiresAt && job.leaseExpiresAt < now) {
        const reason = "lease_lost_or_stalled";
        if (task.state === "needs_attention" && task.reasonCode === reason) return publicTask(task);
        const recovery = recoveryFrom(task.result);
        const updated = await tx.agentTask.update({
          where: { workspaceId_id: { workspaceId: scope.workspaceId, id: taskId } },
          data: {
            state: "needs_attention",
            reasonCode: reason,
            result: {
              ...(recovery.requestVersion >= 0 ? { recovery } : {}),
              jobStatus: job.status,
              leaseExpiredAt: job.leaseExpiresAt.toISOString(),
              verified: false,
            },
            version: { increment: 1 },
          },
        });
        await appendAgentEvent(tx, {
          workspaceId: scope.workspaceId,
          runId: task.runId,
          taskId,
          type: "import_needs_attention",
          payload: { reasonCode: reason, jobId: job.id },
        });
        return updated;
      }
      return tx.agentTask.findUniqueOrThrow({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: taskId } } });
    }
    const results = (Array.isArray(job.results) ? job.results : []) as unknown as BatchImportJobResult[];
    const recovery = recoveryFrom(task.result);
    const verified = job.status === "completed" && scopeTargets(confirmed).every(target => recovery.successfulAccountIds.includes(target.key) || results.some(row => row.provider === task.provider && row.connectionId === target.connectionId && (row.accountId ?? row.adAccountId) === target.accountId && row.ok)) && job.approximateRows + recovery.importedRows > 0;
    const actual = await evidence(tx, scope.workspaceId, confirmed);
    if (verified) {
      await tx.agentTask.update({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: taskId } }, data: { state: "verifying", version: { increment: 1 } } });
      await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId: task.runId, taskId, type: "task_transitioned", payload: { from: state, to: "verifying" } });
    }
    const ready = verified && actual.rowsCount > 0;
    const reason = ready ? null : job.status === "partial" ? "partial_import" : job.status === "failed" ? "import_failed" : "no_data_found";
    const updated = await tx.agentTask.update({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: taskId } }, data: { state: ready ? "ready" : "needs_attention", reasonCode: reason, result: { ...actual, ...(recovery.requestVersion >= 0 ? { recovery } : {}), jobStatus: job.status, retryRemaining: Math.max(0, job.maxRetries - job.retryCount), completedItems: job.completedItems, totalItems: job.totalItems, verified: ready }, version: { increment: 1 } } });
    await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId: task.runId, taskId, type: ready ? "task_verified_ready" : "import_needs_attention", payload: { reasonCode: reason, rowsCount: actual.rowsCount } });
    return updated;
  });
}

export async function reconcileRunImports(scope: AgentScope, runId: string) {
  const ids = await agentTransaction(async tx => {
    const run = await requireAgentRun(tx, scope, runId, false);
    if (run.status === "completed" || run.status === "paused") return [];
    return tx.agentTask.findMany({ where: { workspaceId: scope.workspaceId, runId, importJobId: { not: null }, OR: [{ state: { in: ["queued", "importing", "verifying"] } }, { state: "needs_attention", reasonCode: { in: ["lease_lost_or_stalled", "import_needs_review"] } }] }, select: { id: true } });
  });
  for (const task of ids) await reconcileTaskImportOutcome(scope, task.id);
}

export async function getTaskDataPreview(scope: AgentScope, taskId: string) {
  return agentTransaction(async tx => {
    const { task, run } = await requireTask(tx, scope, taskId, false);
    if (!task.confirmedScope) throw new AgentError("scope_required", "Confirm an import before reviewing results");
    const confirmed = ConfirmedScopeSchema.parse(task.confirmedScope);
    await requireCurrentClientScope(tx, scope, run.clientId, confirmed);
    const actual = await evidence(tx, scope.workspaceId, confirmed);
    const rows = await tx.campaignMetric.findMany({ where: warehouseWhere(scope.workspaceId, confirmed), orderBy: [{ date: "desc" }, { id: "asc" }], take: 10, select: { date: true, accountId: true, campaignName: true, spend: true, conversions: true, revenue: true, currency: true } });
    return { ...actual, sampleRows: rows.map(row => ({ ...row, date: row.date.toISOString().slice(0, 10) })), verified: task.state === "ready", omissions: task.reasonCode };
  });
}

export async function finishOnboardingRun(scope: AgentScope, runId: string, expectedVersion: number) {
  VersionSchema.parse(expectedVersion);
  return agentTransaction(async tx => {
    const run = await requireAgentRun(tx, scope, runId, true);
    if (run.status === "completed") return run;
    assertRunWritable(run.status); checkVersion(run.version, expectedVersion);
    const tasks = await tx.agentTask.findMany({ where: { workspaceId: scope.workspaceId, runId } });
    if (!tasks.some(task => task.state === "ready") || tasks.some(task => !["ready", "deferred"].includes(task.state))) throw new AgentError("review_not_ready", "Review usable data and save every unfinished source for later before finishing");
    for (const task of tasks.filter(task => task.state === "ready")) {
      const confirmed = ConfirmedScopeSchema.parse(task.confirmedScope);
      await requireCurrentClientScope(tx, scope, run.clientId, confirmed);
      const actual = await evidence(tx, scope.workspaceId, confirmed);
      if (!actual.rowsCount) throw new AgentError("evidence_missing", "Imported data is no longer available; refresh the review");
    }
    try { await recordDashboardReviewMilestone({ workspaceId: scope.workspaceId, actorUserId: scope.userId, client: tx }); }
    catch (error) {
      if (error instanceof PilotActivationConflictError) throw new AgentError("recent_data_required", "Recent KPI rows are required before finishing. Continue to the console to inspect source coverage.");
      throw error;
    }
    await tx.agentRun.update({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: runId } }, data: { status: "completed", reviewedAt: new Date() } });
    await appendAgentEvent(tx, { workspaceId: scope.workspaceId, runId, type: "run_completed", payload: { deferredProviders: tasks.filter(task => task.state === "deferred").map(task => task.provider) } });
    return tx.agentRun.findUniqueOrThrow({ where: { workspaceId_id: { workspaceId: scope.workspaceId, id: runId } } });
  });
}
