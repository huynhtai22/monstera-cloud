import prisma, { prismaBase } from "@/lib/prisma";
import { withSystemScope } from "@/lib/tenant-guard";

export const SEAT_SHARING_RETENTION_DAYS = 90;
export const MAX_RETENTION_BATCH = 1_000;

export function retentionCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - SEAT_SHARING_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export async function cleanupSeatSharingTelemetry(options: {
  now?: Date;
  limit?: number;
} = {}): Promise<{
  loginEventsDeleted: number;
  usageRowsDeleted: number;
  sessionEvidenceDeleted: number;
  apiKeyReceiptsDeleted: number;
  securityEventsDeleted: number;
  hasMore: boolean;
  cutoff: string;
}> {
  const cutoff = retentionCutoff(options.now);
  const limit = Math.max(1, Math.min(MAX_RETENTION_BATCH, Math.floor(options.limit ?? 500)));

  const [loginRows, usageRows, evidenceRows, receiptRows, securityRows] = await Promise.all([
    prismaBase.loginEvent.findMany({
      where: { createdAt: { lt: cutoff } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
      take: limit + 1,
    }),
    withSystemScope(() => prisma.workspaceDailyUsage.findMany({
      where: { date: { lt: cutoff } },
      orderBy: [{ date: "asc" }, { workspaceId: "asc" }],
      select: { workspaceId: true, date: true },
      take: limit + 1,
    })),
    withSystemScope(() => prisma.workspaceSessionEvidence.findMany({
      where: { lastSeenAt: { lt: cutoff } },
      orderBy: [{ lastSeenAt: "asc" }, { id: "asc" }],
      select: { id: true },
      take: limit + 1,
    })),
    withSystemScope(() => prisma.apiKeyMutationReceipt.findMany({
      where: { expiresAt: { lt: options.now ?? new Date() } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      select: { id: true },
      take: limit + 1,
    })),
    prismaBase.securityControlEvent.findMany({
      where: { createdAt: { lt: cutoff } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
      take: limit + 1,
    }),
  ]);

  const loginBatch = loginRows.slice(0, limit);
  const usageBatch = usageRows.slice(0, limit);
  const evidenceBatch = evidenceRows.slice(0, limit);
  const receiptBatch = receiptRows.slice(0, limit);
  const securityBatch = securityRows.slice(0, limit);
  const [loginDeleted, usageDeleted, evidenceDeleted, receiptsDeleted, securityDeleted] = await Promise.all([
    loginBatch.length
      ? prismaBase.loginEvent.deleteMany({ where: { id: { in: loginBatch.map((row) => row.id) } } })
      : Promise.resolve({ count: 0 }),
    usageBatch.length
      ? withSystemScope(() => prisma.workspaceDailyUsage.deleteMany({
          where: {
            OR: usageBatch.map((row) => ({ workspaceId: row.workspaceId, date: row.date })),
          },
        }))
      : Promise.resolve({ count: 0 }),
    evidenceBatch.length
      ? withSystemScope(() => prisma.workspaceSessionEvidence.deleteMany({
          where: { id: { in: evidenceBatch.map((row) => row.id) } },
        }))
      : Promise.resolve({ count: 0 }),
    receiptBatch.length
      ? withSystemScope(() => prisma.apiKeyMutationReceipt.deleteMany({
          where: { id: { in: receiptBatch.map((row) => row.id) } },
        }))
      : Promise.resolve({ count: 0 }),
    securityBatch.length
      ? prismaBase.securityControlEvent.deleteMany({ where: { id: { in: securityBatch.map((row) => row.id) } } })
      : Promise.resolve({ count: 0 }),
  ]);

  return {
    loginEventsDeleted: loginDeleted.count,
    usageRowsDeleted: usageDeleted.count,
    sessionEvidenceDeleted: evidenceDeleted.count,
    apiKeyReceiptsDeleted: receiptsDeleted.count,
    securityEventsDeleted: securityDeleted.count,
    hasMore:
      loginRows.length > limit
      || usageRows.length > limit
      || evidenceRows.length > limit
      || receiptRows.length > limit
      || securityRows.length > limit,
    cutoff: cutoff.toISOString(),
  };
}
