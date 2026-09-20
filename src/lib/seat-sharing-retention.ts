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
} = {}): Promise<{ loginEventsDeleted: number; usageRowsDeleted: number; hasMore: boolean; cutoff: string }> {
  const cutoff = retentionCutoff(options.now);
  const limit = Math.max(1, Math.min(MAX_RETENTION_BATCH, Math.floor(options.limit ?? 500)));

  const [loginRows, usageRows] = await Promise.all([
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
  ]);

  const loginBatch = loginRows.slice(0, limit);
  const usageBatch = usageRows.slice(0, limit);
  const [loginDeleted, usageDeleted] = await Promise.all([
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
  ]);

  return {
    loginEventsDeleted: loginDeleted.count,
    usageRowsDeleted: usageDeleted.count,
    hasMore: loginRows.length > limit || usageRows.length > limit,
    cutoff: cutoff.toISOString(),
  };
}
