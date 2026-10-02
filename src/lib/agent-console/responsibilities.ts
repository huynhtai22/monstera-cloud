import { z } from "zod";
import { createHash } from "node:crypto";
import {
  agentConsoleTransaction,
  requireWorkspaceRole,
  createResponsibility,
  setResponsibilityScope,
  confirmResponsibility,
  updateResponsibilityStatus,
  AgentConsoleError,
  canonicalJsonStringify,
  appendConsoleEvent,
  type ConsoleTransaction,
} from "./persistence";
import { safeDecrypt } from "@/lib/encryption";
import { parseConnectionCredentialsJson } from "@/lib/parse-connection-credentials";
import { authorizedConnectionAccountIds, validateConnectionAccountSelection, type AccountSelectionProvider } from "@/lib/connection-account-selection";
import { isAgentConsoleMonitoringAvailable } from "./availability";

export const CreateResponsibilitySchema = z.object({
  workspaceId: z.string().min(1),
  draftRequestId: z.string().uuid().optional(),
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

async function validateDataHealthDraftScope(tx: ConsoleTransaction, input: { workspaceId: string; scopeItems?: NonNullable<CreateResponsibilityInputDto["scopeItems"]> }) {
  if (input.scopeItems?.length) {
    const supportedProviders: AccountSelectionProvider[] = ["meta_ads", "google_ads", "tiktok_business"];
    for (const item of input.scopeItems) {
      if (!supportedProviders.includes(item.provider as AccountSelectionProvider)) {
        throw new AgentConsoleError("account_scope_unverified", `Account selection is not supported for provider '${item.provider}'`, 400);
      }
      const connection = await tx.connection.findFirst({
        where: { id: item.connectionId, workspaceId: input.workspaceId },
        select: { provider: true, credentials: true },
      });
      if (!connection || connection.provider !== item.provider) {
        throw new AgentConsoleError("connection_not_found", `Connection '${item.connectionId}' does not match the selected provider`, 404);
      }
      let credentials: Record<string, unknown>;
      try {
        credentials = parseConnectionCredentialsJson(safeDecrypt(connection.credentials)) as Record<string, unknown>;
      } catch {
        throw new AgentConsoleError("account_scope_unverified", `Could not verify the saved account list for '${item.connectionId}'. Reconnect or refresh this source first.`, 409);
      }
      const authorizedIds = authorizedConnectionAccountIds(item.provider as AccountSelectionProvider, credentials);
      const selection = validateConnectionAccountSelection({
        provider: item.provider as AccountSelectionProvider,
        selectedIds: [item.providerAccountId],
        authorizedIds,
      });
      if (!selection.ok || selection.selectedIds[0] !== item.providerAccountId) {
        throw new AgentConsoleError("account_scope_unverified", `Account '${item.providerAccountId}' is not in the saved authorized account list for '${item.connectionId}'`, 400);
      }
    }
  }

}

export async function createResponsibilityDraft(
  userId: string,
  rawInput: unknown
) {
  const input = CreateResponsibilitySchema.parse(rawInput);
  if (input.kind === "data_health" && input.cadence !== "daily") {
    throw new AgentConsoleError("unsupported_cadence", "Connected data health checks currently support daily cadence only", 400);
  }

  return agentConsoleTransaction(async (tx) => {
    await requireWorkspaceRole(tx, input.workspaceId, userId, ["owner", "admin", "member"]);

    const requestHash = createHash("sha256").update(canonicalJsonStringify(input)).digest("hex");
    if (input.kind === "data_health" && input.draftRequestId) {
      const existing = await tx.agentResponsibility.findFirst({
        where: { workspaceId: input.workspaceId, createdByUserId: userId, kind: "data_health",
          configuration: { path: ["draftRequestId"], equals: input.draftRequestId } },
      });
      if (existing) {
        const config = existing.configuration as Record<string, unknown>;
        if (config.draftRequestHash !== requestHash) {
          throw new AgentConsoleError("idempotency_conflict", "This draft request already saved different choices. Refresh before trying again.", 409);
        }
        const scopes = await tx.agentResponsibilityScope.findMany({ where: {
          workspaceId: input.workspaceId, responsibilityId: existing.id, scopeRevision: existing.scopeRevision,
        } });
        return { responsibility: existing, scopes };
      }
    }
    if (input.kind === "data_health") await validateDataHealthDraftScope(tx, input);

    const responsibility = await createResponsibility(tx, {
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      ownerId: input.ownerId ?? userId,
      createdByUserId: userId,
      kind: input.kind,
      configuration: input.kind === "data_health" && input.draftRequestId
        ? { ...input.configuration, draftRequestId: input.draftRequestId, draftRequestHash: requestHash }
        : input.configuration,
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

export const UpdateDataHealthDraftSchema = z.object({
  workspaceId: z.string().min(1),
  expectedVersion: z.number().int().min(0),
  scopeItems: CreateResponsibilitySchema.shape.scopeItems.unwrap().min(1),
});

/** Editing setup saves a new scope revision; it never creates execution authority. */
export async function updateDataHealthDraft(userId: string, responsibilityId: string, rawInput: unknown) {
  const input = UpdateDataHealthDraftSchema.parse(rawInput);
  return agentConsoleTransaction(async tx => {
    const membership = await requireWorkspaceRole(tx, input.workspaceId, userId, ["owner", "admin", "member"]);
    const draft = await tx.agentResponsibility.findFirst({ where: { id: responsibilityId, workspaceId: input.workspaceId } });
    if (!draft) throw new AgentConsoleError("responsibility_not_found", "Saved setup not found", 404);
    if (membership === "member" && draft.createdByUserId !== userId) {
      throw new AgentConsoleError("forbidden", "Only the setup author or a workspace admin can change this draft", 403);
    }
    if (draft.status !== "draft" || draft.kind !== "data_health") {
      throw new AgentConsoleError("draft_only", "This responsibility is no longer a draft. Refresh to review its current policy.", 409);
    }
    if (draft.version !== input.expectedVersion) throw new AgentConsoleError("stale_version", "Saved setup changed. Refresh before saving.", 409);
    await validateDataHealthDraftScope(tx, input);
    const revision = draft.scopeRevision + 1;
    const updated = await tx.agentResponsibility.updateMany({
      where: { workspaceId: input.workspaceId, id: responsibilityId, version: input.expectedVersion, status: "draft" },
      data: { scopeRevision: revision, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new AgentConsoleError("stale_version", "Saved setup changed. Refresh before saving.", 409);
    const scopes = await setResponsibilityScope(tx, { workspaceId: input.workspaceId, responsibilityId, scopeRevision: revision, items: input.scopeItems });
    await appendConsoleEvent(tx, { workspaceId: input.workspaceId, responsibilityId, type: "responsibility_draft_updated",
      actorType: "user", actorUserId: userId, payload: { scopeRevision: revision, accountCount: scopes.length } });
    const responsibility = await tx.agentResponsibility.findUniqueOrThrow({ where: { workspaceId_id: { workspaceId: input.workspaceId, id: responsibilityId } } });
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
    if (!isAgentConsoleMonitoringAvailable(input.workspaceId)) {
      throw new AgentConsoleError(
        "monitoring_unavailable",
        "Connected data monitoring cannot be started until its scheduled worker is enabled",
        503
      );
    }

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

    if (input.action === "resume" && !isAgentConsoleMonitoringAvailable(input.workspaceId)) {
      throw new AgentConsoleError(
        "monitoring_unavailable",
        "Connected data monitoring cannot be resumed until its scheduled worker is enabled",
        503
      );
    }

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
