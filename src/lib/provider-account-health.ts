/**
 * Durable per-provider-account health state.
 *
 * Requirements:
 * - Records workspace, connection, provider, account ID, account name, status,
 *   consecutive failures, error taxonomy, and timestamps.
 * - Poison-account isolation: broken child accounts stop wasting sync quota
 *   without blocking healthy sibling accounts.
 * - Quarantine threshold: consecutive non-retryable failures isolate the account.
 * - Transient retryable storms NEVER quarantine healthy accounts.
 * - Auth/revocation failures immediately set reconnect_required.
 * - Recovery is automatic upon a successful sync.
 * - Deliver actionable failures through SupportTicket and Telegram founder alerting.
 */
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withSystemScope } from "@/lib/tenant-guard";
import { upsertOpenTicket } from "@/lib/support-ticket";
import { sendAgencyAlert } from "@/lib/alerts";

export const QUARANTINE_THRESHOLD = 3;

export type AccountHealthStatus = "healthy" | "degraded" | "quarantined" | "reconnect_required";

export type ErrorCategory =
  | "AUTH_EXPIRED"
  | "PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "SCHEMA_DRIFT"
  | "TRANSIENT_NETWORK"
  | "UNKNOWN";

export function categorizeProviderError(message: string): ErrorCategory {
  const lower = (message || "").toLowerCase();
  if (
    /error validating access token|token.*revoked|token.*expired|code 190|oauthexception|invalid_grant|unauthorized/i.test(
      lower
    )
  ) {
    return "AUTH_EXPIRED";
  }
  if (
    /permission.*denied|not have permission|developer.?token|access denied|forbidden|account.*disabled|suspended|not authorized/i.test(
      lower
    )
  ) {
    return "PERMISSION_DENIED";
  }
  if (/rate.?limit|too many requests|calls quota|user request limit|429/i.test(lower)) {
    return "RATE_LIMITED";
  }
  if (/schema drift|unexpected field|missing property|invalid column/i.test(lower)) {
    return "SCHEMA_DRIFT";
  }
  if (
    /timeout|econnreset|econnrefused|gateway timeout|502|503|504|network error|etimedout|socket hang up/i.test(
      lower
    )
  ) {
    return "TRANSIENT_NETWORK";
  }
  return "UNKNOWN";
}

export interface AccountOutcomeInput {
  workspaceId: string;
  connectionId: string;
  provider: string;
  accountId: string;
  accountName?: string | null;
  ok: boolean;
  retryable?: boolean;
  authFailure?: boolean;
  error?: string;
}

export async function recordAccountOutcome(input: AccountOutcomeInput): Promise<void> {
  const now = new Date();
  const key = {
    connectionId_accountId: {
      connectionId: input.connectionId,
      accountId: String(input.accountId),
    },
  };

  try {
    const current = await withSystemScope(() =>
      prisma.providerAccountHealth.findUnique({ where: key })
    );

    let status: AccountHealthStatus;
    let consecutiveFailures: number;
    let errorCategory: ErrorCategory | null = null;

    if (input.ok) {
      status = "healthy";
      consecutiveFailures = 0;
      errorCategory = null;
    } else {
      consecutiveFailures = (current?.consecutiveFailures ?? 0) + 1;
      errorCategory = input.authFailure
        ? "AUTH_EXPIRED"
        : categorizeProviderError(input.error ?? "");

      if (errorCategory === "AUTH_EXPIRED") {
        status = "reconnect_required";
      } else if (input.retryable === false || errorCategory === "PERMISSION_DENIED" || errorCategory === "SCHEMA_DRIFT") {
        status = consecutiveFailures >= QUARANTINE_THRESHOLD ? "quarantined" : "degraded";
      } else {
        // Retryable/transient errors degrade but NEVER quarantine
        status = "degraded";
      }
    }

    const previousStatus = current?.status;

    await withSystemScope(() =>
      prisma.providerAccountHealth.upsert({
        where: key,
        create: {
          workspaceId: input.workspaceId,
          connectionId: input.connectionId,
          provider: input.provider,
          accountId: String(input.accountId),
          accountName: input.accountName ?? null,
          status,
          errorCategory,
          consecutiveFailures,
          lastError: input.ok ? null : (input.error ?? "sync failed").slice(0, 1900),
          lastErrorAt: input.ok ? null : now,
          lastSuccessAt: input.ok ? now : (current?.lastSuccessAt ?? null),
        },
        update: {
          accountName: input.accountName ?? undefined,
          status,
          errorCategory,
          consecutiveFailures,
          lastError: input.ok ? null : (input.error ?? "sync failed").slice(0, 1900),
          lastErrorAt: input.ok ? null : now,
          lastSuccessAt: input.ok ? now : undefined,
        },
      })
    );

    // Deliver actionable alert when transitioning to quarantined or reconnect_required
    if (
      (status === "quarantined" || status === "reconnect_required") &&
      previousStatus !== status
    ) {
      logger.warn(
        `[ACCOUNT_HEALTH] Status changed to ${status}: provider=${input.provider} account=${input.accountId} connection=${input.connectionId}`
      );

      // 1. Create support ticket for operations visibility
      try {
        await upsertOpenTicket({
          workspaceId: input.workspaceId,
          reason: status === "reconnect_required" ? "auth" : "exhausted_retries",
          title: `[${input.provider}] Account ${input.accountName || input.accountId} ${status === "reconnect_required" ? "requires reconnect" : "quarantined"}`,
          tag: input.accountId,
          errorMsg: input.error ?? `Account entered ${status} state`,
          connectionId: input.connectionId,
        });
      } catch (ticketErr) {
        logger.error("[ACCOUNT_HEALTH] Failed to create support ticket:", ticketErr);
      }

      // 2. Dispatch founder Telegram notification
      try {
        await sendAgencyAlert({
          workspaceId: input.workspaceId,
          pipelineName: `${input.provider} / ${input.accountName || input.accountId}`,
          errorMsg: `[${status.toUpperCase()}] ${input.error ?? "Repeated sync failures"}`,
          actionHint:
            status === "reconnect_required"
              ? "Access token expired or revoked. Please reconnect in Settings -> Sources."
              : `Account quarantined after ${consecutiveFailures} failures. Check account permissions.`,
        });
      } catch (alertErr) {
        logger.error("[ACCOUNT_HEALTH] Failed to send Telegram alert:", alertErr);
      }
    }
  } catch (err) {
    // Health tracking should never fail an active sync
    logger.error("[ACCOUNT_HEALTH] recordAccountOutcome error:", err);
  }
}

/**
 * Returns the set of account IDs that must be skipped for a connection
 * (i.e. those in quarantined or reconnect_required status).
 */
export async function getSkippedAccountIds(connectionId: string, workspaceId?: string): Promise<Set<string>> {
  try {
    const rows = await withSystemScope(() =>
      prisma.providerAccountHealth.findMany({
        where: {
          ...(workspaceId ? { workspaceId } : {}),
          connectionId,
          status: { in: ["quarantined", "reconnect_required"] },
        },
        select: { accountId: true },
      })
    );
    return new Set(rows.map((r) => r.accountId));
  } catch (err) {
    logger.error("[ACCOUNT_HEALTH] getSkippedAccountIds failed (fail-open: sync continues):", err);
    return new Set();
  }
}

/** Retrieve all account health states for a connection. */
export async function getAccountHealth(connectionId: string) {
  return withSystemScope(() =>
    prisma.providerAccountHealth.findMany({
      where: { connectionId },
      orderBy: { updatedAt: "desc" },
    })
  );
}

/** Retrieve all account health states for a workspace. */
export async function getWorkspaceAccountHealth(workspaceId: string) {
  return withSystemScope(() =>
    prisma.providerAccountHealth.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
    })
  );
}

/** Reset reconnect_required or degraded account health states for a connection upon reauthorization. */
export async function resetConnectionAccountHealth(connectionId: string): Promise<number> {
  try {
    const result = await withSystemScope(() =>
      prisma.providerAccountHealth.updateMany({
        where: {
          connectionId,
          status: { in: ["reconnect_required", "degraded"] },
        },
        data: {
          status: "healthy",
          consecutiveFailures: 0,
          lastError: null,
          lastErrorAt: null,
          errorCategory: null,
        },
      })
    );
    return result.count;
  } catch (err) {
    logger.error("[ACCOUNT_HEALTH] resetConnectionAccountHealth failed:", err);
    return 0;
  }
}
