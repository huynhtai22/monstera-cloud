import prisma from "@/lib/prisma";
import { clampTimeRangeToPlanMaxDays } from "@/lib/plan-config";
import { Prisma } from "@prisma/client";
import {
  agentConsoleTransaction,
  enqueueOperation,
  resolveCase,
  appendConsoleEvent,
  requireWorkspaceRole,
  AgentConsoleError,
  type ConsoleTransaction,
  reconcileLostOperationLeases,
  updateOperationWithFencedLease,
} from "./persistence";
import { createImportJob } from "@/lib/warehouse-import-job";
import { evaluateProviderCapability } from "./capabilities";
import { resolveSourceHealthState, SOURCE_HEALTH_STALE_AFTER_MS } from "@/lib/source-health";

// Recovery retries are bounded even on plans with unlimited history. Larger
// reimports use the existing explicitly approved historical-import workflow.
function boundedRecoveryRange(plan: string, since: string, until: string) {
  for (const date of [since, until]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(new Date(date).getTime()) || new Date(date).toISOString().slice(0, 10) !== date) {
      throw new AgentConsoleError("invalid_recovery_range", "Recovery dates must be valid calendar dates", 400);
    }
  }
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (since > until || until > yesterday) {
    throw new AgentConsoleError("invalid_recovery_range", "Recovery range must be ordered and end by yesterday", 400);
  }
  const earliest = new Date(new Date(until).getTime() - 14 * 86400000).toISOString().slice(0, 10);
  return clampTimeRangeToPlanMaxDays(plan, { since: since < earliest ? earliest : since, until });
}

export interface PrepareRecoveryInput {
  workspaceId: string;
  caseId: string;
  userId: string;
  mode?: "retry_failed_window" | "full_window_reimport";
  since?: string;
  until?: string;
}

export interface PreparedRecoveryOutcome {
  actionType: "reconnect" | "approval_required" | "queued";
  requiresReconnect: boolean;
  operation?: Record<string, unknown>;
  approval?: Record<string, unknown>;
  reconnectProvider?: string;
  reconnectConnectionId?: string;
  reason?: string;
}

/**
 * Prepares or executes a bounded recovery import for an active case.
 * - Revalidates current policy, membership, role, scope and target connection.
 * - If connection status is disconnected or token expired: marks requiresReconnect = true, asks customer to reconnect.
 * - Otherwise enqueues submit_recovery_import operation.
 */
export async function prepareCaseRecovery(
  input: PrepareRecoveryInput,
  client?: any
): Promise<PreparedRecoveryOutcome> {
  const runner = client ?? prisma;

  return agentConsoleTransaction(async (tx: ConsoleTransaction) => {
    // 0. Revalidate acting user role (must be owner, admin, or member with recovery permissions)
    await requireWorkspaceRole(tx, input.workspaceId, input.userId, ["owner", "admin", "member"]);

    // 1. Fetch case and responsibility
    const caseRecord = await tx.agentCase.findFirst({
      where: { id: input.caseId, workspaceId: input.workspaceId },
      include: {
        responsibility: {
          include: {
            scopes: { where: { scopeRevision: { gt: 0 } } },
          },
        },
      },
    });

    if (!caseRecord) {
      throw new AgentConsoleError("case_not_found", "Case not found", 404);
    }

    if (caseRecord.state === "resolved") {
      throw new AgentConsoleError("case_already_resolved", "Case is already resolved", 400);
    }

    const resp = caseRecord.responsibility;
    if (!resp) {
      throw new AgentConsoleError("responsibility_not_found", "Case has no associated responsibility", 400);
    }

    if (resp.status !== "active") {
      throw new AgentConsoleError("responsibility_not_active", `Responsibility is ${resp.status}`, 400);
    }

    // 2. Load active authorization
    const activeAuth = await tx.agentAuthorization.findFirst({
      where: {
        workspaceId: input.workspaceId,
        responsibilityId: resp.id,
        policyRevision: resp.policyRevision,
        revokedAt: null,
      },
    });

    if (!activeAuth || (activeAuth.expiresAt && activeAuth.expiresAt < new Date())) {
      throw new AgentConsoleError("authorization_required", "Active authorization policy required for recovery", 403);
    }

    // Check authorizer's current role
    if (activeAuth.authorizingUserId) {
      await requireWorkspaceRole(tx, input.workspaceId, activeAuth.authorizingUserId, ["owner", "admin"]);
    }

    // Check tool allowlist
    if (!activeAuth.allowlistedTools.includes("submit_recovery_import")) {
      throw new AgentConsoleError("tool_not_allowlisted", "Tool 'submit_recovery_import' is not permitted by active authorization policy", 403);
    }

    // Check permitted recovery mode from authorization limits - FAIL CLOSED: no default fallback
    const limits = (activeAuth.limits as Record<string, unknown> | null) ?? {};
    const permittedModes = (limits.permittedRecoveryModes as string[]) || [];
    if (permittedModes.length === 0) {
      throw new AgentConsoleError("recovery_mode_not_permitted", "No recovery modes are permitted by active policy", 403);
    }

    const requestedMode = input.mode ?? "retry_failed_window";
    if (!permittedModes.includes(requestedMode)) {
      throw new AgentConsoleError("recovery_mode_not_permitted", `Recovery mode '${requestedMode}' is not permitted by active policy limits`, 403);
    }

    // 3. Find target connection
    const currentScopes = resp.scopes.filter((s) => s.scopeRevision === resp.scopeRevision);
    if (currentScopes.length === 0) {
      throw new AgentConsoleError("empty_scope", "Responsibility has no scope items", 400);
    }

    // Resolve target scope from case fingerprint if available (e.g. "fp:source_health:conn_id:account_id")
    let targetScope = currentScopes[0];
    if (caseRecord.fingerprint && caseRecord.fingerprint.startsWith("fp:source_health:")) {
      const parts = caseRecord.fingerprint.split(":");
      const connIdFromFp = parts[2];
      const matched = currentScopes.find((s) => s.connectionId === connIdFromFp);
      if (matched) {
        targetScope = matched;
      }
    }

    const conn = await tx.connection.findFirst({
      where: { id: targetScope.connectionId, workspaceId: input.workspaceId },
    });

    if (!conn) {
      return {
        actionType: "reconnect",
        requiresReconnect: true,
        reconnectProvider: targetScope.provider,
        reconnectConnectionId: targetScope.connectionId,
        reason: "Connection missing from workspace",
      };
    }

    const isTokenExpired =
      conn.status === "disconnected" ||
      /token.*expired|invalid.*token|reauth|grant_type|unauthorized/i.test(conn.lastError ?? "");

    if (isTokenExpired) {
      return {
        actionType: "reconnect",
        requiresReconnect: true,
        reconnectProvider: conn.provider,
        reconnectConnectionId: conn.id,
        reason: "Credentials expired. Reconnect the source before recovering.",
      };
    }

    // 4. Recovery range
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const defaultUntil = yesterday.toISOString().slice(0, 10);
    const sevenDaysPrior = new Date(yesterday.getTime() - 6 * 86400000);
    const defaultSince = sevenDaysPrior.toISOString().slice(0, 10);

    const rawSince = input.since ?? defaultSince;
    const rawUntil = input.until ?? defaultUntil;
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: input.workspaceId }, select: { plan: true } });
    const { since, until } = boundedRecoveryRange(workspace.plan, rawSince, rawUntil);

    // Accounts for this target connection ONLY (never combine unrelated account IDs under one connection)
    const targetAccountIds = currentScopes
      .filter((s) => s.connectionId === conn.id)
      .map((s) => s.providerAccountId);

    if (targetAccountIds.length === 0) {
      throw new AgentConsoleError("empty_scope", "No accounts configured for target connection", 400);
    }

    // Enqueue submit_recovery_import operation
    const operationKey = `recov_${caseRecord.id}_v${caseRecord.version}`;
    const opResult = await enqueueOperation(tx, {
      workspaceId: input.workspaceId,
      caseId: caseRecord.id,
      evaluationId: caseRecord.evaluationId,
      operationKey,
      toolName: "submit_recovery_import",
      arguments: {
        workspaceId: input.workspaceId,
        responsibilityId: resp.id,
        caseId: caseRecord.id,
        mode: requestedMode,
        provider: conn.provider,
        connectionId: conn.id,
        accountIds: targetAccountIds,
        since,
        until,
        idempotencyKey: `recov_job_${caseRecord.id}_v${caseRecord.version}`,
      },
      scopeHash: resp.scopeHash ?? activeAuth.scopeHash,
      policyRevision: resp.policyRevision,
    });

    return {
      actionType: "queued",
      requiresReconnect: false,
      operation: opResult.operation as unknown as Record<string, unknown>,
    };
  }, runner);
}

export interface ExecuteRecoveryJobInput {
  workspaceId: string;
  operationId: string;
  userId: string;
  workerId?: string;
}

export async function heartbeatRecoveryOperationLease(workspaceId: string, jobId: string, workerId: string) {
  return agentConsoleTransaction(async (tx: ConsoleTransaction) => {
    const now = new Date();
    const op = await tx.agentOperation.findFirst({
      where: { workspaceId, jobReference: jobId, toolName: "submit_recovery_import" },
      include: { case: { include: { responsibility: true } } },
    });
    if (!op) return true;
    const job = await tx.warehouseImportJob.findFirst({
      where: { id: jobId, workspaceId, status: "running", leaseId: workerId, leaseExpiresAt: { gt: now } },
    });
    if (!job) return false;
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { plan: true } });
    try {
      const permittedRange = boundedRecoveryRange(workspace.plan, job.since, job.until);
      const args = op.arguments as { since?: string; until?: string };
      if (permittedRange.since !== job.since || permittedRange.until !== job.until || args.since !== job.since || args.until !== job.until) return false;
    } catch (error) {
      if (error instanceof AgentConsoleError) return false;
      throw error;
    }
    const resp = op.case?.responsibility;
    if (!resp || resp.status !== "active" || resp.scopeHash !== op.scopeHash || resp.policyRevision !== op.policyRevision) return false;
    const auth = await tx.agentAuthorization.findFirst({
      where: { workspaceId, responsibilityId: resp.id, revokedAt: null, scopeHash: op.scopeHash, policyRevision: op.policyRevision, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    });
    if (!auth || !auth.allowlistedTools.includes("submit_recovery_import")) return false;
    const updated = await tx.agentOperation.updateMany({
      where: { workspaceId, id: op.id, version: op.version, OR: [
        { state: "queued" },
        { state: "running", leaseOwner: workerId, leaseExpiresAt: { gt: now } },
        { state: "running", leaseExpiresAt: { lte: now } },
      ] },
      data: { state: "running", leaseOwner: workerId, leaseExpiresAt: new Date(now.getTime() + 60_000), version: { increment: 1 } },
    });
    return updated.count === 1;
  });
}

/**
 * Dispatches an approved or queued recovery import using the durable warehouse import worker.
 * Supports worker lease claiming, fence verification, and crash recovery without duplicate job dispatch.
 */
export async function executeRecoveryImportOperation(
  input: ExecuteRecoveryJobInput,
  client?: any
): Promise<{ jobId: string; status: string; outcome: "queued" | "already_active" }> {
  const runner = client ?? prisma;
  const assignedWorkerId = input.workerId ?? "worker-recovery";

  return agentConsoleTransaction(async (tx: ConsoleTransaction) => {
    await reconcileLostOperationLeases(tx, { workspaceId: input.workspaceId, now: new Date() });
    const op = await tx.agentOperation.findFirst({
      where: { id: input.operationId, workspaceId: input.workspaceId },
      include: {
        case: {
          include: {
            responsibility: {
              include: { scopes: true },
            },
          },
        },
      },
    });

    if (!op) {
      throw new AgentConsoleError("operation_not_found", "Operation not found", 404);
    }

    if (op.toolName !== "submit_recovery_import") {
      throw new AgentConsoleError("invalid_tool", `Cannot execute recovery for tool ${op.toolName}`, 400);
    }

    const now = new Date();
    // A live lease is exclusive, including repeated dispatches from the same worker.
    if (op.state === "running" && op.leaseExpiresAt && op.leaseExpiresAt > now) {
      throw new AgentConsoleError(
        "lease_active_conflict",
        `Operation is currently running under active lease by '${op.leaseOwner}'`,
        409
      );
    }

    if (op.state !== "queued") {
      throw new AgentConsoleError("invalid_operation_state", `Operation state must be 'queued' to dispatch, got '${op.state}'`, 400);
    }

    // 1. Revalidate acting user role (must be owner or admin to dispatch autonomous recovery)
    await requireWorkspaceRole(tx, input.workspaceId, input.userId, ["owner", "admin"]);

    // 2. Revalidate responsibility state
    const resp = op.case?.responsibility;
    if (!resp) {
      throw new AgentConsoleError("responsibility_not_found", "Operation case has no associated responsibility", 400);
    }
    if (resp.status !== "active") {
      throw new AgentConsoleError("responsibility_not_active", `Responsibility is ${resp.status}`, 400);
    }

    // 3. Revalidate scope revision and scope hash
    if (op.scopeHash && resp.scopeHash && op.scopeHash !== resp.scopeHash) {
      throw new AgentConsoleError("scope_revision_changed", "Responsibility scope changed after operation preparation", 409);
    }

    // 4. Revalidate authorization policy
    const activeAuth = await tx.agentAuthorization.findFirst({
      where: {
        workspaceId: input.workspaceId,
        responsibilityId: resp.id,
        policyRevision: resp.policyRevision,
        revokedAt: null,
      },
    });

    if (!activeAuth || (activeAuth.expiresAt && activeAuth.expiresAt < new Date())) {
      throw new AgentConsoleError("authorization_required", "Active authorization policy required to dispatch recovery", 403);
    }

    // Revalidate authorizer's current role
    if (activeAuth.authorizingUserId) {
      await requireWorkspaceRole(tx, input.workspaceId, activeAuth.authorizingUserId, ["owner", "admin"]);
    }

    // Tool allowlist check
    if (!activeAuth.allowlistedTools.includes("submit_recovery_import")) {
      throw new AgentConsoleError("tool_not_allowlisted", "Tool 'submit_recovery_import' is not permitted by active authorization policy", 403);
    }

    // Permitted recovery modes check from authorization limits - FAIL CLOSED
    const limits = (activeAuth.limits as Record<string, unknown> | null) ?? {};
    const permittedModes = (limits.permittedRecoveryModes as string[]) || [];
    if (permittedModes.length === 0) {
      throw new AgentConsoleError("recovery_mode_not_permitted", "No recovery modes are permitted by active policy", 403);
    }

    const args = op.arguments as Record<string, unknown>;
    const requestedMode = (args.mode as string | undefined) ?? "retry_failed_window";
    if (!permittedModes.includes(requestedMode)) {
      throw new AgentConsoleError("recovery_mode_not_permitted", `Recovery mode '${requestedMode}' is not permitted by active policy limits`, 403);
    }

    const connectionId = args.connectionId as string;
    const accountIds = (args.accountIds as string[]) || [];
    const since = args.since as string;
    const until = args.until as string;
    const idempotencyKey = args.idempotencyKey as string;

    // Verify target accounts strictly belong to the target connection in the responsibility's active scope
    const validScopedAccounts = new Set(
      resp.scopes
        .filter((s) => s.connectionId === connectionId && s.scopeRevision === resp.scopeRevision)
        .map((s) => s.providerAccountId)
    );
    for (const accId of accountIds) {
      if (!validScopedAccounts.has(accId)) {
        throw new AgentConsoleError("target_not_authorized", `Account ${accId} is not in confirmed scope for connection ${connectionId}`, 400);
      }
    }

    // Verify allowedPairs in active authorization policy
    const allowedPairs = (activeAuth.allowedPairs as Array<{
      provider: string;
      connectionId: string;
      providerAccountId: string;
    }>) || [];
    for (const accId of accountIds) {
      const isPairAllowed = allowedPairs.some(
        (p) => p.connectionId === connectionId && p.providerAccountId === accId
      );
      if (!isPairAllowed) {
        throw new AgentConsoleError("target_not_authorized", `Connection/account pair ${connectionId}/${accId} is not in active authorization allowedPairs`, 403);
      }
    }

    // Verify target connection exists in workspace
    const targetConn = await tx.connection.findFirst({
      where: { id: connectionId, workspaceId: input.workspaceId },
    });
    if (!targetConn) {
      throw new AgentConsoleError("connection_not_found", `Target connection ${connectionId} not found in workspace`, 404);
    }

    // Recheck provider capability: live_production only when in production and not in isolated test
    const isLiveProduction =
      process.env.NODE_ENV === "production" &&
      process.env.MONSTERA_E2E_ISOLATED !== "1" &&
      process.env.CLIENT_ASSIGNMENT_TEST_DB !== "1";

    const capEval = evaluateProviderCapability(targetConn.provider, "submit_recovery_import", {
      executionMode: isLiveProduction ? "live_production" : "local_test",
    });
    if (!capEval.allowed) {
      throw new AgentConsoleError("provider_capability_blocked", capEval.reason || "Provider capability check failed", 403);
    }

    // Crash recovery check: if job was already created (op.jobReference or matching idempotencyKey), reuse without duplicating side effect
    let job: { id: string; status: string } | null = null;
    if (op.jobReference) {
      const existingJob = await tx.warehouseImportJob.findFirst({
        where: { id: op.jobReference, workspaceId: input.workspaceId },
      });
      if (existingJob) {
        job = { id: existingJob.id, status: existingJob.status };
      }
    }

    if (!job && idempotencyKey) {
      const existingJobByKey = await tx.warehouseImportJob.findFirst({
        where: { workspaceId: input.workspaceId, idempotencyKey },
      });
      if (existingJobByKey) {
        job = { id: existingJobByKey.id, status: existingJobByKey.status };
      }
    }


    if (!job) {
      const workspace = await tx.workspace.findUniqueOrThrow({
        where: { id: input.workspaceId },
        select: { plan: true },
      });

      const permittedRange = boundedRecoveryRange(workspace.plan, since, until);
      if (permittedRange.since !== since || permittedRange.until !== until) {
        throw new AgentConsoleError("recovery_range_superseded", "Recovery window exceeds current limits; prepare recovery again", 409);
      }
      job = await createImportJob({
        workspaceId: input.workspaceId,
        userId: input.userId,
        plan: workspace.plan,
        since,
        until,
        items: accountIds.map((accountId) => ({
          connectionId,
          accountId,
        })),
        idempotencyKey,
        client: tx,
      });
    }

    if (op.jobReference === job.id) {
      return { jobId: job.id, status: job.status, outcome: "already_active" };
    }

    // Bind the job once; the warehouse worker acquires the execution lease.
    const claimed = await tx.agentOperation.updateMany({
      where: { id: op.id, workspaceId: input.workspaceId, state: "queued", version: op.version },
      data: { jobReference: job.id, leaseOwner: null, leaseExpiresAt: null, version: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      throw new AgentConsoleError("lease_active_conflict", "Recovery operation was claimed by another worker", 409);
    }

    await appendConsoleEvent(tx, {
      workspaceId: input.workspaceId,
      caseId: op.caseId ?? undefined,
      operationId: op.id,
      actorType: "user",
      actorUserId: input.userId,
      type: "recovery_job_dispatched",
      payload: { jobId: job.id, connectionId, workerId: assignedWorkerId },
    });

    return {
      jobId: job.id,
      status: job.status,
      outcome: "queued",
    };
  }, runner);
}

export interface TargetHealthVerificationInput {
  workspaceId: string;
  connectionId: string;
  accountIds: string[];
  expectedSince?: string;
  expectedUntil?: string;
  jobId?: string;
  boundOperation?: any;
}

export interface TargetHealthVerificationResult {
  verified: boolean;
  status: "verified" | "unresolved" | "partial";
  reasons: string[];
  lastDataThrough?: Date | null;
  metricRowCount?: number;
}

/**
 * Shared resolution verifier for both recovery imports and scheduled checks.
 * Requires:
 * 1. Bound job completion and per-account success (if jobId provided).
 * 2. Canonical target connection status === "connected" with no fatal error.
 * 3. Connection lastDataThrough covering requested/expected until date.
 * 4. Actual warehouse coverage (CampaignMetric rows) or verified zero-activity receipts for target accounts.
 */
export async function verifyTargetDataHealthAndCoverage(
  tx: ConsoleTransaction,
  input: TargetHealthVerificationInput
): Promise<TargetHealthVerificationResult> {
  const reasons: string[] = [];

  // 1. If a job is bound, verify job outcome and per-account success
  if (input.jobId) {
    const job = await tx.warehouseImportJob.findFirst({
      where: { id: input.jobId, workspaceId: input.workspaceId },
    });

    if (!job) {
      reasons.push(`Job ${input.jobId} not found in workspace`);
      return { verified: false, status: "unresolved", reasons };
    }

    if (job.status !== "completed") {
      reasons.push(`Import job status is '${job.status}', not completed`);
      return {
        verified: false,
        status: job.status === "partial" ? "partial" : "unresolved",
        reasons,
      };
    }

    // Check window coverage against operation if provided
    if (input.boundOperation) {
      const opArgs = (input.boundOperation.arguments ?? {}) as Record<string, unknown>;
      const expectedSince = opArgs.since as string | undefined;
      const expectedUntil = opArgs.until as string | undefined;

      if (expectedSince && job.since > expectedSince) {
        reasons.push(`Job since window (${job.since}) does not cover requested since window (${expectedSince})`);
        return { verified: false, status: "unresolved", reasons };
      }
      if (expectedUntil && job.until < expectedUntil) {
        reasons.push(`Job until window (${job.until}) does not cover requested until window (${expectedUntil})`);
        return { verified: false, status: "unresolved", reasons };
      }
    }

    const results = (Array.isArray(job.results) ? job.results : []) as Array<{
      connectionId?: string;
      accountId?: string;
      ok?: boolean;
      outcome?: string;
      executionSince?: string;
      executionUntil?: string;
    }>;

    if (results.length === 0) {
      reasons.push("Import job results are empty; no data processed");
      return { verified: false, status: "unresolved", reasons };
    }

    const expectedConnectionId = input.connectionId;
    const expectedSince = input.expectedSince ?? (input.boundOperation?.arguments as Record<string, unknown> | undefined)?.since as string | undefined;
    const expectedUntil = input.expectedUntil ?? (input.boundOperation?.arguments as Record<string, unknown> | undefined)?.until as string | undefined;
    const validResults = results.filter((r) => r.ok === true && (r.outcome === "success" || !r.outcome));
    const hasExactReceiptFor = (accountId: string) => validResults.some((r) =>
      r.connectionId === expectedConnectionId && r.accountId === accountId &&
      (!expectedSince || (r.executionSince ?? job.since) <= expectedSince) &&
      (!expectedUntil || (r.executionUntil ?? job.until) >= expectedUntil));
    const missingOrFailedAccounts = input.accountIds.filter((acc) => !hasExactReceiptFor(acc));
    if (missingOrFailedAccounts.length > 0) {
      reasons.push(`Target accounts missing or failed in import results: ${missingOrFailedAccounts.join(", ")}`);
      return {
        verified: false,
        status: "partial",
        reasons,
      };
    }
  }

  // 2. Canonical connection health check
  const targetConn = await tx.connection.findFirst({
    where: { id: input.connectionId, workspaceId: input.workspaceId },
  });

  const health = targetConn && resolveSourceHealthState({
    connectionStatus: targetConn.status,
    lastError: targetConn.lastError,
    lastSyncAt: targetConn.lastSyncAt,
    staleBefore: new Date(Date.now() - SOURCE_HEALTH_STALE_AFTER_MS),
  });
  if (!targetConn || health !== "fresh") {
    reasons.push(`Target connection health is '${health ?? "missing"}', expected 'fresh'`);
    return { verified: false, status: "unresolved", reasons };
  }

  // 3. Data-through coverage check
  if (input.expectedUntil) {
    if (!targetConn.lastDataThrough) {
      reasons.push(`Connection has no lastDataThrough recorded; coverage unproven for ${input.expectedUntil}`);
      return { verified: false, status: "unresolved", reasons };
    }
    const untilDate = new Date(input.expectedUntil);
    if (targetConn.lastDataThrough < untilDate) {
      reasons.push(`Connection lastDataThrough (${targetConn.lastDataThrough.toISOString().slice(0, 10)}) is behind required until (${input.expectedUntil})`);
      return { verified: false, status: "unresolved", reasons };
    }
  }

  // 4. Actual warehouse coverage check (CampaignMetric rows or verified zero-activity receipts for every required account-day)
  const windowSince = input.expectedSince ?? input.expectedUntil;
  const windowUntil = input.expectedUntil ?? input.expectedSince;

  if (windowSince && windowUntil) {
    // Generate all calendar day strings (YYYY-MM-DD) in the required range
    const calendarDays: string[] = [];
    const curr = new Date(windowSince + "T00:00:00Z");
    const end = new Date(windowUntil + "T00:00:00Z");
    while (curr <= end) {
      calendarDays.push(curr.toISOString().slice(0, 10));
      curr.setUTCDate(curr.getUTCDate() + 1);
    }

    const minDate = new Date(windowSince + "T00:00:00Z");
    const maxDate = new Date(windowUntil + "T23:59:59.999Z");

    const metricRows = await tx.campaignMetric.findMany({
      where: {
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        accountId: { in: input.accountIds },
        date: {
          gte: minDate,
          lte: maxDate,
        },
      },
      select: {
        accountId: true,
        date: true,
      },
    });

    const coveredAccountDays = new Set<string>();
    for (const row of metricRows) {
      const dStr = row.date.toISOString().slice(0, 10);
      coveredAccountDays.add(`${row.accountId}:${dStr}`);
    }

    // Load unexpired snapshots with zeroActivityReceipts to validate any remaining gaps
    const zeroEvidenceSnapshots = await tx.agentEvidenceSnapshot.findMany({
      where: {
        workspaceId: input.workspaceId,
        isExpired: false,
        provenance: {
          path: ["zeroActivityReceipts"],
          not: Prisma.JsonNull,
        },
      },
      select: { provenance: true, actualSince: true, actualUntil: true },
    });

    const validZeroReceipts = new Set<string>();
    for (const snap of zeroEvidenceSnapshots) {
      const prov = snap.provenance as Record<string, unknown> | null;
      const receipts = Array.isArray(prov?.zeroActivityReceipts)
        ? (prov?.zeroActivityReceipts as Array<{
            canonicalAccountId?: string;
            accountId?: string;
            connectionId?: string;
            provider?: string;
            date?: string;
            verifiedAt?: string;
            origin?: string;
          }>)
        : [];

      for (const r of receipts) {
        if (!r.date || !r.accountId || !r.connectionId || !r.provider || !r.origin || !r.verifiedAt || !r.canonicalAccountId) continue;
        if (r.provider !== targetConn.provider || r.connectionId !== input.connectionId) continue;
        if (r.origin !== "verified" && r.origin !== "api_fetch") continue;
        const verifiedAt = new Date(r.verifiedAt);
        if (!Number.isFinite(verifiedAt.getTime()) || verifiedAt.getTime() > Date.now() + 60_000) continue;
        if (r.canonicalAccountId !== `${r.provider}:${r.connectionId}:${r.accountId}`) continue;
        if (!input.accountIds.includes(r.accountId)) continue;
        if (snap.actualSince > new Date(`${r.date}T00:00:00.000Z`) || snap.actualUntil < new Date(`${r.date}T00:00:00.000Z`)) continue;
        validZeroReceipts.add(`${r.accountId}:${r.date}`);
      }
    }

    const missingDays: string[] = [];
    for (const accId of input.accountIds) {
      for (const day of calendarDays) {
        const key = `${accId}:${day}`;
        if (!coveredAccountDays.has(key) && !validZeroReceipts.has(key)) {
          missingDays.push(key);
        }
      }
    }

    if (missingDays.length > 0) {
      reasons.push(
        `Missing warehouse coverage or verified zero-activity receipt for account-day(s): ${missingDays.slice(0, 5).join(", ")}${missingDays.length > 5 ? ` (+${missingDays.length - 5} more)` : ""}`
      );
      return {
        verified: false,
        status: "unresolved",
        reasons,
        metricRowCount: metricRows.length,
      };
    }

    return {
      verified: true,
      status: "verified",
      reasons: ["Complete coverage and health confirmed"],
      lastDataThrough: targetConn.lastDataThrough,
      metricRowCount: metricRows.length,
    };
  } else {
    reasons.push("Required coverage window is missing; verification cannot establish account-day completeness");
    return { verified: false, status: "unresolved", reasons };
  }
}

export interface VerifyRecoveryInput {
  workspaceId: string;
  caseId: string;
  jobId: string;
}

export interface VerifyRecoveryOutcome {
  verified: boolean;
  status: "verified" | "unresolved" | "partial";
  caseClosed: boolean;
  reasons: string[];
}

/**
 * Authoritatively verifies actual restored health and coverage after a recovery import.
 * - Uses shared verifyTargetDataHealthAndCoverage contract.
 * - Closes case only if complete coverage is verified.
 */
export async function verifyRecoveryAndCloseCase(
  input: VerifyRecoveryInput,
  client?: any
): Promise<VerifyRecoveryOutcome> {
  const runner = client ?? prisma;

  return agentConsoleTransaction(async (tx: ConsoleTransaction) => {
    const caseRecord = await tx.agentCase.findFirst({
      where: { id: input.caseId, workspaceId: input.workspaceId },
      include: {
        responsibility: {
          include: { scopes: true },
        },
      },
    });

    if (!caseRecord) {
      throw new AgentConsoleError("case_not_found", "Case not found", 404);
    }

    // Check job exists in workspace
    const job = await tx.warehouseImportJob.findFirst({
      where: { id: input.jobId, workspaceId: input.workspaceId },
    });
    if (!job) {
      throw new AgentConsoleError("job_not_found", "Recovery job not found", 404);
    }

    // 1. Authoritative resolution binding: find operation bound to this job and case
    const boundOp = await tx.agentOperation.findFirst({
      where: {
        workspaceId: input.workspaceId,
        caseId: caseRecord.id,
        jobReference: input.jobId,
      },
    });

    if (!boundOp) {
      return {
        verified: false,
        status: "unresolved",
        caseClosed: false,
        reasons: [`Job ${input.jobId} is not bound to an operation for case ${caseRecord.id}`],
      };
    }

    const opArgs = (boundOp.arguments ?? {}) as Record<string, unknown>;
    const expectedConnectionId = opArgs.connectionId as string;
    const expectedAccountIds = (opArgs.accountIds as string[]) || [];
    const expectedSince = opArgs.since as string | undefined;
    const expectedUntil = opArgs.until as string | undefined;

    // Call shared resolution verifier
    const verification = await verifyTargetDataHealthAndCoverage(tx, {
      workspaceId: input.workspaceId,
      connectionId: expectedConnectionId,
      accountIds: expectedAccountIds,
      expectedSince,
      expectedUntil,
      jobId: input.jobId,
      boundOperation: boundOp,
    });

    if (!verification.verified) {
      return {
        verified: false,
        status: verification.status,
        caseClosed: false,
        reasons: verification.reasons,
      };
    }

    // Completing the operation is a worker write and must still hold its lease.
    if (!boundOp.leaseOwner || !boundOp.leaseExpiresAt || boundOp.leaseExpiresAt <= new Date()) {
      return { verified: false, status: "unresolved", caseClosed: false, reasons: ["Recovery worker lease expired before verification could commit"] };
    }
    try {
      await updateOperationWithFencedLease(tx, {
        workspaceId: input.workspaceId,
        operationId: boundOp.id,
        workerId: boundOp.leaseOwner,
        data: { state: "completed", leaseOwner: null, leaseExpiresAt: null },
      });
    } catch (error) {
      return {
        verified: false,
        status: "unresolved",
        caseClosed: false,
        reasons: [error instanceof Error ? error.message : "Recovery worker lease changed before verification commit"],
      };
    }

    // Close case
    await resolveCase(tx, {
      workspaceId: input.workspaceId,
      caseId: caseRecord.id,
      expectedVersion: caseRecord.version,
      resolutionType: "automated_recovery",
      resolutionReason: `Recovery job ${input.jobId} completed successfully and verified restored coverage`,
      isSystemVerifier: true,
    });

    return {
      verified: true,
      status: "verified",
      caseClosed: true,
      reasons: ["Complete coverage and health confirmed"],
    };
  }, runner);
}
