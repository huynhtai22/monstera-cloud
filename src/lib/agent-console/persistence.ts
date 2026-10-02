import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { CONSOLE_TOOL_REGISTRY } from "./tools";
import {
  computeDatasetFingerprint,
  validateCpaFloor,
  type MetricInputRecord,
  type DatasetFingerprintContext,
  type RowGrain,
} from "./monitor-evidence";
import { buildCanonicalAccountId } from "./roster";
import { resolveSourceHealthState, SOURCE_HEALTH_STALE_AFTER_MS } from "@/lib/source-health";

export class AgentConsoleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AgentConsoleError";
  }
}

export type ConsoleTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Run database transaction with serializable isolation and conflict retries */
export async function agentConsoleTransaction<T>(
  fn: (tx: ConsoleTransaction) => Promise<T>,
  client?: any
): Promise<T> {
  const runner = client ?? prisma;
  if (runner && "$transaction" in runner && typeof runner.$transaction === "function") {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await runner.$transaction((tx: ConsoleTransaction) => fn(tx), {
          isolationLevel: "Serializable",
          maxWait: 10000,
          timeout: 15000,
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "P2034" || code === "P2028") {
          if (attempt === 4) throw new AgentConsoleError("transaction_conflict", "Console operation is busy; refresh and retry", 409);
          await new Promise(resolve => setTimeout(resolve, 30 * 2 ** attempt + Math.floor(Math.random() * 30)));
          continue;
        }
        throw error;
      }
    }
    throw new AgentConsoleError("transaction_conflict", "Transaction conflict retry exhausted", 409);
  }
  return fn(runner as ConsoleTransaction);
}

/** Check user role within workspace */
export async function requireWorkspaceRole(
  tx: ConsoleTransaction,
  workspaceId: string,
  userId: string,
  allowedRoles: Array<"owner" | "admin" | "member" | "viewer"> = ["owner", "admin", "member"]
) {
  const member = await tx.workspaceMember.findFirst({
    where: { workspaceId, userId },
    select: { role: true },
  });
  if (!member) {
    throw new AgentConsoleError("access_denied", "Workspace access required", 403);
  }
  if (!allowedRoles.includes(member.role as "owner" | "admin" | "member" | "viewer")) {
    throw new AgentConsoleError("insufficient_role", `Action requires role [${allowedRoles.join(", ")}], got ${member.role}`, 403);
  }
  return member.role as "owner" | "admin" | "member" | "viewer";
}

/** Compute deterministic canonical scope hash from roster items */
export function computeCanonicalScopeHash(
  items: Array<{ provider: string; connectionId: string; providerAccountId: string }>
): string {
  const normalized = items
    .map(i => `${i.provider.trim()}:${i.connectionId.trim()}:${i.providerAccountId.trim()}`)
    .sort();
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

/**
 * Deterministic recursive canonical JSON serializer.
 * Recursively sorts all object keys, normalizes Date instances to ISO strings,
 * and serializes primitives and arrays consistently.
 */
export function canonicalJsonStringify(val: unknown): string {
  if (val === null || val === undefined) {
    return "null";
  }
  if (val instanceof Date) {
    return JSON.stringify(val.toISOString());
  }
  if (Array.isArray(val)) {
    return "[" + val.map(item => canonicalJsonStringify(item)).join(",") + "]";
  }
  if (typeof val === "object") {
    const keys = Object.keys(val as Record<string, unknown>).sort();
    return (
      "{" +
      keys
        .map(k => `${JSON.stringify(k)}:${canonicalJsonStringify((val as Record<string, unknown>)[k])}`)
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(val);
}


export interface CreateResponsibilityInput {
  workspaceId: string;
  clientId?: string | null;
  ownerId: string;
  createdByUserId: string;
  kind?: string;
  configuration: Record<string, unknown>;
  cadence?: string;
  timezone?: string;
}

/** Create a new draft responsibility */
export async function createResponsibility(
  tx: ConsoleTransaction,
  input: CreateResponsibilityInput
) {
  await requireWorkspaceRole(tx, input.workspaceId, input.createdByUserId, ["owner", "admin", "member"]);
  if (input.clientId) {
    const client = await tx.client.findFirst({
      where: { id: input.clientId, workspaceId: input.workspaceId },
    });
    if (!client) throw new AgentConsoleError("client_not_found", "Client does not exist in workspace", 404);
  }

  // Validate cpaFloor domain independently from monetary CPA target
  if (input.configuration && typeof input.configuration === "object" && input.configuration.cpaFloor !== undefined && input.configuration.cpaFloor !== null) {
    const validated = validateCpaFloor(input.configuration.cpaFloor);
    if (!validated.valid) {
      throw new AgentConsoleError("invalid_configuration", validated.error!, 400);
    }
  }

  const responsibility = await tx.agentResponsibility.create({
    data: {
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      ownerId: input.ownerId,
      createdByUserId: input.createdByUserId,
      kind: input.kind ?? "monitoring",
      status: "draft",
      configuration: input.configuration as unknown as Prisma.InputJsonValue,
      cadence: input.cadence ?? "daily",
      timezone: input.timezone ?? "UTC",
    },
  });

  await appendConsoleEvent(tx, {
    workspaceId: input.workspaceId,
    responsibilityId: responsibility.id,
    actorType: "user",
    actorUserId: input.createdByUserId,
    type: "responsibility_created",
    payload: { kind: responsibility.kind },
  });

  return responsibility;
}

export interface SetScopeInput {
  workspaceId: string;
  responsibilityId: string;
  scopeRevision: number;
  items: Array<{
    connectionId: string;
    provider: string;
    providerAccountId: string;
    accountName?: string;
    currency?: string;
    timezone?: string;
    metadata?: Record<string, unknown>;
  }>;
}

/** Attach explicit account scope items to a responsibility revision */
export async function setResponsibilityScope(
  tx: ConsoleTransaction,
  input: SetScopeInput
) {
  const resp = await tx.agentResponsibility.findFirst({
    where: { id: input.responsibilityId, workspaceId: input.workspaceId },
  });
  if (!resp) throw new AgentConsoleError("responsibility_not_found", "Responsibility not found", 404);

  if (input.items.length === 0) {
    throw new AgentConsoleError("empty_scope", "Scope roster items cannot be empty", 400);
  }

  // Validate connections belong to workspace
  for (const item of input.items) {
    const conn = await tx.connection.findFirst({
      where: { id: item.connectionId, workspaceId: input.workspaceId },
    });
    if (!conn) throw new AgentConsoleError("connection_not_found", `Connection ${item.connectionId} not found in workspace`, 404);
  }

  const created = await Promise.all(
    input.items.map(item =>
      tx.agentResponsibilityScope.create({
        data: {
          workspaceId: input.workspaceId,
          responsibilityId: input.responsibilityId,
          scopeRevision: input.scopeRevision,
          connectionId: item.connectionId,
          provider: item.provider,
          providerAccountId: item.providerAccountId,
          accountName: item.accountName,
          currency: item.currency,
          timezone: item.timezone,
          metadata: item.metadata as unknown as Prisma.InputJsonValue,
        },
      })
    )
  );

  return created;
}

export interface ConfirmResponsibilityInput {
  workspaceId: string;
  responsibilityId: string;
  expectedVersion: number;
  scopeHash: string;
  authorizingUserId: string;
  allowlistedTools: string[];
  allowedPairs: Array<{ provider: string; connectionId: string; providerAccountId: string }>;
  limits?: Record<string, unknown>;
  expiresAt?: Date | null;
}

/** Confirm configuration, authorize policy revision, and activate responsibility */
export async function confirmResponsibility(
  tx: ConsoleTransaction,
  input: ConfirmResponsibilityInput
) {
  // Only owner or admin can authorize autonomous execution / activate
  await requireWorkspaceRole(tx, input.workspaceId, input.authorizingUserId, ["owner", "admin"]);

  const resp = await tx.agentResponsibility.findFirst({
    where: { id: input.responsibilityId, workspaceId: input.workspaceId },
  });
  if (!resp) throw new AgentConsoleError("responsibility_not_found", "Responsibility not found", 404);
  if (resp.version !== input.expectedVersion) {
    throw new AgentConsoleError("stale_version", "Responsibility version changed; refresh before confirming", 409);
  }

  if (resp.kind === "data_health") {
    const limits = input.limits ?? {};
    const permittedModes = limits.permittedRecoveryModes;
    if (input.allowlistedTools.length !== 1 || input.allowlistedTools[0] !== "submit_recovery_import") {
      throw new AgentConsoleError("invalid_policy", "Connected data health responsibilities may only authorize bounded recovery imports", 400);
    }
    if (!Array.isArray(permittedModes) || permittedModes.length !== 1 || permittedModes[0] !== "retry_failed_window") {
      throw new AgentConsoleError("invalid_policy", "Connected data health responsibilities may only retry the failed import window", 400);
    }
  }

  // 1. Tool registry validation: every allowlisted tool must be registered
  if (!input.allowlistedTools || input.allowlistedTools.length === 0) {
    throw new AgentConsoleError("invalid_tool", "At least one allowlisted tool is required", 422);
  }
  for (const tool of input.allowlistedTools) {
    if (!CONSOLE_TOOL_REGISTRY[tool]) {
      throw new AgentConsoleError("invalid_tool", `Tool '${tool}' is not registered in console tool registry`, 422);
    }
  }

  // 2. Allowed pairs validation: must not be empty, and each connection must exist in workspace
  if (!input.allowedPairs || input.allowedPairs.length === 0) {
    throw new AgentConsoleError("invalid_scope", "Allowed pairs cannot be empty", 400);
  }
  for (const pair of input.allowedPairs) {
    const conn = await tx.connection.findFirst({
      where: { id: pair.connectionId, workspaceId: input.workspaceId, provider: pair.provider },
    });
    if (!conn) {
      throw new AgentConsoleError(
        "connection_not_found",
        `Allowed pair connection '${pair.connectionId}' with provider '${pair.provider}' not found in workspace`,
        404
      );
    }
  }

  const nextPolicyRev = resp.policyRevision + 1;
  const targetScopeRev = resp.scopeRevision === 0 ? 1 : resp.scopeRevision;

  // 3. Scope hash validation: load active scope items and verify hash matches
  const activeScopes = await tx.agentResponsibilityScope.findMany({
    where: {
      workspaceId: input.workspaceId,
      responsibilityId: input.responsibilityId,
      scopeRevision: targetScopeRev,
    },
  });

  if (activeScopes.length === 0) {
    throw new AgentConsoleError("scope_empty", "Cannot confirm responsibility with empty scope roster", 400);
  }

  // 3. Verify allowedPairs matches the persisted confirmed roster exactly
  const rosterPairKeys = new Set(
    activeScopes.map(s => `${s.provider.trim()}:${s.connectionId.trim()}:${s.providerAccountId.trim()}`)
  );
  const inputPairKeys = new Set(
    input.allowedPairs.map(p => `${p.provider.trim()}:${p.connectionId.trim()}:${p.providerAccountId.trim()}`)
  );

  if (rosterPairKeys.size !== inputPairKeys.size) {
    throw new AgentConsoleError(
      "allowed_pairs_mismatch",
      `Allowed pairs count (${inputPairKeys.size}) does not match confirmed scope roster count (${rosterPairKeys.size})`,
      400
    );
  }
  for (const pairKey of inputPairKeys) {
    if (!rosterPairKeys.has(pairKey)) {
      throw new AgentConsoleError(
        "allowed_pairs_mismatch",
        `Allowed pair '${pairKey}' is not present in confirmed scope roster`,
        400
      );
    }
  }

  const computedScopeHash = computeCanonicalScopeHash(
    activeScopes.map(s => ({
      provider: s.provider,
      connectionId: s.connectionId,
      providerAccountId: s.providerAccountId,
    }))
  );

  if (input.scopeHash !== computedScopeHash) {
    throw new AgentConsoleError(
      "scope_hash_mismatch",
      `Scope hash '${input.scopeHash}' does not match canonical scope roster hash '${computedScopeHash}'`,
      400
    );
  }

  // Revoke older active authorizations
  await tx.agentAuthorization.updateMany({
    where: {
      workspaceId: input.workspaceId,
      responsibilityId: input.responsibilityId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
      revocationReason: "superseded_by_new_policy_revision",
    },
  });

  // Create new authorization record
  const auth = await tx.agentAuthorization.create({
    data: {
      workspaceId: input.workspaceId,
      responsibilityId: input.responsibilityId,
      policyRevision: nextPolicyRev,
      scopeRevision: targetScopeRev,
      scopeHash: input.scopeHash,
      authorizingUserId: input.authorizingUserId,
      allowlistedTools: input.allowlistedTools,
      allowedPairs: input.allowedPairs as unknown as Prisma.InputJsonValue,
      limits: input.limits as unknown as Prisma.InputJsonValue,
      expiresAt: input.expiresAt,
    },
  });

  // Update responsibility to active
  const updated = await tx.agentResponsibility.update({
    where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.responsibilityId } },
    data: {
      status: "active",
      scopeHash: input.scopeHash,
      scopeRevision: targetScopeRev,
      policyRevision: nextPolicyRev,
      version: { increment: 1 },
      // Run the first data-health check promptly after explicit customer
      // approval; other responsibility types retain their existing daily slot.
      nextDueAt: resp.kind === "data_health"
        ? new Date(Date.now() - 1000)
        : new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  await appendConsoleEvent(tx, {
    workspaceId: input.workspaceId,
    responsibilityId: input.responsibilityId,
    actorType: "user",
    actorUserId: input.authorizingUserId,
    type: "responsibility_confirmed",
    payload: { policyRevision: nextPolicyRev, scopeHash: input.scopeHash },
  });

  return { responsibility: updated, authorization: auth };
}

export interface UpdateResponsibilityStatusInput {
  workspaceId: string;
  responsibilityId: string;
  expectedVersion: number;
  status: "active" | "paused" | "disabled";
  actorUserId: string;
  reason?: string;
}

/** Pause, resume, or disable responsibility with version check */
export async function updateResponsibilityStatus(
  tx: ConsoleTransaction,
  input: UpdateResponsibilityStatusInput
) {
  await requireWorkspaceRole(tx, input.workspaceId, input.actorUserId, ["owner", "admin"]);

  const resp = await tx.agentResponsibility.findFirst({
    where: { id: input.responsibilityId, workspaceId: input.workspaceId },
  });
  if (!resp) throw new AgentConsoleError("responsibility_not_found", "Responsibility not found", 404);
  if (resp.version !== input.expectedVersion) {
    throw new AgentConsoleError("stale_version", "Responsibility changed; refresh before updating status", 409);
  }

  // Reactivating requires valid active policy matching current scope and authorized by active owner/admin
  if (input.status === "active") {
    const activeAuth = await tx.agentAuthorization.findFirst({
      where: {
        workspaceId: input.workspaceId,
        responsibilityId: input.responsibilityId,
        policyRevision: resp.policyRevision,
        revokedAt: null,
      },
    });
    if (!activeAuth) throw new AgentConsoleError("authorization_required", "Cannot activate responsibility without active authorization", 400);
    if (activeAuth.expiresAt && activeAuth.expiresAt < new Date()) {
      throw new AgentConsoleError("authorization_expired", "Authorization has expired; re-confirmation required", 400);
    }
    // Verify scope revision and scope hash match between authorization and responsibility
    if (activeAuth.scopeRevision !== resp.scopeRevision || activeAuth.scopeHash !== resp.scopeHash) {
      throw new AgentConsoleError("authorization_required", "Scope revision or hash has changed; re-confirmation required before resuming", 400);
    }
    // Verify that current persisted scope items match resp.scopeHash
    const currentScopes = await tx.agentResponsibilityScope.findMany({
      where: {
        workspaceId: input.workspaceId,
        responsibilityId: input.responsibilityId,
        scopeRevision: resp.scopeRevision,
      },
    });
    if (currentScopes.length === 0) {
      throw new AgentConsoleError("scope_empty", "Cannot activate responsibility with empty scope roster", 400);
    }
    const computedScopeHash = computeCanonicalScopeHash(
      currentScopes.map(s => ({
        provider: s.provider,
        connectionId: s.connectionId,
        providerAccountId: s.providerAccountId,
      }))
    );
    if (computedScopeHash !== activeAuth.scopeHash) {
      throw new AgentConsoleError("authorization_required", "Scope items have changed since authorization; re-confirmation required before resuming", 400);
    }

    // Recheck authorizing user membership and role
    const authorizerMember = await tx.workspaceMember.findFirst({
      where: { workspaceId: input.workspaceId, userId: activeAuth.authorizingUserId },
      select: { role: true },
    });
    if (!authorizerMember || !["owner", "admin"].includes(authorizerMember.role)) {
      throw new AgentConsoleError(
        "authorizer_permission_lost",
        "Authorizing user is no longer an active workspace owner or admin; fresh authorization required",
        403
      );
    }
  }

  const updated = await tx.agentResponsibility.update({
    where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.responsibilityId } },
    data: {
      status: input.status,
      version: { increment: 1 },
    },
  });

  await appendConsoleEvent(tx, {
    workspaceId: input.workspaceId,
    responsibilityId: input.responsibilityId,
    actorType: "user",
    actorUserId: input.actorUserId,
    type: "responsibility_status_changed",
    payload: { from: resp.status, to: input.status, reason: input.reason },
  });

  return updated;
}

export interface RecordEvaluationInput {
  workspaceId: string;
  responsibilityId: string;
  configVersion: number;
  scopeRevision: number;
  policyRevision: number;
  scheduledSlot: Date;
  status?: string;
  qualityCode?: string | null;
  blockerCode?: string | null;
  evidenceId?: string | null;
  result?: Record<string, unknown> | null;
  windowSince?: Date | null;
  windowUntil?: Date | null;
}

/** Record a scheduled check evaluation idempotently */
export async function recordEvaluation(
  tx: ConsoleTransaction,
  input: RecordEvaluationInput
) {
  // Validate evidenceId belongs to workspace and is not expired
  if (input.evidenceId) {
    const evidence = await tx.agentEvidenceSnapshot.findFirst({
      where: { id: input.evidenceId, workspaceId: input.workspaceId },
    });
    if (!evidence) {
      throw new AgentConsoleError("evidence_not_found", "Evidence snapshot not found in workspace", 404);
    }
    if (evidence.isExpired) {
      throw new AgentConsoleError("evidence_expired", "Cannot record evaluation with expired evidence snapshot", 400);
    }
  }

  // Check if evaluation already recorded for this slot & revision within workspace
  const existing = await tx.agentEvaluation.findFirst({
    where: {
      workspaceId: input.workspaceId,
      responsibilityId: input.responsibilityId,
      scopeRevision: input.scopeRevision,
      scheduledSlot: input.scheduledSlot,
    },
  });

  if (existing) {
    const existingWindowSince = existing.windowSince ? new Date(existing.windowSince).toISOString() : null;
    const inputWindowSince = input.windowSince ? new Date(input.windowSince).toISOString() : null;
    const existingWindowUntil = existing.windowUntil ? new Date(existing.windowUntil).toISOString() : null;
    const inputWindowUntil = input.windowUntil ? new Date(input.windowUntil).toISOString() : null;

    // If exact same attributes, return existing (idempotent replay)
    if (
      existing.status === (input.status ?? "no_finding") &&
      existing.configVersion === input.configVersion &&
      existing.policyRevision === input.policyRevision &&
      existing.qualityCode === (input.qualityCode ?? null) &&
      existing.blockerCode === (input.blockerCode ?? null) &&
      existing.evidenceId === (input.evidenceId ?? null) &&
      existingWindowSince === inputWindowSince &&
      existingWindowUntil === inputWindowUntil &&
      canonicalJsonStringify(existing.result) === canonicalJsonStringify(input.result)
    ) {
      return { evaluation: existing, created: false };
    }
    throw new AgentConsoleError("evaluation_conflict", "Conflicting evaluation already recorded for scheduled slot", 409);
  }

  const evaluation = await tx.agentEvaluation.create({
    data: {
      workspaceId: input.workspaceId,
      responsibilityId: input.responsibilityId,
      configVersion: input.configVersion,
      scopeRevision: input.scopeRevision,
      policyRevision: input.policyRevision,
      scheduledSlot: input.scheduledSlot,
      status: input.status ?? "no_finding",
      qualityCode: input.qualityCode,
      blockerCode: input.blockerCode,
      evidenceId: input.evidenceId,
      result: input.result as unknown as Prisma.InputJsonValue,
      windowSince: input.windowSince,
      windowUntil: input.windowUntil,
      completedAt: new Date(),
    },
  });

  await tx.agentResponsibility.update({
    where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.responsibilityId } },
    data: {
      lastAttemptedAt: new Date(),
      lastSuccessfulAt: evaluation.status === "no_finding" || evaluation.status === "success" ? new Date() : undefined,
    },
  });

  return { evaluation, created: true };
}

export interface OpenOrUpdateCaseInput {
  workspaceId: string;
  clientId?: string | null;
  responsibilityId?: string | null;
  evaluationId?: string | null;
  fingerprint: string;
  type?: string;
  priority?: "critical" | "high" | "medium" | "low";
  title: string;
  description?: string;
  requiredAction?: string;
}

/** Open a new case or update existing open case for the fingerprint */
export async function openOrUpdateCase(
  tx: ConsoleTransaction,
  input: OpenOrUpdateCaseInput
) {
  // Validate responsibilityId belongs to workspace if provided
  if (input.responsibilityId) {
    const resp = await tx.agentResponsibility.findFirst({
      where: { id: input.responsibilityId, workspaceId: input.workspaceId },
    });
    if (!resp) throw new AgentConsoleError("responsibility_not_found", "Responsibility not found in workspace", 404);
  }

  // Validate evaluationId belongs to workspace if provided
  if (input.evaluationId) {
    const ev = await tx.agentEvaluation.findFirst({
      where: { id: input.evaluationId, workspaceId: input.workspaceId },
    });
    if (!ev) throw new AgentConsoleError("evaluation_not_found", "Evaluation not found in workspace", 404);
  }

  const openCase = await tx.agentCase.findFirst({
    where: {
      workspaceId: input.workspaceId,
      fingerprint: input.fingerprint,
      state: { not: "resolved" },
    },
  });

  if (openCase) {
    // Update existing open episode
    const updated = await tx.agentCase.update({
      where: { workspaceId_id: { workspaceId: input.workspaceId, id: openCase.id } },
      data: {
        lastObservedAt: new Date(),
        title: input.title,
        description: input.description ?? openCase.description,
        requiredAction: input.requiredAction ?? openCase.requiredAction,
        version: { increment: 1 },
      },
    });

    await appendConsoleEvent(tx, {
      workspaceId: input.workspaceId,
      caseId: updated.id,
      actorType: "system",
      type: "case_reobserved",
      payload: { fingerprint: input.fingerprint, episode: updated.episode },
    });

    return { caseRecord: updated, isNew: false };
  }

  // Find latest episode number for this fingerprint
  const latestEpisode = await tx.agentCase.findFirst({
    where: { workspaceId: input.workspaceId, fingerprint: input.fingerprint },
    orderBy: { episode: "desc" },
    select: { episode: true },
  });
  const nextEpisode = (latestEpisode?.episode ?? 0) + 1;

  const newCase = await tx.agentCase.create({
    data: {
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      responsibilityId: input.responsibilityId,
      evaluationId: input.evaluationId,
      fingerprint: input.fingerprint,
      episode: nextEpisode,
      type: input.type ?? "metric_anomaly",
      priority: input.priority ?? "medium",
      state: "detected",
      title: input.title,
      description: input.description,
      requiredAction: input.requiredAction,
    },
  });

  await appendConsoleEvent(tx, {
    workspaceId: input.workspaceId,
    caseId: newCase.id,
    actorType: "system",
    type: "case_opened",
    payload: { fingerprint: input.fingerprint, episode: nextEpisode, priority: newCase.priority },
  });

  return { caseRecord: newCase, isNew: true };
}

export interface ResolveCaseInput {
  workspaceId: string;
  caseId: string;
  expectedVersion: number;
  resolutionType: "automated_recovery" | "manual_resolved" | "false_positive" | "superseded";
  resolutionReason?: string;
  resolutionEvidenceId?: string;
  actorUserId?: string;
  isSystemVerifier?: boolean;
}

/** Resolve a case episode, freeing fingerprint for future distinct episodes */
export async function resolveCase(
  tx: ConsoleTransaction,
  input: ResolveCaseInput
) {
  const caseRecord = await tx.agentCase.findFirst({
    where: { id: input.caseId, workspaceId: input.workspaceId },
  });
  if (!caseRecord) throw new AgentConsoleError("case_not_found", "Case not found", 404);

  // False-resolution gate: automated_recovery can ONLY be certified by system verifier
  if (input.resolutionType === "automated_recovery" && !input.isSystemVerifier) {
    throw new AgentConsoleError(
      "unauthorized_resolution_type",
      "Automated recovery can only be certified by scoped system verification, not interactive action",
      403
    );
  }

  // Reason is mandatory for manual resolutions
  if (
    (input.resolutionType === "manual_resolved" || input.resolutionType === "false_positive") &&
    (!input.resolutionReason || !input.resolutionReason.trim())
  ) {
    throw new AgentConsoleError(
      "resolution_reason_required",
      "A non-empty resolution reason is mandatory for manual resolution",
      400
    );
  }

  // Resolution evidence must exist in workspace and not be expired
  if (input.resolutionEvidenceId) {
    const ev = await tx.agentEvidenceSnapshot.findFirst({
      where: { id: input.resolutionEvidenceId, workspaceId: input.workspaceId },
    });
    if (!ev) {
      throw new AgentConsoleError("evidence_not_found", "Resolution evidence snapshot not found in workspace", 404);
    }
    if (ev.isExpired) {
      throw new AgentConsoleError("evidence_expired", "Resolution evidence snapshot is expired and unavailable", 400);
    }
  }

  // If already resolved, check for idempotent replay vs conflicting resolution
  if (caseRecord.state === "resolved") {
    if (
      caseRecord.resolutionType === input.resolutionType &&
      caseRecord.resolutionReason === (input.resolutionReason ?? null)
    ) {
      return caseRecord;
    }
    throw new AgentConsoleError("case_already_resolved", "Case episode is already resolved", 409);
  }

  if (caseRecord.version !== input.expectedVersion) {
    throw new AgentConsoleError("stale_version", "Case changed; refresh before resolving", 409);
  }

  const updated = await tx.agentCase.update({
    where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.caseId } },
    data: {
      state: "resolved",
      resolutionType: input.resolutionType,
      resolutionReason: input.resolutionReason,
      resolutionEvidenceId: input.resolutionEvidenceId,
      resolvedAt: new Date(),
      version: { increment: 1 },
    },
  });

  await appendConsoleEvent(tx, {
    workspaceId: input.workspaceId,
    caseId: updated.id,
    actorType: input.actorUserId ? "user" : "system",
    actorUserId: input.actorUserId,
    type: "case_resolved",
    payload: { resolutionType: input.resolutionType, reason: input.resolutionReason },
  });

  return updated;
}

export interface EnqueueOperationInput {
  workspaceId: string;
  caseId?: string | null;
  evaluationId?: string | null;
  operationKey: string;
  toolName: string;
  arguments: Record<string, unknown>;
  scopeHash: string;
  policyRevision: number;
}

/** Enqueue an operation idempotently with operationKey deduplication and full arguments verification */
export async function enqueueOperation(
  tx: ConsoleTransaction,
  input: EnqueueOperationInput
) {
  // Validate caseId belongs to workspace if provided
  if (input.caseId) {
    const c = await tx.agentCase.findFirst({
      where: { id: input.caseId, workspaceId: input.workspaceId },
    });
    if (!c) throw new AgentConsoleError("case_not_found", "Case not found in workspace", 404);
  }

  // Validate evaluationId belongs to workspace if provided
  if (input.evaluationId) {
    const ev = await tx.agentEvaluation.findFirst({
      where: { id: input.evaluationId, workspaceId: input.workspaceId },
    });
    if (!ev) throw new AgentConsoleError("evaluation_not_found", "Evaluation not found in workspace", 404);
  }

  const existing = await tx.agentOperation.findFirst({
    where: { workspaceId: input.workspaceId, operationKey: input.operationKey },
  });

  if (existing) {
    // Canonical recursive JSON comparison for arguments
    const existingArgsStr = canonicalJsonStringify(existing.arguments);
    const inputArgsStr = canonicalJsonStringify(input.arguments);

    if (
      existing.toolName === input.toolName &&
      existing.scopeHash === input.scopeHash &&
      existing.policyRevision === input.policyRevision &&
      existingArgsStr === inputArgsStr
    ) {
      return { operation: existing, created: false };
    }
    throw new AgentConsoleError("idempotency_conflict", "Operation key already exists with conflicting configuration or arguments", 409);
  }

  const operation = await tx.agentOperation.create({
    data: {
      workspaceId: input.workspaceId,
      caseId: input.caseId,
      evaluationId: input.evaluationId,
      operationKey: input.operationKey,
      toolName: input.toolName,
      arguments: input.arguments as unknown as Prisma.InputJsonValue,
      scopeHash: input.scopeHash,
      policyRevision: input.policyRevision,
      state: "queued",
    },
  });

  await appendConsoleEvent(tx, {
    workspaceId: input.workspaceId,
    caseId: input.caseId ?? undefined,
    operationId: operation.id,
    actorType: "system",
    type: "operation_enqueued",
    payload: { toolName: input.toolName, operationKey: input.operationKey },
  });

  return { operation, created: true };
}

export interface CreateApprovalInput {
  workspaceId: string;
  operationId: string;
  proposalHash: string;
  approverUserId?: string | null;
  evidenceFingerprint: string;
  evidenceRevision?: number;
  policyRevision: number;
  scopeRevision: number;
  expiresAt: Date;
}

/** Create a proposal approval record bound to exact operation, hash, and evidence */
export async function createApproval(
  tx: ConsoleTransaction,
  input: CreateApprovalInput
) {
  const op = await tx.agentOperation.findFirst({
    where: { id: input.operationId, workspaceId: input.workspaceId },
    include: {
      case: { include: { responsibility: true } },
      evaluation: { include: { responsibility: true } },
    },
  });
  if (!op) throw new AgentConsoleError("operation_not_found", "Operation not found in workspace", 404);

  // Requirement 1: Deliberately resolve responsibility from case OR evaluation; reject unbound operations
  const resp = op.case?.responsibility ?? op.evaluation?.responsibility;
  if (!resp) {
    throw new AgentConsoleError("unbound_operation", "Approvable operation must resolve to an explicit workspace-scoped responsibility", 400);
  }

  // Verify active authorization exists for this responsibility and policy revision
  const activeAuth = await tx.agentAuthorization.findFirst({
    where: {
      workspaceId: input.workspaceId,
      responsibilityId: resp.id,
      policyRevision: input.policyRevision,
      revokedAt: null,
    },
  });
  if (!activeAuth) {
    throw new AgentConsoleError("authorization_required", "Active policy authorization required for operation responsibility", 400);
  }

  const existing = await tx.agentApproval.findFirst({
    where: { operationId: input.operationId, proposalHash: input.proposalHash },
  });
  if (existing) {
    if (
      existing.evidenceFingerprint === input.evidenceFingerprint &&
      existing.evidenceRevision === (input.evidenceRevision ?? 1) &&
      existing.policyRevision === input.policyRevision &&
      existing.scopeRevision === input.scopeRevision
    ) {
      return existing;
    }
    throw new AgentConsoleError("approval_conflict", "Conflicting approval already exists for operation and proposal", 409);
  }

  const approval = await tx.agentApproval.create({
    data: {
      workspaceId: input.workspaceId,
      operationId: input.operationId,
      proposalHash: input.proposalHash,
      approverUserId: input.approverUserId,
      evidenceFingerprint: input.evidenceFingerprint,
      evidenceRevision: input.evidenceRevision ?? 1,
      policyRevision: input.policyRevision,
      scopeRevision: input.scopeRevision,
      status: "pending",
      expiresAt: input.expiresAt,
    },
  });

  await appendConsoleEvent(tx, {
    workspaceId: input.workspaceId,
    operationId: input.operationId,
    actorType: input.approverUserId ? "user" : "system",
    actorUserId: input.approverUserId ?? undefined,
    type: "approval_created",
    payload: { proposalHash: input.proposalHash, expiresAt: input.expiresAt.toISOString() },
  });

  return approval;
}

export interface ConsumeApprovalInput {
  workspaceId: string;
  approvalId: string;
  operationId: string;
  proposalHash: string;
  evidenceFingerprint: string;
  evidenceRevision?: number;
  policyRevision: number;
  scopeRevision: number;
  actorUserId: string;
}

/** Atomically consume an interactive approval once with complete binding verification */
export async function consumeApproval(
  tx: ConsoleTransaction,
  input: ConsumeApprovalInput
) {
  await requireWorkspaceRole(tx, input.workspaceId, input.actorUserId, ["owner", "admin", "member"]);

  const approval = await tx.agentApproval.findFirst({
    where: { id: input.approvalId, workspaceId: input.workspaceId },
  });
  if (!approval) throw new AgentConsoleError("approval_not_found", "Approval not found", 404);

  // Exact bindings verification
  if (approval.operationId !== input.operationId) {
    throw new AgentConsoleError("approval_binding_mismatch", "Approval operation mismatch", 400);
  }
  if (approval.proposalHash !== input.proposalHash) {
    throw new AgentConsoleError("approval_binding_mismatch", "Approval proposal hash mismatch", 400);
  }
  if (approval.evidenceFingerprint !== input.evidenceFingerprint) {
    throw new AgentConsoleError("approval_binding_mismatch", "Approval evidence fingerprint mismatch", 400);
  }
  if (input.evidenceRevision !== undefined && approval.evidenceRevision !== input.evidenceRevision) {
    throw new AgentConsoleError("approval_binding_mismatch", "Approval evidence revision mismatch", 400);
  }
  if (approval.policyRevision !== input.policyRevision) {
    throw new AgentConsoleError("approval_binding_mismatch", "Approval policy revision mismatch", 400);
  }
  if (approval.scopeRevision !== input.scopeRevision) {
    throw new AgentConsoleError("approval_binding_mismatch", "Approval scope revision mismatch", 400);
  }
  if (approval.expiresAt < new Date()) {
    throw new AgentConsoleError("approval_expired", "Approval has expired", 400);
  }

  // 1. Verify associated evidence snapshot exists, is not expired, and matches exact revision
  const evidenceSnapshot = await tx.agentEvidenceSnapshot.findFirst({
    where: {
      datasetFingerprint: approval.evidenceFingerprint,
      calculationVersion: approval.evidenceRevision,
      workspaceId: input.workspaceId,
    },
    orderBy: { createdAt: "desc" },
  });
  if (!evidenceSnapshot) {
    throw new AgentConsoleError("evidence_missing", "Underlying evidence snapshot is missing or unavailable", 400);
  }
  if (evidenceSnapshot.isExpired) {
    throw new AgentConsoleError("approval_expired", "Underlying evidence snapshot is expired; approval is invalidated", 400);
  }

  // 2. Verify operation exists and is in queued state
  const op = await tx.agentOperation.findFirst({
    where: { id: input.operationId, workspaceId: input.workspaceId },
    include: {
      case: { include: { responsibility: true } },
      evaluation: { include: { responsibility: true } },
    },
  });
  if (!op) throw new AgentConsoleError("operation_not_found", "Operation not found in workspace", 404);
  if (op.state !== "queued") {
    throw new AgentConsoleError("invalid_operation_state", `Operation state must be 'queued' to consume approval, got '${op.state}'`, 400);
  }

  // Requirement 1: Deliberately resolve responsibility from case OR evaluation; reject unbound operations
  const resp = op.case?.responsibility ?? op.evaluation?.responsibility;
  if (!resp) {
    throw new AgentConsoleError("unbound_operation", "Approvable operation must resolve to an explicit workspace-scoped responsibility", 400);
  }

  // Requirement 2: Verify responsibility status and revisions
  if (resp.status !== "active") {
    throw new AgentConsoleError("responsibility_not_active", `Responsibility must be active to consume approval, current status is '${resp.status}'`, 400);
  }
  if (resp.policyRevision !== input.policyRevision || resp.scopeRevision !== input.scopeRevision) {
    throw new AgentConsoleError(
      "responsibility_revision_changed",
      `Responsibility revisions changed (policy: ${resp.policyRevision}, scope: ${resp.scopeRevision}) vs approval (policy: ${input.policyRevision}, scope: ${input.scopeRevision})`,
      400
    );
  }

  // Authoritatively verify underlying evidence is eligible (not blocked)
  const snapshotProv = evidenceSnapshot.provenance as Record<string, unknown> | null;
  const snapshotMetrics = evidenceSnapshot.metrics as Record<string, unknown> | null;
  if (snapshotProv?.valid === false || snapshotMetrics?.comparisonBlocked === true) {
    throw new AgentConsoleError(
      "evidence_ineligible",
      `Underlying evidence is not eligible for execution: ${(snapshotMetrics?.comparisonBlockReason as string) || "blocked quality gates"}`,
      400
    );
  }

  // Authoritatively verify underlying evidence has not been superseded by a newer dataset
  const newerSnapshots = await tx.agentEvidenceSnapshot.findMany({
    where: {
      workspaceId: input.workspaceId,
      createdAt: { gt: evidenceSnapshot.createdAt },
    },
    orderBy: { createdAt: "desc" },
  });

  const targetRespId = (snapshotProv?.responsibilityId as string) || resp.id;
  const targetSince = (snapshotProv?.currentSince as string) || (evidenceSnapshot.actualSince ? evidenceSnapshot.actualSince.toISOString().slice(0, 10) : "");
  const targetUntil = (snapshotProv?.currentUntil as string) || (evidenceSnapshot.actualUntil ? evidenceSnapshot.actualUntil.toISOString().slice(0, 10) : "");

  const supersedingSnapshot = newerSnapshots.find((s) => {
    const p = s.provenance as Record<string, unknown> | null;
    if (!p) return false;
    const sameResp = p.responsibilityId === targetRespId;
    const sameWindow = p.currentSince === targetSince && p.currentUntil === targetUntil;
    return sameResp && sameWindow;
  });

  if (supersedingSnapshot && supersedingSnapshot.datasetFingerprint !== approval.evidenceFingerprint) {
    throw new AgentConsoleError(
      "evidence_superseded",
      `Underlying evidence has been superseded by a newer dataset (fingerprint '${supersedingSnapshot.datasetFingerprint}' vs approved '${approval.evidenceFingerprint}'); approval is invalidated`,
      400
    );
  }

  // Verify current scope hash
  const currentScopes = await tx.agentResponsibilityScope.findMany({
    where: {
      workspaceId: input.workspaceId,
      responsibilityId: resp.id,
      scopeRevision: resp.scopeRevision,
    },
  });
  const currentScopeHash = computeCanonicalScopeHash(
    currentScopes.map((s) => ({
      provider: s.provider,
      connectionId: s.connectionId,
      providerAccountId: s.providerAccountId,
    }))
  );
  if (currentScopeHash !== resp.scopeHash) {
    throw new AgentConsoleError("authorization_required", "Responsibility scope has changed since authorization", 400);
  }

  // Requirement 2: Recheck current source health and data-through coverage for scoped connections
  const scopedConnectionIds = Array.from(new Set(currentScopes.map((s) => s.connectionId)));
  const scopedConnections = await tx.connection.findMany({
    where: {
      workspaceId: input.workspaceId,
      id: { in: scopedConnectionIds },
    },
  });

  if (scopedConnections.length !== scopedConnectionIds.length) {
    const foundIds = new Set(scopedConnections.map((c) => c.id));
    const missingIds = scopedConnectionIds.filter((id) => !foundIds.has(id));
    throw new AgentConsoleError(
      "connection_missing",
      `One or more scoped connections were not found in workspace: [${missingIds.join(", ")}]`,
      400
    );
  }

  // Defect 3: Synthetic test evidence must NEVER authorize production execution
  if (snapshotProv?.isSyntheticTest === true && op.arguments && typeof op.arguments === "object" && (op.arguments as Record<string, unknown>).executionMode === "live_production") {
    throw new AgentConsoleError(
      "evidence_ineligible",
      "Synthetic test evidence cannot authorize live production execution",
      400
    );
  }

  const isSyntheticSnapshot = snapshotProv?.isSyntheticTest === true;
  const isLiveProduction = op.arguments && typeof op.arguments === "object" && (op.arguments as Record<string, unknown>).executionMode === "live_production";
  const referenceNow = isSyntheticSnapshot && !isLiveProduction && snapshotProv?.asOfTimestamp
    ? new Date(snapshotProv.asOfTimestamp as string)
    : new Date();
  const staleBefore = new Date(referenceNow.getTime() - SOURCE_HEALTH_STALE_AFTER_MS);

  for (const conn of scopedConnections) {
    if (conn.status !== "connected" || conn.lastError) {
      throw new AgentConsoleError(
        "evidence_ineligible",
        `Scoped connection '${conn.id}' has degraded health status '${conn.status}'${conn.lastError ? ` (${conn.lastError})` : ""}; approval cannot be consumed`,
        400
      );
    }

    // For C3 evidence bound to a responsibility, enforce canonical source health checks & data-through
    if (snapshotProv?.responsibilityId) {
      const healthState = resolveSourceHealthState({
        connectionStatus: conn.status,
        lastError: conn.lastError,
        lastSyncAt: conn.lastSyncAt,
        now: referenceNow,
        staleBefore,
      });

      if (healthState !== "fresh") {
        const detail = healthState === "stale" ? "data is stale (>24h since last sync); sync health has degraded" : `has degraded health status '${healthState}'`;
        throw new AgentConsoleError(
          "evidence_ineligible",
          `Scoped connection '${conn.id}' ${detail}${conn.lastError ? ` (${conn.lastError})` : ""}; approval cannot be consumed`,
          400
        );
      }



      if (!conn.lastSyncAt) {
        throw new AgentConsoleError(
          "evidence_ineligible",
          `Scoped connection '${conn.id}' has no recorded sync; data freshness is unproven`,
          400
        );
      }


      // Defect 3: Missing lastDataThrough must reject consumption, including when removed after proposal
      if (!conn.lastDataThrough) {
        throw new AgentConsoleError(
          "evidence_ineligible",
          `Scoped connection '${conn.id}' has no verified data-through date; data coverage is unproven`,
          400
        );
      }
      const dtIso = conn.lastDataThrough instanceof Date
        ? conn.lastDataThrough.toISOString().slice(0, 10)
        : String(conn.lastDataThrough).slice(0, 10);
      if (targetUntil && dtIso < targetUntil) {
        throw new AgentConsoleError(
          "evidence_ineligible",
          `Scoped connection '${conn.id}' data-through (${dtIso}) does not cover evidence window until (${targetUntil})`,
          400
        );
      }
    }
  }

  // Requirement 2: Detect relevant warehouse corrections even when no superseding snapshot has been generated
  if (snapshotProv?.responsibilityId && targetSince && targetUntil) {
    const baselineSince = (snapshotProv.baselineSince as string) || targetSince;
    const targetGrain = (snapshotProv.targetGrain as RowGrain) || "campaign";
    const dbMetricRows = await tx.campaignMetric.findMany({
      where: {
        workspaceId: input.workspaceId,
        OR: currentScopes.map((s) => ({
          connectionId: s.connectionId,
          accountId: s.providerAccountId,
          platform: s.provider,
        })),
        level: targetGrain,
        date: {
          gte: new Date(`${baselineSince}T00:00:00.000Z`),
          lte: new Date(`${targetUntil}T23:59:59.999Z`),
        },
      },
    });

    const liveRecords: MetricInputRecord[] = dbMetricRows.map((r) => ({
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      platform: r.platform,
      connectionId: r.connectionId,
      accountId: r.accountId,
      level: r.level as RowGrain,
      entityId: r.entityId,
      breakdownHash: r.breakdownHash,
      spend: r.spend,
      conversions: r.conversions,
      revenue: r.revenue,
      currency: r.currency,
      rawData: r.rawData,
    }));

    const currentWindowDates = (snapshotMetrics?.current as any)?.window?.dates ?? [];
    const baselineWindowDates = (snapshotMetrics?.baseline as any)?.window?.dates ?? [];

    const liveRespConfig = (resp.configuration && typeof resp.configuration === "object")
      ? (resp.configuration as Record<string, unknown>)
      : {};

    if (liveRespConfig.cpaFloor !== undefined && liveRespConfig.cpaFloor !== null) {
      const validated = validateCpaFloor(liveRespConfig.cpaFloor);
      if (!validated.valid) {
        throw new AgentConsoleError("invalid_configuration", validated.error!, 400);
      }
    }

    const liveAttributionWindow = typeof liveRespConfig.expectedAttributionWindow === "string"
      ? liveRespConfig.expectedAttributionWindow
      : (typeof liveRespConfig.attributionWindow === "string" ? liveRespConfig.attributionWindow : undefined);

    const liveConversionAction = typeof liveRespConfig.expectedConversionAction === "string"
      ? liveRespConfig.expectedConversionAction
      : (typeof liveRespConfig.conversionAction === "string" ? liveRespConfig.conversionAction : undefined);

    const liveRevenueBasis: "order_placed" | "order_completed" | "attributed_ad_gmv" = (
      typeof liveRespConfig.revenueBasis === "string" &&
      ["order_placed", "order_completed", "attributed_ad_gmv"].includes(liveRespConfig.revenueBasis)
    )
      ? (liveRespConfig.revenueBasis as "order_placed" | "order_completed" | "attributed_ad_gmv")
      : ((snapshotProv.revenueBasis as any) ?? "order_completed");

    const fingerprintContext: DatasetFingerprintContext = {
      workspaceId: input.workspaceId,
      responsibilityId: resp.id,
      scopeRevision: resp.scopeRevision,
      rosterRevision: resp.scopeRevision,
      accountScope: currentScopes.map((s) => ({
        canonicalId: buildCanonicalAccountId(s.provider, s.connectionId, s.providerAccountId),
        currency: s.currency || "",
        timezone: s.timezone || resp.timezone || "",
      })),
      currentWindow: {
        since: targetSince,
        until: targetUntil,
        daysCount: currentWindowDates.length || 7,
        dates: currentWindowDates,
      },
      baselineWindow: {
        since: baselineSince,
        until: (snapshotProv.baselineUntil as string) || targetSince,
        daysCount: baselineWindowDates.length || 7,
        dates: baselineWindowDates,
      },
      timezone: resp.timezone || currentScopes[0]?.timezone || "UTC",
      grain: targetGrain,
      metricSemantics: {
        supportsRevenue: snapshotProv.supportsRevenue,
        supportsCpa: snapshotProv.supportsCpa,
        revenueBasis: liveRevenueBasis,
      },
      responsibilityConfig: {
        cpaFloor: typeof liveRespConfig.cpaFloor === "number" ? liveRespConfig.cpaFloor : undefined,
        expectedAttributionWindow: liveAttributionWindow,
        expectedConversionAction: liveConversionAction,
        revenueBasis: typeof liveRespConfig.revenueBasis === "string" ? liveRespConfig.revenueBasis : undefined,
      },
      provenance: snapshotProv,
      zeroReceipts: [],
      calculationVersion: evidenceSnapshot.calculationVersion,
    };

    const liveFingerprint = computeDatasetFingerprint(fingerprintContext, liveRecords);
    if (liveFingerprint !== approval.evidenceFingerprint) {
      throw new AgentConsoleError(
        "evidence_superseded",
        `Underlying warehouse metrics have drifted or been corrected since evidence was evaluated (recomputed fingerprint '${liveFingerprint}' vs approved '${approval.evidenceFingerprint}'); approval is invalidated`,
        400
      );
    }
  }

  // Requirement 2: Verify policy authorization is active, not revoked, not expired, and matches current scope
  const activeAuth = await tx.agentAuthorization.findFirst({
    where: {
      workspaceId: input.workspaceId,
      responsibilityId: resp.id,
      policyRevision: input.policyRevision,
    },
  });
  if (!activeAuth) {
    throw new AgentConsoleError("policy_missing", "Active policy authorization record not found for revision", 400);
  }
  if (activeAuth.revokedAt !== null) {
    throw new AgentConsoleError("policy_invalidated", "Policy revision has been revoked", 400);
  }
  if (activeAuth.expiresAt && activeAuth.expiresAt < new Date()) {
    throw new AgentConsoleError("policy_expired", "Policy revision has expired", 400);
  }
  if (activeAuth.scopeHash !== currentScopeHash || activeAuth.scopeRevision !== resp.scopeRevision) {
    throw new AgentConsoleError("authorization_required", "Authorization scope hash does not match current responsibility scope", 400);
  }

  // Requirement 2: Recheck authorizing user membership and role
  const authorizerMember = await tx.workspaceMember.findFirst({
    where: { workspaceId: input.workspaceId, userId: activeAuth.authorizingUserId },
    select: { role: true },
  });
  if (!authorizerMember || !["owner", "admin"].includes(authorizerMember.role)) {
    throw new AgentConsoleError(
      "authorizer_permission_lost",
      "Authorizing user is no longer an active workspace owner or admin; fresh authorization required",
      403
    );
  }

  // Requirement 2: Verify permitted tools
  if (!activeAuth.allowlistedTools.includes(op.toolName)) {
    throw new AgentConsoleError(
      "tool_not_allowlisted",
      `Tool '${op.toolName}' is not permitted by active authorization policy`,
      403
    );
  }

  // Requirement 2: Verify exact authorized targets from operation arguments
  const opArgs = op.arguments as Record<string, unknown> | null;
  const targetConnectionId = (opArgs?.connectionId ?? opArgs?.targetConnectionId) as string | undefined;
  const targetProvider = (opArgs?.provider ?? opArgs?.targetProvider) as string | undefined;
  const targetAccountId = (opArgs?.adAccountId ?? opArgs?.targetProviderAccountId ?? opArgs?.providerAccountId) as string | undefined;

  if (targetConnectionId) {
    const allowedPairs = activeAuth.allowedPairs as Array<{
      provider: string;
      connectionId: string;
      providerAccountId: string;
    }>;
    const isTargetAuthorized = allowedPairs?.some((p) => {
      const matchConn = p.connectionId === targetConnectionId;
      const matchProvider = targetProvider ? p.provider === targetProvider : true;
      const matchAccount = targetAccountId ? p.providerAccountId === targetAccountId : true;
      return matchConn && matchProvider && matchAccount;
    });
    if (!isTargetAuthorized) {
      throw new AgentConsoleError(
        "target_not_authorized",
        `Target connection '${targetConnectionId}' is not authorized in policy`,
        403
      );
    }
  }

  // Requirement 4: Bind approvals to the operation proposal
  if (op.policyRevision !== input.policyRevision || op.scopeHash !== resp.scopeHash) {
    throw new AgentConsoleError(
      "proposal_invalidated",
      "Operation scope or policy revision has changed since proposal; approval is invalidated",
      400
    );
  }

  // Atomic row-level conditional consumption: guarantees single-use even under concurrent callers
  const updateResult = await tx.agentApproval.updateMany({
    where: {
      id: input.approvalId,
      workspaceId: input.workspaceId,
      isSingleUseConsumed: false,
      status: "pending",
    },
    data: {
      status: "consumed",
      isSingleUseConsumed: true,
      consumedAt: new Date(),
      consumedByOperationId: input.operationId,
    },
  });

  if (updateResult.count === 0) {
    throw new AgentConsoleError("approval_already_consumed", "Approval has already been consumed", 409);
  }

  const updated = await tx.agentApproval.findUniqueOrThrow({
    where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.approvalId } },
  });

  await appendConsoleEvent(tx, {
    workspaceId: input.workspaceId,
    operationId: input.operationId,
    actorType: "user",
    actorUserId: input.actorUserId,
    type: "approval_consumed",
    payload: { approvalId: input.approvalId },
  });

  return updated;
}

export interface PublishOutboxInput {
  workspaceId: string;
  caseId: string;
  recipientUserId: string;
  deliveryKey: string;
  payload: Record<string, unknown>;
  channel?: string;
}

/** Publish a durable notification outbox item idempotently */
export async function publishNotificationOutbox(
  tx: ConsoleTransaction,
  input: PublishOutboxInput
) {
  const existing = await tx.agentNotificationOutbox.findFirst({
    where: { workspaceId: input.workspaceId, deliveryKey: input.deliveryKey },
  });
  if (existing) {
    const existingPayloadStr = canonicalJsonStringify(existing.payload);
    const inputPayloadStr = canonicalJsonStringify(input.payload);

    if (
      existing.caseId === input.caseId &&
      existing.recipientUserId === input.recipientUserId &&
      existing.channel === (input.channel ?? "in_app") &&
      existingPayloadStr === inputPayloadStr
    ) {
      return { outbox: existing, created: false };
    }
    throw new AgentConsoleError("outbox_conflict", "Conflicting outbox notification payload for deliveryKey", 409);
  }

  const outbox = await tx.agentNotificationOutbox.create({
    data: {
      workspaceId: input.workspaceId,
      caseId: input.caseId,
      recipientUserId: input.recipientUserId,
      deliveryKey: input.deliveryKey,
      channel: input.channel ?? "in_app",
      payload: input.payload as unknown as Prisma.InputJsonValue,
      status: "pending",
    },
  });

  return { outbox, created: true };
}

export interface AppendConsoleEventInput {
  workspaceId: string;
  responsibilityId?: string;
  caseId?: string;
  operationId?: string;
  actorType?: string;
  actorUserId?: string;
  type: string;
  payload: Record<string, unknown>;
}

/** Append an audit event to AgentConsoleEvent with strictly monotonic workspace sequence */
export async function appendConsoleEvent(
  tx: ConsoleTransaction,
  input: AppendConsoleEventInput
) {
  // Use dedicated AgentEventSequence counter table to guarantee strictly monotonic sequences
  // that never reset or decrement even if audit events are pruned or deleted by retention policy
  const seqRecord = await tx.agentEventSequence.upsert({
    where: { workspaceId: input.workspaceId },
    update: { lastSequence: { increment: 1 } },
    create: { workspaceId: input.workspaceId, lastSequence: 1 },
    select: { lastSequence: true },
  });
  const nextSequence = seqRecord.lastSequence;

  return tx.agentConsoleEvent.create({
    data: {
      workspaceId: input.workspaceId,
      responsibilityId: input.responsibilityId,
      caseId: input.caseId,
      operationId: input.operationId,
      actorType: input.actorType ?? "system",
      actorUserId: input.actorUserId,
      type: input.type,
      payload: input.payload as unknown as Prisma.InputJsonValue,
      sequence: nextSequence,
    },
  });
}

export interface CleanupRetentionInput {
  workspaceId: string;
  evidenceRetentionCutoff: Date;
  eventRetentionCutoff: Date;
  evidencePurgeCutoff?: Date;
  batchSize?: number;
}

/** Run retention cleanup: bounded batch execution distinguishing evidence expiration marking from physical purge */
export async function cleanupRetention(
  tx: ConsoleTransaction,
  input: CleanupRetentionInput
) {
  const batchLimit = input.batchSize ?? 500;

  // Phase 1: Mark evidence snapshots expired (labels unavailable, retains metadata record)
  const candidateExpired = await tx.agentEvidenceSnapshot.findMany({
    where: {
      workspaceId: input.workspaceId,
      createdAt: { lt: input.evidenceRetentionCutoff },
      isExpired: false,
    },
    take: batchLimit,
    select: { id: true },
  });
  let expiredEvidenceCount = 0;
  if (candidateExpired.length > 0) {
    const expiredRes = await tx.agentEvidenceSnapshot.updateMany({
      where: {
        workspaceId: input.workspaceId,
        id: { in: candidateExpired.map((c) => c.id) },
      },
      data: {
        isExpired: true,
      },
    });
    expiredEvidenceCount = expiredRes.count;
  }

  // Phase 2: Physical purge of older expired evidence snapshots (if purge cutoff supplied)
  let purgedEvidenceCount = 0;
  if (input.evidencePurgeCutoff) {
    const candidatePurge = await tx.agentEvidenceSnapshot.findMany({
      where: {
        workspaceId: input.workspaceId,
        createdAt: { lt: input.evidencePurgeCutoff },
        isExpired: true,
      },
      take: batchLimit,
      select: { id: true },
    });
    if (candidatePurge.length > 0) {
      const purged = await tx.agentEvidenceSnapshot.deleteMany({
        where: {
          workspaceId: input.workspaceId,
          id: { in: candidatePurge.map((c) => c.id) },
        },
      });
      purgedEvidenceCount = purged.count;
    }
  }

  // Phase 3: Purge audit events older than eventRetentionCutoff
  const candidateEvents = await tx.agentConsoleEvent.findMany({
    where: {
      workspaceId: input.workspaceId,
      createdAt: { lt: input.eventRetentionCutoff },
    },
    take: batchLimit,
    select: { id: true },
  });
  let deletedEventsCount = 0;
  if (candidateEvents.length > 0) {
    const deletedEvents = await tx.agentConsoleEvent.deleteMany({
      where: {
        workspaceId: input.workspaceId,
        id: { in: candidateEvents.map((c) => c.id) },
      },
    });
    deletedEventsCount = deletedEvents.count;
  }

  return {
    expiredEvidenceCount,
    purgedEvidenceCount,
    deletedEventsCount,
  };
}

export interface ReconcileLostLeasesInput {
  workspaceId: string;
  now?: Date;
}

/**
 * Reconciles lost operation leases and crashes after submission:
 * Finds running operations whose lease has expired, increments attempts,
 * resets to 'queued' if attempts < maxAttempts, or transitions to 'failed' if attempts exhausted.
 * Preserves existing jobReference and recovery identity across retries.
 */
export async function reconcileLostOperationLeases(
  tx: ConsoleTransaction,
  input: ReconcileLostLeasesInput
) {
  const now = input.now ?? new Date();
  const lostOps = await tx.agentOperation.findMany({
    where: {
      workspaceId: input.workspaceId,
      state: "running",
      leaseExpiresAt: { lt: now },
    },
  });

  let requeuedCount = 0;
  let failedCount = 0;

  for (const op of lostOps) {
    const nextAttempts = op.attempts + 1;
    if (nextAttempts >= op.maxAttempts) {
      await tx.agentOperation.update({
        where: { workspaceId_id: { workspaceId: input.workspaceId, id: op.id } },
        data: {
          state: "failed",
          attempts: nextAttempts,
          leaseOwner: null,
          leaseExpiresAt: null,
          error: { reason: "lease_expired_attempts_exhausted", message: "Worker lease expired and max retry attempts exhausted" },
          version: { increment: 1 },
        },
      });
      await appendConsoleEvent(tx, {
        workspaceId: input.workspaceId,
        caseId: op.caseId ?? undefined,
        operationId: op.id,
        actorType: "system",
        type: "operation_failed_lost_lease",
        payload: { attempts: nextAttempts, maxAttempts: op.maxAttempts, jobReference: op.jobReference },
      });
      failedCount++;
    } else {
      await tx.agentOperation.update({
        where: { workspaceId_id: { workspaceId: input.workspaceId, id: op.id } },
        data: {
          state: "queued",
          attempts: nextAttempts,
          leaseOwner: null,
          leaseExpiresAt: null,
          version: { increment: 1 },
        },
      });
      await appendConsoleEvent(tx, {
        workspaceId: input.workspaceId,
        caseId: op.caseId ?? undefined,
        operationId: op.id,
        actorType: "system",
        type: "operation_requeued_lost_lease",
        payload: { attempts: nextAttempts, maxAttempts: op.maxAttempts, jobReference: op.jobReference },
      });
      requeuedCount++;
    }
  }

  return {
    reconciledTotal: lostOps.length,
    requeuedCount,
    failedCount,
  };
}

export interface FencedOperationUpdateInput {
  workspaceId: string;
  operationId: string;
  workerId: string;
  data: Prisma.AgentOperationUpdateInput;
}

/**
 * Updates an operation strictly guarded by worker lease fencing:
 * Fails closed if the lease has expired or the lease is held by another worker.
 */
export async function updateOperationWithFencedLease(
  tx: ConsoleTransaction,
  input: FencedOperationUpdateInput
) {
  const op = await tx.agentOperation.findFirst({
    where: { id: input.operationId, workspaceId: input.workspaceId },
  });

  if (!op) {
    throw new AgentConsoleError("operation_not_found", "Operation not found in workspace", 404);
  }

  const now = new Date();
  if (!op.leaseOwner || op.leaseOwner !== input.workerId) {
    throw new AgentConsoleError(
      "lease_fencing_conflict",
      `Stale worker write rejected: lease is owned by '${op.leaseOwner ?? "nobody"}', expected '${input.workerId}'`,
      409
    );
  }

  if (!op.leaseExpiresAt || op.leaseExpiresAt < now) {
    throw new AgentConsoleError(
      "lease_fencing_conflict",
      `Stale worker write rejected: lease expired at ${op.leaseExpiresAt?.toISOString() ?? "unknown"}`,
      409
    );
  }

  const changed = await tx.agentOperation.updateMany({
    where: {
      workspaceId: input.workspaceId,
      id: input.operationId,
      version: op.version,
      leaseOwner: input.workerId,
      leaseExpiresAt: { gt: now },
      state: "running",
    },
    data: { ...input.data, version: { increment: 1 } },
  });
  if (changed.count !== 1) {
    throw new AgentConsoleError("lease_fencing_conflict", "Stale worker write rejected: lease changed during update", 409);
  }
  return tx.agentOperation.findFirstOrThrow({
    where: { workspaceId: input.workspaceId, id: input.operationId },
  });
}
