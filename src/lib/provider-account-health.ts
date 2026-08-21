/**
 * Durable per-provider-account health state.
 *
 * Purpose (Known Limitations §5 "Poison-account isolation"): a permanently
 * broken child account (disabled, permission lost, revoked) must stop
 * consuming sync attempts without blocking its healthy siblings.
 *
 * Lifecycle:
 *   - success → healthy, consecutiveFailures reset, lastSuccessAt advanced.
 *   - retryable failure → consecutiveFailures++ (degraded), never quarantine
 *     (a transient storm must not quarantine healthy accounts).
 *   - non-retryable failure → consecutiveFailures++; at QUARANTINE_THRESHOLD
 *     consecutive non-retryable failures the account is "quarantined" and
 *     skipped by future syncs.
 *   - auth/revocation failure → "reconnect_required" immediately (terminal
 *     until an explicit success proves recovery).
 *
 * Quarantine and reconnect_required are always reversible by a success (or by
 * reconnection), so recovery is automatic — never a permanent data mutation.
 */
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export const QUARANTINE_THRESHOLD = 3;

export type AccountHealthStatus = "healthy" | "degraded" | "quarantined" | "reconnect_required";

export interface AccountOutcomeInput {
  workspaceId: string;
  connectionId: string;
  provider: string;
  accountId: string;
  ok: boolean;
  retryable?: boolean;
  authFailure?: boolean;
  error?: string;
}

export async function recordAccountOutcome(input: AccountOutcomeInput): Promise<void> {
  const now = new Date();
  const key = { connectionId_accountId: { connectionId: input.connectionId, accountId: input.accountId } };

  try {
    const current = await prisma.providerAccountHealth.findUnique({ where: key });
    let status: AccountHealthStatus;
    let consecutiveFailures: number;

    if (input.ok) {
      status = "healthy";
      consecutiveFailures = 0;
    } else if (input.authFailure) {
      status = "reconnect_required";
      consecutiveFailures = (current?.consecutiveFailures ?? 0) + 1;
    } else {
      consecutiveFailures = (current?.consecutiveFailures ?? 0) + 1;
      const nonRetryableStreak = input.retryable === false ? consecutiveFailures : 0;
      status =
        nonRetryableStreak >= QUARANTINE_THRESHOLD
          ? "quarantined"
          : consecutiveFailures > 0
            ? "degraded"
            : "healthy";
    }

    await prisma.providerAccountHealth.upsert({
      where: key,
      create: {
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        provider: input.provider,
        accountId: input.accountId,
        status,
        consecutiveFailures,
        lastError: input.ok ? null : (input.error ?? "sync failed").slice(0, 1900),
        lastErrorAt: input.ok ? null : now,
        lastSuccessAt: input.ok ? now : (current?.lastSuccessAt ?? null),
      },
      update: {
        status,
        consecutiveFailures,
        lastError: input.ok ? null : (input.error ?? "sync failed").slice(0, 1900),
        lastErrorAt: input.ok ? null : now,
        lastSuccessAt: input.ok ? now : undefined,
      },
    });

    if (status === "quarantined" || status === "reconnect_required") {
      logger.warn(
        `[ACCOUNT_HEALTH] ${status} provider=${input.provider} account=${input.accountId} connection=${input.connectionId}: ${input.error ?? ""}`
      );
    }
  } catch (err) {
    // Health bookkeeping must never fail a sync.
    logger.error("[ACCOUNT_HEALTH] recordAccountOutcome failed:", err);
  }
}

/** Accounts of a connection that must be skipped (quarantined / reconnect required). */
export async function getSkippedAccountIds(connectionId: string): Promise<Set<string>> {
  try {
    const rows = await prisma.providerAccountHealth.findMany({
      where: { connectionId, status: { in: ["quarantined", "reconnect_required"] } },
      select: { accountId: true },
    });
    return new Set(rows.map((r) => r.accountId));
  } catch (err) {
    logger.error("[ACCOUNT_HEALTH] getSkippedAccountIds failed (fail-open: sync continues):", err);
    return new Set();
  }
}

export async function getAccountHealth(connectionId: string) {
  return prisma.providerAccountHealth.findMany({
    where: { connectionId },
    orderBy: { updatedAt: "desc" },
  });
}
