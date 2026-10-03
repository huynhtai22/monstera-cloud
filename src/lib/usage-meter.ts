import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type UsageKind = "query" | "import" | "keyHit";

type UsageDelegate = {
  upsert(args: unknown): Promise<unknown>;
};

export function utcDayBucket(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function incrementFor(kind: UsageKind): Record<"queryCount" | "importCount" | "keyHitCount", number> {
  return {
    queryCount: kind === "query" ? 1 : 0,
    importCount: kind === "import" ? 1 : 0,
    keyHitCount: kind === "keyHit" ? 1 : 0,
  };
}

/**
 * Best-effort daily usage metering. The helper deliberately never throws:
 * measurement storage must not deny or delay an otherwise valid request.
 */
export async function recordUsage(
  workspaceId: string,
  kind: UsageKind,
  options: { now?: Date; delegate?: UsageDelegate } = {},
): Promise<void> {
  if (!workspaceId) return;
  const date = utcDayBucket(options.now);
  const counts = incrementFor(kind);
  const delegate = options.delegate ?? (prisma.workspaceDailyUsage as unknown as UsageDelegate);

  try {
    await delegate.upsert({
      where: { workspaceId_date: { workspaceId, date } },
      create: { workspaceId, date, ...counts },
      update: {
        queryCount: { increment: counts.queryCount },
        importCount: { increment: counts.importCount },
        keyHitCount: { increment: counts.keyHitCount },
      },
    });
  } catch (error) {
    logger.warn("[usage-meter] failed open", {
      workspaceId,
      kind,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
