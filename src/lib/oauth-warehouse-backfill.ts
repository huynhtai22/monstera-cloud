import { createImportJob, type BatchImportJobState } from "@/lib/warehouse-import-job";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export const INITIAL_OAUTH_BACKFILL_DAYS = 30;
const CATCHUP_OVERLAP_DAYS = 2;

export type OauthBackfillKind = "initial" | "catchup";

export function utcIsoDate(date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

export function initialOauthBackfillWindow(now = new Date()): { since: string; until: string } {
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - (INITIAL_OAUTH_BACKFILL_DAYS - 1));
  return { since: utcIsoDate(since), until: utcIsoDate(until) };
}

export function catchupOauthWindow(lastSyncAt: Date | null | undefined, now = new Date()): { since: string; until: string } {
  if (!lastSyncAt) return initialOauthBackfillWindow(now);
  const until = utcIsoDate(now);
  const sinceDate = new Date(lastSyncAt);
  sinceDate.setUTCDate(sinceDate.getUTCDate() - CATCHUP_OVERLAP_DAYS);
  const floor = initialOauthBackfillWindow(now).since;
  let since = utcIsoDate(sinceDate);
  if (since < floor) since = floor;
  if (since > until) since = until;
  return { since, until };
}

export function oauthBackfillIdempotencyKey(
  kind: OauthBackfillKind,
  connectionId: string,
  until: string,
  retrySuffix?: string
): string {
  const base =
    kind === "initial"
      ? `oauth-initial:${connectionId}`
      : `oauth-catchup:${connectionId}:${until}`;
  return retrySuffix ? `${base}:${retrySuffix}` : base;
}

export class WorkspaceBoundaryError extends Error {
  constructor(message = "Connection does not belong to the requested workspace") {
    super(message);
    this.name = "WorkspaceBoundaryError";
  }
}

export async function enqueueOauthWarehouseBackfill(opts: {
  workspaceId: string;
  userId: string;
  connectionId: string;
  connectionWorkspaceId: string;
  kind: OauthBackfillKind;
  lastSyncAt?: Date | null;
  plan?: string;
}): Promise<{ job: BatchImportJobState; reused: boolean }> {
  if (opts.connectionWorkspaceId !== opts.workspaceId) {
    throw new WorkspaceBoundaryError();
  }

  const window =
    opts.kind === "initial"
      ? initialOauthBackfillWindow()
      : catchupOauthWindow(opts.lastSyncAt ?? null);

  let idempotencyKey = oauthBackfillIdempotencyKey(opts.kind, opts.connectionId, window.until);

  const existing = await prisma.warehouseImportJob.findUnique({
    where: {
      workspaceId_idempotencyKey: {
        workspaceId: opts.workspaceId,
        idempotencyKey,
      },
    },
  });

  if (existing && existing.status === "failed") {
    idempotencyKey = oauthBackfillIdempotencyKey(
      opts.kind,
      opts.connectionId,
      window.until,
      `retry-${existing.id}`
    );
  }

  const job = await createImportJob({
    workspaceId: opts.workspaceId,
    userId: opts.userId,
    plan: opts.plan,
    since: window.since,
    until: window.until,
    items: [{ connectionId: opts.connectionId }],
    idempotencyKey,
    priority: 5,
  });

  const reused = Boolean(existing && existing.status !== "failed" && existing.id === job.id);

  try {
    await prisma.auditEvent.create({
      data: {
        workspaceId: opts.workspaceId,
        actorUserId: opts.userId,
        action: reused ? "warehouse.import_reused" : "warehouse.import_queued",
        resource: "WarehouseImportJob",
        resourceId: job.id,
        metadata: {
          connectionId: opts.connectionId,
          kind: opts.kind,
          since: job.since,
          until: job.until,
          reused,
        },
      },
    });
  } catch (err) {
    logger.warn("[oauth-warehouse-backfill] audit event failed", err);
  }

  return { job, reused };
}
