import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { telemetryHashesFromRequest, type RequestLike } from "@/lib/login-telemetry";

type EvidenceDelegate = {
  upsert(args: unknown): Promise<unknown>;
};

/**
 * Record presence only after the route has authorized the user for workspaceId.
 * Storage is deliberately fail-open: presence telemetry must never invalidate
 * an otherwise valid browser session.
 */
export async function recordWorkspaceSessionEvidence(input: {
  workspaceId: string;
  userId: string;
  sessionJti: string | null | undefined;
  request?: RequestLike | null;
  now?: Date;
  delegate?: EvidenceDelegate;
}): Promise<void> {
  if (!input.workspaceId || !input.userId || !input.sessionJti) return;
  const now = input.now ?? new Date();
  const { ipHash, uaHash } = telemetryHashesFromRequest(input.request ?? null);
  const delegate = input.delegate
    ?? (prisma.workspaceSessionEvidence as unknown as EvidenceDelegate);

  try {
    await delegate.upsert({
      where: {
        workspaceId_sessionJti: {
          workspaceId: input.workspaceId,
          sessionJti: input.sessionJti,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        sessionJti: input.sessionJti,
        ipHash,
        uaHash,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        // A JWT session belongs to exactly one user. Keeping userId current also
        // makes a corrupt/reused jti visible instead of silently misattributing it.
        userId: input.userId,
        ipHash,
        uaHash,
        lastSeenAt: now,
        heartbeatCount: { increment: 1 },
      },
    });
  } catch (error) {
    logger.warn("[workspace-session-evidence] failed open", {
      workspaceId: input.workspaceId,
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export type WorkspaceDeviceSignal = {
  userId: string;
  sessionJti: string;
  ipHash: string | null;
  uaHash: string | null;
  lastSeenAt: Date;
};

export function aggregateWorkspaceDeviceSignals(rows: WorkspaceDeviceSignal[]): Map<string, {
  activeDevices: number;
  distinctIps: number;
  distinctBrowsers: number;
  lastSeenAt: Date | null;
}> {
  const grouped = new Map<string, {
    sessions: Set<string>;
    ips: Set<string>;
    uas: Set<string>;
    lastSeenAt: Date | null;
  }>();
  for (const row of rows) {
    let current = grouped.get(row.userId);
    if (!current) {
      current = { sessions: new Set(), ips: new Set(), uas: new Set(), lastSeenAt: null };
      grouped.set(row.userId, current);
    }
    current.sessions.add(row.sessionJti);
    if (row.ipHash) current.ips.add(row.ipHash);
    if (row.uaHash) current.uas.add(row.uaHash);
    if (!current.lastSeenAt || row.lastSeenAt > current.lastSeenAt) current.lastSeenAt = row.lastSeenAt;
  }
  return new Map([...grouped].map(([userId, value]) => [userId, {
    activeDevices: value.sessions.size,
    distinctIps: value.ips.size,
    distinctBrowsers: value.uas.size,
    lastSeenAt: value.lastSeenAt,
  }]));
}
