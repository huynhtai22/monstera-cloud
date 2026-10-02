import { z } from "zod";
import {
  agentConsoleTransaction,
  requireWorkspaceRole,
  resolveCase,
  enqueueOperation,
  appendConsoleEvent,
  computeCanonicalScopeHash,
  AgentConsoleError,
} from "./persistence";
import { sanitizeProvenance } from "./evidence";
import { InspectSourceInputSchema } from "./tools";
import { prepareCaseRecovery, executeRecoveryImportOperation } from "./recovery";

export const ListCasesQuerySchema = z.object({
  workspaceId: z.string().min(1),
  clientId: z.string().nullable().optional(),
  state: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function listCases(
  userId: string,
  rawQuery: unknown
) {
  const query = ListCasesQuerySchema.parse(rawQuery);

  return agentConsoleTransaction(async (tx) => {
    await requireWorkspaceRole(tx, query.workspaceId, userId, ["owner", "admin", "member", "viewer"]);

    const allClientMode = !query.clientId;

    const whereClause: Record<string, unknown> = {
      workspaceId: query.workspaceId,
    };

    if (query.clientId) {
      whereClause.clientId = query.clientId;
    }

    if (query.state === "open") {
      whereClause.state = { not: "resolved" };
    } else if (query.state) {
      whereClause.state = query.state;
    }

    // Validate cursor if provided
    if (query.cursor) {
      const cursorCase = await tx.agentCase.findFirst({
        where: { id: query.cursor, workspaceId: query.workspaceId },
      });
      if (!cursorCase) {
        throw new AgentConsoleError("invalid_cursor", "Pagination cursor not found in workspace", 400);
      }
    }

    const totalCount = await tx.agentCase.count({
      where: whereClause,
    });

    const cases = await tx.agentCase.findMany({
      where: whereClause,
      take: query.limit + 1,
      ...(query.cursor
        ? {
            cursor: { workspaceId_id: { workspaceId: query.workspaceId, id: query.cursor } },
            skip: 1,
          }
        : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        responsibility: {
          select: { id: true, kind: true, cadence: true },
        },
      },
    });

    let nextCursor: string | null = null;
    if (cases.length > query.limit) {
      cases.pop();
      nextCursor = cases[cases.length - 1]?.id ?? null;
    }

    return {
      cases,
      nextCursor,
      totalCount,
      allClientMode,
    };
  });
}

export async function getCaseDetail(
  userId: string,
  workspaceId: string,
  caseId: string
) {
  if (!workspaceId || !caseId) {
    throw new AgentConsoleError("invalid_input", "workspaceId and caseId are required", 400);
  }

  return agentConsoleTransaction(async (tx) => {
    await requireWorkspaceRole(tx, workspaceId, userId, ["owner", "admin", "member", "viewer"]);

    const caseRecord = await tx.agentCase.findFirst({
      where: { id: caseId, workspaceId },
      include: {
        responsibility: true,
        evaluation: true,
      },
    });

    if (!caseRecord) {
      throw new AgentConsoleError("case_not_found", "Case not found", 404);
    }

    let evidence = null;
    const evidenceId = caseRecord.evaluation?.evidenceId ?? caseRecord.resolutionEvidenceId;
    if (evidenceId) {
      const rawEvidence = await tx.agentEvidenceSnapshot.findFirst({
        where: { id: evidenceId, workspaceId },
      });

      if (rawEvidence) {
        if (rawEvidence.isExpired) {
          evidence = {
            id: rawEvidence.id,
            workspaceId: rawEvidence.workspaceId,
            datasetFingerprint: rawEvidence.datasetFingerprint,
            isExpired: true,
            retentionStatus: "marked_expired",
            message: "Evidence snapshot is expired and unavailable per retention policy",
            createdAt: rawEvidence.createdAt,
          };
        } else {
          evidence = {
            id: rawEvidence.id,
            workspaceId: rawEvidence.workspaceId,
            datasetFingerprint: rawEvidence.datasetFingerprint,
            grain: rawEvidence.grain,
            metrics: rawEvidence.metrics,
            inventory: rawEvidence.inventory,
            actualSince: rawEvidence.actualSince,
            actualUntil: rawEvidence.actualUntil,
            currencies: rawEvidence.currencies,
            timezones: rawEvidence.timezones,
            calculationVersion: rawEvidence.calculationVersion,
            provenance: sanitizeProvenance(rawEvidence.provenance),
            citations: sanitizeProvenance(rawEvidence.citations),
            isExpired: false,
            retentionStatus: "retained",
            createdAt: rawEvidence.createdAt,
          };
        }
      }
    }

    const events = await tx.agentConsoleEvent.findMany({
      where: { workspaceId, caseId },
      orderBy: { sequence: "asc" },
      take: 50,
    });

    const operations = await tx.agentOperation.findMany({
      where: { workspaceId, caseId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return {
      case: caseRecord,
      evidence,
      events,
      operations,
    };
  });
}

export const CaseActionSchema = z.object({
  workspaceId: z.string().min(1),
  expectedVersion: z.number().int().min(0),
  action: z.enum(["snooze", "assign", "manual_resolve", "investigate", "recover"]),
  snoozedUntil: z.string().datetime().optional(),
  ownerId: z.string().optional(),
  // Disallow automated_recovery from customer interactive actions to prevent false-resolution
  resolutionType: z.enum(["manual_resolved", "false_positive", "automated_recovery"]).optional(),
  resolutionReason: z.string().optional(),
  mode: z.enum(["retry_failed_window", "full_window_reimport"]).optional(),
  since: z.string().optional(),
  until: z.string().optional(),
});

export async function handleCaseAction(
  userId: string,
  caseId: string,
  rawInput: unknown
) {
  const input = CaseActionSchema.parse(rawInput);

  return agentConsoleTransaction(async (tx) => {
    await requireWorkspaceRole(tx, input.workspaceId, userId, ["owner", "admin", "member"]);

    const caseRecord = await tx.agentCase.findFirst({
      where: { id: caseId, workspaceId: input.workspaceId },
    });
    if (!caseRecord) throw new AgentConsoleError("case_not_found", "Case not found", 404);
    if (caseRecord.version !== input.expectedVersion) {
      throw new AgentConsoleError("stale_version", "Case changed; refresh before executing action", 409);
    }

    if (input.action === "snooze") {
      if (!input.snoozedUntil) {
        throw new AgentConsoleError("invalid_input", "snoozedUntil datetime is required to snooze", 400);
      }
      const snoozeDate = new Date(input.snoozedUntil);
      if (snoozeDate <= new Date()) {
        throw new AgentConsoleError("invalid_input", "snoozedUntil must be in the future", 400);
      }

      const updated = await tx.agentCase.update({
        where: { workspaceId_id: { workspaceId: input.workspaceId, id: caseId } },
        data: {
          snoozedUntil: snoozeDate,
          version: { increment: 1 },
        },
      });

      await appendConsoleEvent(tx, {
        workspaceId: input.workspaceId,
        caseId,
        actorType: "user",
        actorUserId: userId,
        type: "case_snoozed",
        payload: { snoozedUntil: input.snoozedUntil },
      });

      return { case: updated };
    }

    if (input.action === "assign") {
      if (!input.ownerId) {
        throw new AgentConsoleError("invalid_input", "ownerId is required to assign case", 400);
      }

      const assignee = await tx.workspaceMember.findFirst({
        where: { workspaceId: input.workspaceId, userId: input.ownerId },
      });
      if (!assignee) throw new AgentConsoleError("assignee_outside_workspace", "Assignee must belong to this workspace", 400);

      const updated = await tx.agentCase.update({
        where: { workspaceId_id: { workspaceId: input.workspaceId, id: caseId } },
        data: {
          ownerUserId: input.ownerId,
          version: { increment: 1 },
        },
      });

      await appendConsoleEvent(tx, {
        workspaceId: input.workspaceId,
        caseId,
        actorType: "user",
        actorUserId: userId,
        type: "case_assigned",
        payload: { assignedToUserId: input.ownerId },
      });

      return { case: updated };
    }

    if (input.action === "manual_resolve") {
      if (!input.resolutionReason || !input.resolutionReason.trim()) {
        throw new AgentConsoleError("resolution_reason_required", "A non-empty resolution reason is required for manual resolution", 400);
      }

      const updated = await resolveCase(tx, {
        workspaceId: input.workspaceId,
        caseId,
        expectedVersion: input.expectedVersion,
        resolutionType: input.resolutionType ?? "manual_resolved",
        resolutionReason: input.resolutionReason.trim(),
        actorUserId: userId,
        isSystemVerifier: false,
      });

      return { case: updated };
    }

    if (input.action === "investigate") {
      // 1. Context validation: case must be associated with a responsibility
      if (!caseRecord.responsibilityId) {
        throw new AgentConsoleError("unsupported_investigation", "Investigation requires an associated responsibility", 400);
      }

      const resp = await tx.agentResponsibility.findFirst({
        where: { id: caseRecord.responsibilityId, workspaceId: input.workspaceId },
      });
      if (!resp) {
        throw new AgentConsoleError("responsibility_not_found", "Associated responsibility not found in workspace", 404);
      }
      if (resp.status !== "active") {
        throw new AgentConsoleError("responsibility_not_active", "Associated responsibility is not active", 400);
      }

      // 2. Authorized target lookup & scope hash check: fetch active scope items
      const targetScopes = await tx.agentResponsibilityScope.findMany({
        where: {
          workspaceId: input.workspaceId,
          responsibilityId: resp.id,
          scopeRevision: resp.scopeRevision,
        },
      });
      if (targetScopes.length === 0) {
        throw new AgentConsoleError("missing_scope", "Responsibility has no scope items configured", 400);
      }

      const currentScopeHash = computeCanonicalScopeHash(
        targetScopes.map((s) => ({
          provider: s.provider,
          connectionId: s.connectionId,
          providerAccountId: s.providerAccountId,
        }))
      );
      if (currentScopeHash !== resp.scopeHash) {
        throw new AgentConsoleError("authorization_required", "Responsibility scope has changed since authorization", 400);
      }

      // 3. Active authorization check: policy must be active, not revoked, not expired, and match current scope
      const activeAuth = await tx.agentAuthorization.findFirst({
        where: {
          workspaceId: input.workspaceId,
          responsibilityId: resp.id,
          policyRevision: resp.policyRevision,
        },
      });
      if (!activeAuth) {
        throw new AgentConsoleError("authorization_required", "Responsibility lacks active authorization for investigation", 400);
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

      // 4. Recheck authorizer membership and role
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

      // 5. Tool allowlisting check
      if (!activeAuth.allowlistedTools.includes("inspect_source")) {
        throw new AgentConsoleError("tool_not_allowlisted", "Tool 'inspect_source' is not authorized in active policy", 403);
      }

      // 6. Target authorized check
      const targetScope = targetScopes[0];
      const allowedPairs = activeAuth.allowedPairs as Array<{ provider: string; connectionId: string; providerAccountId: string }>;
      const isTargetAuthorized = allowedPairs?.some(
        p => p.provider === targetScope.provider && p.connectionId === targetScope.connectionId && (p.providerAccountId === targetScope.providerAccountId || !targetScope.providerAccountId)
      );
      if (!isTargetAuthorized) {
        throw new AgentConsoleError("target_not_authorized", `Target connection '${targetScope.connectionId}' is not authorized in policy`, 403);
      }

      // 7. Build and validate tool arguments strictly through InspectSourceInputSchema
      const toolArgs = InspectSourceInputSchema.parse({
        workspaceId: input.workspaceId,
        connectionId: targetScope.connectionId,
        provider: targetScope.provider,
      });

      const updated = await tx.agentCase.update({
        where: { workspaceId_id: { workspaceId: input.workspaceId, id: caseId } },
        data: {
          state: "investigating",
          version: { increment: 1 },
        },
      });

      const { operation } = await enqueueOperation(tx, {
        workspaceId: input.workspaceId,
        caseId,
        operationKey: `inv_${caseId}_v${caseRecord.version}`,
        toolName: "inspect_source",
        arguments: toolArgs,
        scopeHash: resp.scopeHash ?? activeAuth.scopeHash,
        policyRevision: activeAuth.policyRevision,
      });

      await appendConsoleEvent(tx, {
        workspaceId: input.workspaceId,
        caseId,
        operationId: operation.id,
        actorType: "user",
        actorUserId: userId,
        type: "case_investigation_started",
        payload: { operationId: operation.id },
      });

      return { case: updated, operation };
    }

    if (input.action === "recover") {
      // 1. Prepare recovery using existing authorization boundary
      const prepOutcome = await prepareCaseRecovery(
        {
          workspaceId: input.workspaceId,
          caseId,
          userId,
          mode: input.mode,
          since: input.since,
          until: input.until,
        },
        tx
      );

      if (prepOutcome.actionType === "reconnect") {
        return {
          case: caseRecord,
          actionType: "reconnect",
          requiresReconnect: true,
          reconnectProvider: prepOutcome.reconnectProvider,
          reconnectConnectionId: prepOutcome.reconnectConnectionId,
          reason: prepOutcome.reason,
        };
      }

      // 2. Dispatch queued operation
      const op = prepOutcome.operation as { id: string } | undefined;
      if (!op || !op.id) {
        throw new AgentConsoleError("recovery_failed", "Failed to enqueue recovery operation", 500);
      }

      const dispatchResult = await executeRecoveryImportOperation(
        {
          workspaceId: input.workspaceId,
          operationId: op.id,
          userId,
        },
        tx
      );

      const refreshedCase = await tx.agentCase.findFirst({
        where: { id: caseId, workspaceId: input.workspaceId },
      });

      return {
        case: refreshedCase ?? caseRecord,
        actionType: "queued",
        requiresReconnect: false,
        operation: op,
        dispatch: dispatchResult,
      };
    }

    throw new AgentConsoleError("unsupported_action", "Unsupported case action", 400);
  });
}
