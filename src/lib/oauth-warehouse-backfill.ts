import {
  createImportJob,
  type BatchImportItem,
  type BatchImportJobState,
} from "@/lib/warehouse-import-job";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getAutomaticWarehouseBackfillDays } from "@/lib/historical-ingestion-capabilities";
import { planHistoricalBackfill } from "@/lib/historical-backfill-plan";
import {
  WAREHOUSE_AUTOMATIC_SKIP_REASON,
  isAutomaticWarehouseIngestionAvailable,
  isChunkGuardedWarehouseProvider,
} from "@/lib/warehouse-execution-guard";

/** Legacy fallback only. Canonical provider records may opt into a longer automatic window. */
export const INITIAL_OAUTH_BACKFILL_DAYS = 30;
const CATCHUP_OVERLAP_DAYS = 2;

export type OauthBackfillKind = "initial" | "catchup";

export function utcIsoDate(date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

export function initialOauthBackfillWindow(
  providerOrNow?: string | Date,
  maybeNow = new Date(),
): { since: string; until: string } {
  const provider = typeof providerOrNow === "string" ? providerOrNow : undefined;
  const now = providerOrNow instanceof Date ? providerOrNow : maybeNow;
  const initialBackfillDays = getAutomaticWarehouseBackfillDays(provider);
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - (initialBackfillDays - 1));
  return { since: utcIsoDate(since), until: utcIsoDate(until) };
}

export function catchupOauthWindow(
  lastSyncAt: Date | null | undefined,
  now = new Date(),
  provider?: string,
): { since: string; until: string } {
  if (!lastSyncAt) return initialOauthBackfillWindow(provider, now);
  const until = utcIsoDate(now);
  const sinceDate = new Date(lastSyncAt);
  sinceDate.setUTCDate(sinceDate.getUTCDate() - CATCHUP_OVERLAP_DAYS);
  const floor = initialOauthBackfillWindow(provider, now).since;
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

/**
 * Meta and Google OAuth initial windows are durably queued as the same
 * newest-first, 30-day-safe chunks declared by the canonical planner. This
 * applies only to the approved automatic window; extended execution is still
 * rejected by the planner and has no route.
 */
function oauthBackfillItems(
  provider: string | undefined,
  connectionId: string,
  window: { since: string; until: string },
): BatchImportItem[] {
  if (!provider || !isChunkGuardedWarehouseProvider(provider)) {
    return [{ connectionId }];
  }

  const plan = planHistoricalBackfill({
    provider,
    since: window.since,
    until: window.until,
    asOf: window.until,
    execution: "plan",
  });
  return plan.chunks.map((chunk) => ({
    connectionId,
    executionSince: chunk.since,
    executionUntil: chunk.until,
  }));
}

/**
 * Relational executable slices mirroring `oauthBackfillItems`: one spec per
 * planner chunk for Meta/Google (newest-first ordinals preserved), a single
 * connection-level spec for other supported providers. Unavailable providers
 * never reach here (the enqueue capability gate returns first).
 */
function oauthBackfillChunkSpecs(
  provider: string | undefined,
  connectionId: string,
  window: { since: string; until: string },
): { connectionId: string; accountId: string; provider: string; since: string; until: string; ordinal: number }[] {
  if (!provider) return [];
  if (!isChunkGuardedWarehouseProvider(provider)) {
    return [{ connectionId, accountId: "", provider, since: window.since, until: window.until, ordinal: 0 }];
  }
  const plan = planHistoricalBackfill({
    provider,
    since: window.since,
    until: window.until,
    asOf: window.until,
    execution: "plan",
  });
  return plan.chunks.map((chunk) => ({
    connectionId,
    accountId: "",
    provider,
    since: chunk.since,
    until: chunk.until,
    ordinal: chunk.ordinal,
  }));
}

export async function enqueueOauthWarehouseBackfill(opts: {
  workspaceId: string;
  userId: string;
  connectionId: string;
  connectionWorkspaceId: string;
  provider?: string;
  kind: OauthBackfillKind;
  lastSyncAt?: Date | null;
  plan?: string;
}): Promise<
  | { job: BatchImportJobState; reused: boolean; skipped?: false }
  | {
      job: null;
      reused: false;
      skipped: true;
      reason: typeof WAREHOUSE_AUTOMATIC_SKIP_REASON;
      provider?: string;
    }
> {
  if (opts.connectionWorkspaceId !== opts.workspaceId) {
    throw new WorkspaceBoundaryError();
  }

  // Capability is checked before any date arithmetic so unavailable ingestion
  // (including zero-day automatic windows) never produces a reversed range,
  // import item, job, worker dispatch, or provider contact. OAuth success
  // remains independent from Warehouse availability.
  if (!isAutomaticWarehouseIngestionAvailable(opts.provider)) {
    logger.info("[oauth-warehouse-backfill] skip automatic enqueue", {
      reason: WAREHOUSE_AUTOMATIC_SKIP_REASON,
      provider: opts.provider ?? null,
      connectionId: opts.connectionId,
      workspaceId: opts.workspaceId,
      kind: opts.kind,
    });
    return {
      job: null,
      reused: false,
      skipped: true,
      reason: WAREHOUSE_AUTOMATIC_SKIP_REASON,
      provider: opts.provider,
    };
  }

  const window =
    opts.kind === "initial"
      ? initialOauthBackfillWindow(opts.provider)
      : catchupOauthWindow(opts.lastSyncAt ?? null, new Date(), opts.provider);

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
    items: oauthBackfillItems(opts.provider, opts.connectionId, window),
    // Relational checkpoint slices are materialized in the same transaction
    // as the parent job; the checkpoint worker executes them newest-first.
    chunks: oauthBackfillChunkSpecs(opts.provider, opts.connectionId, window),
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
