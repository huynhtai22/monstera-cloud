/**
 * Batch-level checkpoint system for idempotent ETL execution.
 *
 * If a sync fails mid-way, the next retry resumes from the last
 * successfully committed checkpoint rather than restarting from the
 * original pipeline cursor.
 */

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

// SyncCheckpoint model is defined in schema.prisma but requires
// `npx prisma generate` after migration to type-check fully.
// Gracefully handle missing model by returning safe no-op object
const cp = () => {
  const client = (prisma as any).syncCheckpoint;
  if (!client) {
    // Return no-op object that won't throw during query validation
    logger.warn('[CHECKPOINT] syncCheckpoint model not found in Prisma client, using no-op');
    return {
      findFirst: async () => null,
      create: async () => ({ id: 'noop', rowsProcessed: 0, rowsInserted: 0, rowsFailed: 0 }),
      update: async () => ({ id: 'noop' }),
    };
  }
  return client;
};

export interface Checkpoint {
    id: string;
    cursor: Record<string, unknown>;
    rowsProcessed: number;
    rowsInserted: number;
    rowsFailed: number;
    entityType: string;
    status: "active" | "completed" | "failed";
}

/**
 * Load the latest active checkpoint for a pipeline.
 * Returns null if no checkpoint exists or the latest is completed.
 * Gracefully handles missing SyncCheckpoint table (e.g., after migrations).
 */
export async function loadCheckpoint(
    pipelineId: string,
    jobId?: string
): Promise<Checkpoint | null> {
    try {
        const where: any = {
            pipelineId,
            status: "active",
        };
        if (jobId) where.jobId = jobId;

        const row = await cp().findFirst({
            where,
            orderBy: { updatedAt: "desc" },
        });

        if (!row) return null;

        try {
            const cursor = JSON.parse(row.cursor);
            return {
                id: row.id,
                cursor,
                rowsProcessed: row.rowsProcessed,
                rowsInserted: row.rowsInserted,
                rowsFailed: row.rowsFailed,
                entityType: row.entityType,
                status: row.status as Checkpoint["status"],
            };
        } catch {
            logger.warn(`[CHECKPOINT] Failed to parse cursor for checkpoint ${row.id}`);
            return null;
        }
    } catch (error: any) {
        // Gracefully handle missing SyncCheckpoint table
        if (error.message?.includes('SyncCheckpoint') || error.code === 'P2021') {
            logger.warn(`[CHECKPOINT] SyncCheckpoint table not found, returning null`);
            return null;
        }
        throw error;
    }
}

/**
 * Save (upsert) a checkpoint after each successfully processed batch.
 * On conflict with an existing active checkpoint for the same pipeline+job,
 * we update it so only the latest cursor is kept per job run.
 */
export async function saveCheckpoint(opts: {
    pipelineId: string;
    jobId?: string;
    entityType: string;
    cursor: Record<string, unknown>;
    rowsProcessed: number;
    rowsInserted: number;
    rowsFailed: number;
    existingCheckpointId?: string;
}): Promise<Checkpoint | null> {
    try {
        const cursorJson = JSON.stringify(opts.cursor);

        // If we have an existing checkpoint ID, update it atomically
        if (opts.existingCheckpointId) {
            const updated = await cp().update({
                where: { id: opts.existingCheckpointId },
                data: {
                    cursor: cursorJson,
                    rowsProcessed: opts.rowsProcessed,
                    rowsInserted: opts.rowsInserted,
                    rowsFailed: opts.rowsFailed,
                    status: "active",
                    updatedAt: new Date(),
                },
            });

            return {
                id: updated.id,
                cursor: opts.cursor,
                rowsProcessed: updated.rowsProcessed,
                rowsInserted: updated.rowsInserted,
                rowsFailed: updated.rowsFailed,
                entityType: updated.entityType,
                status: "active",
            };
        }

        // Otherwise create a new checkpoint
        const created = await cp().create({
            data: {
                pipelineId: opts.pipelineId,
                jobId: opts.jobId,
                entityType: opts.entityType,
                cursor: cursorJson,
                rowsProcessed: opts.rowsProcessed,
                rowsInserted: opts.rowsInserted,
                rowsFailed: opts.rowsFailed,
                status: "active",
                updatedAt: new Date(),
            },
        });

        return {
            id: created.id,
            cursor: opts.cursor,
            rowsProcessed: created.rowsProcessed,
            rowsInserted: created.rowsInserted,
            rowsFailed: created.rowsFailed,
            entityType: created.entityType,
            status: "active",
        };
    } catch (error: any) {
        // Gracefully handle missing SyncCheckpoint table
        if (error.message?.includes('SyncCheckpoint') || error.code === 'P2021') {
            logger.warn(`[CHECKPOINT] SyncCheckpoint table not found, skipping checkpoint save`);
            return null;
        }
        throw error;
    }
}

/**
 * Mark a checkpoint as completed after the full sync succeeds.
 */
export async function completeCheckpoint(checkpointId: string): Promise<void> {
    try {
        await cp().update({
            where: { id: checkpointId },
            data: {
                status: "completed",
                updatedAt: new Date(),
            },
        });
    } catch (error: any) {
        // Gracefully handle missing table
        if (error.message?.includes('SyncCheckpoint') || error.code === 'P2021') {
            logger.warn(`[CHECKPOINT] SyncCheckpoint table not found, skipping complete`);
            return;
        }
        throw error;
    }
}

/**
 * Mark a checkpoint as failed (kept for forensic analysis).
 */
export async function failCheckpoint(checkpointId: string): Promise<void> {
    try {
        await cp().update({
            where: { id: checkpointId },
            data: {
                status: "failed",
                updatedAt: new Date(),
            },
        });
    } catch (error: any) {
        // Gracefully handle missing table
        if (error.message?.includes('SyncCheckpoint') || error.code === 'P2021') {
            logger.warn(`[CHECKPOINT] SyncCheckpoint table not found, skipping fail`);
            return;
        }
        throw error;
    }
}

/**
 * Resolve the effective cursor for a sync run:
 * - If an active checkpoint exists, use its cursor (resume)
 * - Otherwise, fall back to the pipeline's stored syncCursor
 */
export async function resolveCursor(
    pipelineId: string,
    pipelineSyncCursor: string | null,
    jobId?: string
): Promise<{ cursor: Record<string, unknown> | null; checkpointId?: string }> {
    const checkpoint = await loadCheckpoint(pipelineId, jobId);
    if (checkpoint) {
        logger.info(`[CHECKPOINT] Resuming pipeline ${pipelineId} from checkpoint ${checkpoint.id} (${checkpoint.rowsProcessed} rows processed)`);
        return { cursor: checkpoint.cursor, checkpointId: checkpoint.id };
    }

    if (pipelineSyncCursor) {
        try {
            const parsed = JSON.parse(pipelineSyncCursor);
            return { cursor: parsed };
        } catch {
            logger.warn(`[CHECKPOINT] Failed to parse pipeline syncCursor for ${pipelineId}`);
        }
    }

    return { cursor: null };
}
