/**
 * Plan entitlement enforcement for the existing Paddle + Workspace.plan catalog.
 * Do not add a second billing system. Meter source connections and refresh, never destinations.
 */

import prisma from "@/lib/prisma";
import { canonicalizeRemoteAccountId } from "@/lib/connection-upsert";
import {
  getPlanLimits,
  suggestedUpgradePlan,
  workspaceAllowsScheduledRefresh,
  type PlanLimits,
} from "@/lib/plan-config";

export const PLAN_LIMIT_CODES = {
  ACCOUNT: "PLAN_ACCOUNT_LIMIT",
  SOURCE: "PLAN_SOURCE_LIMIT",
  WORKSPACE: "PLAN_WORKSPACE_LIMIT",
  SEAT: "PLAN_SEAT_LIMIT",
  LOOKER: "PLAN_LOOKER_BLOCKED",
  API_KEY: "PLAN_API_KEY_BLOCKED",
  CSV: "PLAN_CSV_BLOCKED",
  DESTINATION: "PLAN_DESTINATION_BLOCKED",
} as const;

export type PlanLimitCode = (typeof PLAN_LIMIT_CODES)[keyof typeof PLAN_LIMIT_CODES];

export class PlanLimitError extends Error {
  readonly code: PlanLimitCode;
  readonly statusCode = 403;
  readonly upgradeHref: string;

  constructor(code: PlanLimitCode, message: string, currentPlan = "free") {
    super(message);
    this.name = "PlanLimitError";
    this.code = code;
    this.upgradeHref = `/support?pilot=1&plan=${suggestedUpgradePlan(currentPlan)}`;
  }
}

export function toPlanLimitResponse(error: unknown): Response | null {
  if (!(error instanceof PlanLimitError)) return null;
  return Response.json(
    { error: error.message, code: error.code, upgradeHref: error.upgradeHref },
    { status: error.statusCode },
  );
}

export type SourceConnectDecision =
  | { ok: true; reason: "reconnect" | "within_limit" }
  | { ok: false; code: PlanLimitCode; message: string };

export type SourceConnectionSnapshot = {
  provider: string;
  remoteAccountId: string | null;
  credentials?: unknown;
};

function parseCredentials(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function identityKey(provider: string, remoteAccountId: string, credentials?: Record<string, unknown>): string {
  return `${provider}::${canonicalizeRemoteAccountId(provider, remoteAccountId, credentials)}`;
}

/**
 * Pure policy: workspace-total source Connection rows, not leaf ads inside a BM/MCC.
 * Reconnecting an existing identity never consumes a new slot.
 */
export function evaluateSourceConnectLimit(opts: {
  plan: string;
  existingSources: SourceConnectionSnapshot[];
  provider: string;
  remoteAccountId: string;
  credentials?: Record<string, unknown>;
}): SourceConnectDecision {
  const limits = getPlanLimits(opts.plan);
  const incomingKey = identityKey(opts.provider, opts.remoteAccountId, opts.credentials);
  const existingKeys = new Set(
    opts.existingSources.map((row) =>
      identityKey(row.provider, row.remoteAccountId ?? "", parseCredentials(row.credentials)),
    ),
  );
  if (existingKeys.has(incomingKey)) {
    return { ok: true, reason: "reconnect" };
  }

  if (limits.maxConnections !== Infinity && opts.existingSources.length >= limits.maxConnections) {
    return {
      ok: false,
      code: PLAN_LIMIT_CODES.ACCOUNT,
      message: `This workspace has reached the ${limits.displayName} account limit (${limits.maxConnections} source connections). Upgrade to connect another ad account.`,
    };
  }

  const providers = new Set(opts.existingSources.map((row) => row.provider));
  if (
    !providers.has(opts.provider) &&
    limits.maxSourceProviders !== Infinity &&
    providers.size >= limits.maxSourceProviders
  ) {
    return {
      ok: false,
      code: PLAN_LIMIT_CODES.SOURCE,
      message: `This workspace has reached the ${limits.displayName} source limit (${limits.maxSourceProviders} platforms). Upgrade to connect another source.`,
    };
  }

  return { ok: true, reason: "within_limit" };
}

export function evaluateLookerAccess(plan: string, auth: "jwt-sheets" | "api-key-looker"): boolean {
  if (auth === "jwt-sheets") return true;
  return getPlanLimits(plan).allowLooker;
}

export function evaluateApiKeyCreate(plan: string): boolean {
  return getPlanLimits(plan).allowApiKeys;
}

export function evaluateCsvExport(plan: string): boolean {
  return getPlanLimits(plan).allowCsvExport;
}

export function evaluateScheduledRefresh(plan: string): boolean {
  return workspaceAllowsScheduledRefresh(plan);
}

export function evaluateSeatLimit(opts: {
  plan: string;
  memberCount: number;
  pendingInvitationCount: number;
}): SourceConnectDecision {
  const limits = getPlanLimits(opts.plan);
  const used = opts.memberCount + opts.pendingInvitationCount;
  if (limits.maxSeats !== Infinity && used >= limits.maxSeats) {
    return {
      ok: false,
      code: PLAN_LIMIT_CODES.SEAT,
      message: `This workspace has reached the ${limits.displayName} seat limit (${limits.maxSeats}).`,
    };
  }
  return { ok: true, reason: "within_limit" };
}

export function evaluateWorkspaceCreateLimit(opts: {
  plan: string;
  ownedWorkspaceCount: number;
}): SourceConnectDecision {
  const limits = getPlanLimits(opts.plan);
  if (limits.maxWorkspaces !== Infinity && opts.ownedWorkspaceCount >= limits.maxWorkspaces) {
    return {
      ok: false,
      code: PLAN_LIMIT_CODES.WORKSPACE,
      message: `You have reached the ${limits.displayName} workspace limit (${limits.maxWorkspaces}).`,
    };
  }
  return { ok: true, reason: "within_limit" };
}

export function publicEntitlements(plan: string): PlanLimits {
  return getPlanLimits(plan);
}

export async function assertCanCreateSourceConnection(opts: {
  workspaceId: string;
  provider: string;
  remoteAccountId: string;
  credentials?: Record<string, unknown>;
}): Promise<void> {
  await assertCanCreateSourceConnections({
    workspaceId: opts.workspaceId,
    connections: [{
      provider: opts.provider,
      remoteAccountId: opts.remoteAccountId,
      credentials: opts.credentials,
    }],
  });
}

/**
 * Atomically preflight a set of source identities before OAuth writes any of
 * them. Google Ads can discover more than one unrelated MCC in a single
 * authorization; evaluating each against only the old database state would
 * otherwise allow a partial, over-limit write.
 */
export async function assertCanCreateSourceConnections(opts: {
  workspaceId: string;
  connections: Array<{
    provider: string;
    remoteAccountId: string;
    credentials?: Record<string, unknown>;
  }>;
}): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: opts.workspaceId },
    select: { plan: true },
  });
  const plan = workspace?.plan ?? "free";
  const existingSources = await prisma.connection.findMany({
    where: { workspaceId: opts.workspaceId, type: "source" },
    select: { provider: true, remoteAccountId: true, credentials: true },
  });

  const prospectiveSources: SourceConnectionSnapshot[] = [...existingSources];
  for (const connection of opts.connections) {
    const decision = evaluateSourceConnectLimit({
      plan,
      existingSources: prospectiveSources,
      provider: connection.provider,
      remoteAccountId: connection.remoteAccountId,
      credentials: connection.credentials,
    });
    if (!decision.ok) {
      throw new PlanLimitError(decision.code, decision.message, plan);
    }

    if (decision.reason !== "reconnect") {
      prospectiveSources.push({
        provider: connection.provider,
        remoteAccountId: connection.remoteAccountId,
        credentials: connection.credentials,
      });
    }
  }
}

export async function assertDestinationAllowed(opts: {
  workspaceId: string;
  provider: string;
}): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: opts.workspaceId },
    select: { plan: true },
  });
  const plan = workspace?.plan ?? "free";
  const limits = getPlanLimits(plan);
  if (opts.provider === "google_sheets") return;
  if (opts.provider === "looker_studio" || opts.provider === "looker") {
    if (!limits.allowLooker) {
      throw new PlanLimitError(
        PLAN_LIMIT_CODES.LOOKER,
        "Looker Studio is included on Studio and Agency. Upgrade to connect it — there is no extra destination fee.",
        plan,
      );
    }
    return;
  }
}

export async function assertLookerAllowed(opts: {
  plan: string;
  auth: "jwt-sheets" | "api-key-looker";
}): Promise<void> {
  if (evaluateLookerAccess(opts.plan, opts.auth)) return;
  throw new PlanLimitError(
    PLAN_LIMIT_CODES.LOOKER,
    "Looker Studio is included on Studio and Agency. The Start plan is Sheets-only — there is no extra destination fee on paid plans.",
    opts.plan,
  );
}

export async function assertCanCreateApiKey(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  });
  const plan = workspace?.plan ?? "free";
  if (!evaluateApiKeyCreate(plan)) {
    throw new PlanLimitError(
      PLAN_LIMIT_CODES.API_KEY,
      "API keys are included on Studio and Agency (Looker Studio uses a workspace key). Upgrade to create a key.",
      plan,
    );
  }
}

export async function assertCsvExportAllowed(plan: string): Promise<void> {
  if (evaluateCsvExport(plan)) return;
  throw new PlanLimitError(
    PLAN_LIMIT_CODES.CSV,
    "CSV and REST row export is included on Agency. Upgrade to export rows via API.",
    plan,
  );
}

export async function assertCanInviteSeat(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  });
  const plan = workspace?.plan ?? "free";
  const [memberCount, pendingInvitationCount] = await Promise.all([
    prisma.workspaceMember.count({ where: { workspaceId } }),
    prisma.workspaceInvitation.count({
      where: { workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
    }),
  ]);
  const decision = evaluateSeatLimit({ plan, memberCount, pendingInvitationCount });
  if (!decision.ok) {
    throw new PlanLimitError(decision.code, decision.message, plan);
  }
}

const PLAN_RANK: Record<string, number> = {
  free: 0,
  starter: 1,
  pilot: 2,
  professional: 3,
  enterprise: 4,
};

export function higherPlan(a: string, b: string): string {
  return (PLAN_RANK[a] ?? 0) >= (PLAN_RANK[b] ?? 0) ? a : b;
}

export async function assertCanCreateWorkspace(ownerUserId: string): Promise<{ plan: string }> {
  const owned = await prisma.workspace.findMany({
    where: { ownerId: ownerUserId },
    select: { plan: true },
  });
  const plan = owned.reduce((best, row) => higherPlan(best, row.plan), owned[0]?.plan ?? "free");
  const decision = evaluateWorkspaceCreateLimit({ plan, ownedWorkspaceCount: owned.length });
  if (!decision.ok) {
    throw new PlanLimitError(decision.code, decision.message, plan);
  }
  return { plan };
}
