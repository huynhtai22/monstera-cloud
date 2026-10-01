import { z } from "zod";
import {
  agentConsoleTransaction,
  requireWorkspaceRole,
  createResponsibility,
  setResponsibilityScope,
  confirmResponsibility,
  updateResponsibilityStatus,
  AgentConsoleError,
} from "./persistence";

export const CreateResponsibilitySchema = z.object({
  workspaceId: z.string().min(1),
  clientId: z.string().nullable().optional(),
  ownerId: z.string().optional(),
  kind: z.string().default("monitoring"),
  configuration: z.record(z.string(), z.unknown()),
  cadence: z.string().default("daily"),
  timezone: z.string().default("UTC"),
  scopeItems: z.array(
    z.object({
      connectionId: z.string().min(1),
      provider: z.string().min(1),
      providerAccountId: z.string().min(1),
      accountName: z.string().optional(),
      currency: z.string().optional(),
      timezone: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
  ).optional(),
});

export type CreateResponsibilityInputDto = z.infer<typeof CreateResponsibilitySchema>;

export async function createResponsibilityDraft(
  userId: string,
  rawInput: unknown
) {
  const input = CreateResponsibilitySchema.parse(rawInput);

  return agentConsoleTransaction(async (tx) => {
    await requireWorkspaceRole(tx, input.workspaceId, userId, ["owner", "admin", "member"]);

    const responsibility = await createResponsibility(tx, {
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      ownerId: input.ownerId ?? userId,
      createdByUserId: userId,
      kind: input.kind,
      configuration: input.configuration,
      cadence: input.cadence,
      timezone: input.timezone,
    });

    let scopes: unknown[] = [];
    if (input.scopeItems && input.scopeItems.length > 0) {
      scopes = await setResponsibilityScope(tx, {
        workspaceId: input.workspaceId,
        responsibilityId: responsibility.id,
        scopeRevision: 1,
        items: input.scopeItems,
      });

      // Update responsibility with initial scope revision
      await tx.agentResponsibility.update({
        where: { workspaceId_id: { workspaceId: input.workspaceId, id: responsibility.id } },
        data: { scopeRevision: 1 },
      });
    }

    return { responsibility, scopes };
  });
}

export async function listResponsibilities(
  userId: string,
  query: { workspaceId: string; clientId?: string | null }
) {
  if (!query.workspaceId) {
    throw new AgentConsoleError("invalid_input", "workspaceId query parameter is required", 400);
  }

  return agentConsoleTransaction(async (tx) => {
    await requireWorkspaceRole(tx, query.workspaceId, userId, ["owner", "admin", "member", "viewer"]);

    const responsibilities = await tx.agentResponsibility.findMany({
      where: {
        workspaceId: query.workspaceId,
        ...(query.clientId ? { clientId: query.clientId } : {}),
      },
      include: {
        scopes: {
          orderBy: { createdAt: "desc" },
        },
        evaluations: {
          orderBy: { scheduledSlot: "desc" },
          take: 1,
        },
        authorizations: {
          where: { revokedAt: null },
          orderBy: { policyRevision: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      responsibilities: responsibilities.map((r) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        clientId: r.clientId,
        ownerId: r.ownerId,
        kind: r.kind,
        status: r.status,
        cadence: r.cadence,
        timezone: r.timezone,
        version: r.version,
        scopeRevision: r.scopeRevision,
        policyRevision: r.policyRevision,
        scopeHash: r.scopeHash,
        nextDueAt: r.nextDueAt,
        lastAttemptedAt: r.lastAttemptedAt,
        lastSuccessfulAt: r.lastSuccessfulAt,
        configuration: r.configuration,
        scopes: r.scopes,
        latestEvaluation: r.evaluations[0] ?? null,
        activeAuthorization: r.authorizations[0] ?? null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  });
}

export const ConfirmResponsibilitySchema = z.object({
  workspaceId: z.string().min(1),
  expectedVersion: z.number().int().min(0),
  scopeHash: z.string().min(1),
  allowlistedTools: z.array(z.string()).min(1),
  allowedPairs: z.array(
    z.object({
      provider: z.string().min(1),
      connectionId: z.string().min(1),
      providerAccountId: z.string().min(1),
    })
  ).min(1),
  limits: z.record(z.string(), z.unknown()).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export async function confirmResponsibilityAction(
  userId: string,
  responsibilityId: string,
  rawInput: unknown
) {
  const input = ConfirmResponsibilitySchema.parse(rawInput);

  return agentConsoleTransaction(async (tx) => {
    // Only owner or admin can authorize policy and activate responsibility
    await requireWorkspaceRole(tx, input.workspaceId, userId, ["owner", "admin"]);

    const result = await confirmResponsibility(tx, {
      workspaceId: input.workspaceId,
      responsibilityId,
      expectedVersion: input.expectedVersion,
      scopeHash: input.scopeHash,
      authorizingUserId: userId,
      allowlistedTools: input.allowlistedTools,
      allowedPairs: input.allowedPairs,
      limits: input.limits,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    });

    return result;
  });
}

export const ResponsibilityActionSchema = z.object({
  workspaceId: z.string().min(1),
  expectedVersion: z.number().int().min(0),
  action: z.enum(["pause", "resume", "disable", "update_scope"]),
  reason: z.string().optional(),
  scopeItems: z.array(
    z.object({
      connectionId: z.string().min(1),
      provider: z.string().min(1),
      providerAccountId: z.string().min(1),
      accountName: z.string().optional(),
      currency: z.string().optional(),
      timezone: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
  ).optional(),
});

export async function handleResponsibilityAction(
  userId: string,
  responsibilityId: string,
  rawInput: unknown
) {
  const input = ResponsibilityActionSchema.parse(rawInput);

  return agentConsoleTransaction(async (tx) => {
    await requireWorkspaceRole(tx, input.workspaceId, userId, ["owner", "admin"]);

    if (input.action === "pause" || input.action === "resume" || input.action === "disable") {
      const targetStatus = input.action === "resume" ? "active" : input.action === "pause" ? "paused" : "disabled";
      const updated = await updateResponsibilityStatus(tx, {
        workspaceId: input.workspaceId,
        responsibilityId,
        expectedVersion: input.expectedVersion,
        status: targetStatus,
        actorUserId: userId,
        reason: input.reason,
      });
      return { responsibility: updated };
    }

    if (input.action === "update_scope") {
      if (!input.scopeItems || input.scopeItems.length === 0) {
        throw new AgentConsoleError("invalid_input", "scopeItems must be provided to update scope", 400);
      }

      const resp = await tx.agentResponsibility.findFirst({
        where: { id: responsibilityId, workspaceId: input.workspaceId },
      });
      if (!resp) throw new AgentConsoleError("responsibility_not_found", "Responsibility not found", 404);
      if (resp.version !== input.expectedVersion) {
        throw new AgentConsoleError("stale_version", "Responsibility version changed; refresh before updating scope", 409);
      }

      const nextScopeRev = resp.scopeRevision + 1;
      const scopes = await setResponsibilityScope(tx, {
        workspaceId: input.workspaceId,
        responsibilityId,
        scopeRevision: nextScopeRev,
        items: input.scopeItems,
      });

      // Scope updates require re-confirmation; status moves to draft/paused until confirmed
      const updated = await tx.agentResponsibility.update({
        where: { workspaceId_id: { workspaceId: input.workspaceId, id: responsibilityId } },
        data: {
          scopeRevision: nextScopeRev,
          status: "paused",
          version: { increment: 1 },
        },
      });

      return { responsibility: updated, scopes };
    }

    throw new AgentConsoleError("unsupported_action", "Unsupported responsibility action", 400);
  });
}
