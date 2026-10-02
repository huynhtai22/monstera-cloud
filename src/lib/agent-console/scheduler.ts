import prisma from "@/lib/prisma";
import {
  agentConsoleTransaction,
  recordEvaluation,
  openOrUpdateCase,
  resolveCase,
  AgentConsoleError,
  type ConsoleTransaction,
} from "./persistence";
import { resolveSourceHealthState, SOURCE_HEALTH_STALE_AFTER_MS } from "@/lib/source-health";
import { verifyTargetDataHealthAndCoverage } from "./recovery";

export interface ScheduledCheckOptions {
  workspaceId: string;
  responsibilityId: string;
  scheduledSlot?: Date;
  now?: Date;
  asOf?: Date;
  isSyntheticTest?: boolean;
}

export interface CheckExecutionOutcome {
  status: "success" | "incident_detected" | "delayed" | "paused" | "error";
  qualityCode: string | null;
  blockerCode: string | null;
  caseOpenedOrUpdated: boolean;
  caseResolved: boolean;
  caseId?: string;
  details: Record<string, unknown>;
}

/**
 * Executes a durable scheduled check for an active data health responsibility.
 * Enforces:
 * - Responsibility must be active (paused returns early with status "paused")
 * - Valid active authorization policy
 * - Scoped connections check: detects connection failure, stale sync, missing sync, partial sync, expired credentials
 * - Deduplicated actionable case creation via openOrUpdateCase
 * - If healthy and open case exists, checks actual restored health & coverage before resolving
 * - Idempotent replay for same scheduledSlot
 */
export async function executeScheduledDataHealthCheck(
  options: ScheduledCheckOptions,
  client?: any
): Promise<CheckExecutionOutcome> {
  const runner = client ?? prisma;
  const now = options.now ?? new Date();
  const scheduledSlot = options.scheduledSlot ?? new Date(Math.floor(now.getTime() / 86400000) * 86400000);
  const staleBefore = new Date(now.getTime() - SOURCE_HEALTH_STALE_AFTER_MS);

  return agentConsoleTransaction(async (tx: ConsoleTransaction) => {
    // 1. Load responsibility with current scope items
    const resp = await tx.agentResponsibility.findFirst({
      where: { id: options.responsibilityId, workspaceId: options.workspaceId },
      include: {
        scopes: {
          where: { scopeRevision: { gt: 0 } },
        },
      },
    });

    if (!resp) {
      throw new AgentConsoleError("responsibility_not_found", "Responsibility not found in workspace", 404);
    }

    if (resp.status === "paused" || resp.status === "disabled") {
      return {
        status: "paused",
        qualityCode: null,
        blockerCode: "RESPONSIBILITY_PAUSED",
        caseOpenedOrUpdated: false,
        caseResolved: false,
        details: { status: resp.status, reason: "Responsibility is not active" },
      };
    }

    // 2. Load active authorization
    const activeAuth = await tx.agentAuthorization.findFirst({
      where: {
        workspaceId: options.workspaceId,
        responsibilityId: resp.id,
        policyRevision: resp.policyRevision,
        revokedAt: null,
      },
    });

    if (!activeAuth || (activeAuth.expiresAt && activeAuth.expiresAt < now)) {
      // Authorization missing or expired -> blocker
      await tx.agentResponsibility.update({
        where: { workspaceId_id: { workspaceId: options.workspaceId, id: resp.id } },
        data: {
          lastAttemptedAt: now,
          nextDueAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      });

      const blockerCode = !activeAuth ? "AUTHORIZATION_REQUIRED" : "AUTHORIZATION_EXPIRED";
      const evalResult = await recordEvaluation(tx, {
        workspaceId: options.workspaceId,
        responsibilityId: resp.id,
        configVersion: resp.version,
        scopeRevision: resp.scopeRevision,
        policyRevision: resp.policyRevision,
        scheduledSlot,
        status: "failed",
        qualityCode: "CHECK_UNAVAILABLE",
        blockerCode,
        result: { error: "Active authorization policy required to execute check" },
      });

      const caseRes = await openOrUpdateCase(tx, {
        workspaceId: options.workspaceId,
        clientId: resp.clientId,
        responsibilityId: resp.id,
        evaluationId: evalResult.evaluation.id,
        fingerprint: `fp:auth_expired:${resp.id}`,
        type: "source_health",
        priority: "high",
        title: "Agent authorization expired or missing",
        description: "Re-authorize this responsibility to resume automated health checks and recovery.",
        requiredAction: "reconnect",
      });

      return {
        status: "incident_detected",
        qualityCode: "CHECK_UNAVAILABLE",
        blockerCode,
        caseOpenedOrUpdated: true,
        caseResolved: false,
        caseId: caseRes.caseRecord.id,
        details: { error: blockerCode },
      };
    }

    // 3. Inspect scoped connections
    const currentScopes = resp.scopes.filter((s) => s.scopeRevision === resp.scopeRevision);
    if (currentScopes.length === 0) {
      throw new AgentConsoleError("empty_scope", "Responsibility has no scope items", 400);
    }

    const scopedConnectionIds = Array.from(new Set(currentScopes.map((s) => s.connectionId)));
    const connections = await tx.connection.findMany({
      where: {
        workspaceId: options.workspaceId,
        id: { in: scopedConnectionIds },
      },
    });

    const detectedProblems: Array<{
      connectionId: string;
      provider: string;
      healthState: string;
      title: string;
      description: string;
      requiredAction: "reconnect" | "recovery_import" | "review";
      fingerprint: string;
    }> = [];

    for (const connectionId of scopedConnectionIds) {
      const scope = currentScopes.find(item => item.connectionId === connectionId)!;
      const conn = connections.find((c) => c.id === scope.connectionId);
      if (!conn) {
        detectedProblems.push({
          connectionId: scope.connectionId,
          provider: scope.provider,
          healthState: "missing",
          title: `Connection missing: ${scope.provider}`,
          description: `Scoped connection '${scope.connectionId}' was not found in the workspace.`,
          requiredAction: "reconnect",
          fingerprint: `fp:source_health:${scope.connectionId}:${scope.providerAccountId}`,
        });
        continue;
      }

      const healthState = resolveSourceHealthState({
        connectionStatus: conn.status,
        lastError: conn.lastError,
        lastSyncAt: conn.lastSyncAt,
        now,
        staleBefore,
      });

      if (healthState !== "fresh") {
        const isAuthExpired =
          conn.status === "disconnected" ||
          /token.*expired|invalid.*token|reauth|grant_type|unauthorized/i.test(conn.lastError ?? "");

        const title = isAuthExpired
          ? `${conn.name || scope.provider} access expired`
          : healthState === "partial"
          ? `${conn.name || scope.provider} import partially failed`
          : healthState === "error"
          ? `${conn.name || scope.provider} sync failed`
          : `${conn.name || scope.provider} sync is stale`;

        const description = conn.lastError || (healthState === "stale" ? "Last sync is older than 24 hours" : "Connection health degraded");

        detectedProblems.push({
          connectionId: conn.id,
          provider: conn.provider,
          healthState,
          title,
          description,
          requiredAction: isAuthExpired ? "reconnect" : "recovery_import",
          fingerprint: `fp:source_health:${conn.id}:${scope.providerAccountId}`,
        });
        continue;
      }
    }

    // 4. Record evaluation and manage case
    if (detectedProblems.length > 0) {
      const detectedProblem = detectedProblems[0];
      await tx.agentResponsibility.update({
        where: { workspaceId_id: { workspaceId: options.workspaceId, id: resp.id } },
        data: {
          lastAttemptedAt: now,
          nextDueAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      });

      const evalResult = await recordEvaluation(tx, {
        workspaceId: options.workspaceId,
        responsibilityId: resp.id,
        configVersion: resp.version,
        scopeRevision: resp.scopeRevision,
        policyRevision: resp.policyRevision,
        scheduledSlot,
        status: "finding_detected",
        qualityCode: detectedProblem.healthState === "stale" ? "DATA_STALE" : "CHECK_UNAVAILABLE",
        blockerCode: detectedProblem.healthState.toUpperCase(),
        result: {
          problem: detectedProblem,
          problems: detectedProblems,
          inspectedAt: scheduledSlot.toISOString(),
        },
      });

      const caseIds: string[] = [];
      for (const problem of detectedProblems) {
        const caseRes = await openOrUpdateCase(tx, {
          workspaceId: options.workspaceId, clientId: resp.clientId, responsibilityId: resp.id,
          evaluationId: evalResult.evaluation.id, fingerprint: problem.fingerprint, type: "source_health",
          priority: "high", title: problem.title, description: problem.description, requiredAction: problem.requiredAction,
        });
        caseIds.push(caseRes.caseRecord.id);
      }

      return {
        status: "incident_detected",
        qualityCode: evalResult.evaluation.qualityCode,
        blockerCode: evalResult.evaluation.blockerCode,
        caseOpenedOrUpdated: true,
        caseResolved: false,
        caseId: caseIds[0],
        details: { problem: detectedProblem, problems: detectedProblems, caseIds },
      };
    }

    // 5. All scoped sources are healthy!
    await tx.agentResponsibility.update({
      where: { workspaceId_id: { workspaceId: options.workspaceId, id: resp.id } },
      data: {
        lastAttemptedAt: now,
        lastSuccessfulAt: now,
        nextDueAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      },
    });

    await recordEvaluation(tx, {
      workspaceId: options.workspaceId,
      responsibilityId: resp.id,
      configVersion: resp.version,
      scopeRevision: resp.scopeRevision,
      policyRevision: resp.policyRevision,
      scheduledSlot,
      status: "no_finding",
      qualityCode: null,
      blockerCode: null,
      result: {
        allHealthy: true,
        connectionCount: connections.length,
        inspectedAt: now.toISOString(),
      },
    });

    // Check if there are open source_health cases for this responsibility that can now be verified resolved
    const openCases = await tx.agentCase.findMany({
      where: {
        workspaceId: options.workspaceId,
        responsibilityId: resp.id,
        type: "source_health",
        state: { not: "resolved" },
      },
    });

    let resolvedCount = 0;
    for (const openCase of openCases) {
      // Resolve target connection and accounts from case fingerprint (fp:source_health:conn_id:account_id) or responsibility scopes
      let targetConnectionId: string | null = null;
      let targetAccountIds: string[] = [];

      if (openCase.fingerprint && openCase.fingerprint.startsWith("fp:source_health:")) {
        const parts = openCase.fingerprint.split(":");
        targetConnectionId = parts[2] || null;
        if (parts[3]) {
          targetAccountIds = [parts[3]];
        }
      }

      if (openCase.fingerprint?.startsWith("fp:conn_missing:")) {
        targetConnectionId = openCase.fingerprint.slice("fp:conn_missing:".length);
      }
      if (!targetConnectionId) {
        // Fall back to first connection in active scope
        targetConnectionId = currentScopes[0]?.connectionId ?? null;
        targetAccountIds = currentScopes.filter((s) => s.connectionId === targetConnectionId).map((s) => s.providerAccountId);
      } else if (targetAccountIds.length === 0) {
        targetAccountIds = currentScopes.filter((s) => s.connectionId === targetConnectionId).map((s) => s.providerAccountId);
      }

      if (!targetConnectionId || targetAccountIds.length === 0) {
        continue;
      }

      // Authoritative verification: require actual data-through coverage and warehouse rows / zero receipts
      const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
      const verification = await verifyTargetDataHealthAndCoverage(tx, {
        workspaceId: options.workspaceId,
        connectionId: targetConnectionId,
        accountIds: targetAccountIds,
        expectedUntil: yesterday,
      });

      if (verification.verified) {
        await resolveCase(tx, {
          workspaceId: options.workspaceId,
          caseId: openCase.id,
          expectedVersion: openCase.version,
          resolutionType: "automated_recovery",
          resolutionReason: "Verified healthy source sync and required coverage confirmed by scheduled check",
          isSystemVerifier: true,
        });
        resolvedCount++;
      }
    }

    return {
      status: "success",
      qualityCode: null,
      blockerCode: null,
      caseOpenedOrUpdated: false,
      caseResolved: resolvedCount > 0,
      details: {
        connectionsChecked: connections.length,
        casesResolved: resolvedCount,
      },
    };
  }, runner);
}
