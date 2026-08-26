import type { EtlProvider, PipelineContext, ExtractResult } from '@/etl/types';
import { extractForProvider } from '@/etl/extract';
import { loadToGoogleSheets } from '@/etl/loaders/googleSheets';
import { resolveCursor, saveCheckpoint, completeCheckpoint } from '@/etl/checkpoint';
import { transform, loadTransformRules } from '@/etl/transform';
import { loadApprovedMappingOverlay } from '@/lib/ai/mapping-overlay';
import { logger } from '@/lib/logger';

export async function runEtlPipeline(opts: {
  userId: string;
  userPlan: string;
  provider: EtlProvider;
  pipeline: any;
  ctx: PipelineContext;
  sourceCreds: any;
  jobId?: string;
}): Promise<{
  rowsSynced: number;
  spreadsheetId: string;
  nextCursor: Record<string, unknown> | null;
}> {
  // ── 1. Resolve cursor: checkpoint-resume first, then pipeline cursor fallback ──
  const { cursor: resolvedCursor, checkpointId } = await resolveCursor(
    opts.pipeline.id,
    opts.pipeline.syncCursor ?? null,
    opts.jobId
  );

  const cursorRaw = resolvedCursor ? JSON.stringify(resolvedCursor) : null;

  const extracted = await extractForProvider({
    provider: opts.provider,
    ctx: opts.ctx,
    sourceCreds: opts.sourceCreds,
    cursorRaw,
    userPlan: opts.userPlan,
  });

  // ── 2. Data Drift Detection ──
  if (resolvedCursor && extracted.columns.length > 0) {
    try {
      const lastCursor = resolvedCursor;
      const lastCols = lastCursor.columns as string[] | undefined;
      if (lastCols && JSON.stringify(lastCols) !== JSON.stringify(extracted.columns)) {
          logger.warn(`[ETL][DRIFT] Column schema changed for pipeline ${opts.pipeline.id}. Old: ${lastCols.length}, New: ${extracted.columns.length}`);
      }
    } catch (err) {
      logger.info("[ETL][DRIFT] Drift check skipped", err);
    }
  }

  if (extracted.rows.length === 0) {
    return { rowsSynced: 0, spreadsheetId: '', nextCursor: extracted.nextCursor };
  }

  // ── 3. Transform: in-flight normalization + custom field calculations ──
  const rules = await loadTransformRules(opts.pipeline.id);
  const transformedRows = rules.length > 0
    ? await applyTransform(extracted, rules, opts.provider, opts.ctx)
    : extracted.rows;

  // ── 4. Load ──
  const loaded = await loadToGoogleSheets({
    userId: opts.userId,
    pipeline: opts.pipeline,
    columns: extracted.columns,
    rows: transformedRows,
  });

  // ── 5. Checkpoint: mark completed and advance pipeline cursor ──
  const nextCursor: Record<string, unknown> = {
    ...(extracted.nextCursor || {}),
    columns: extracted.columns,
  };

  if (checkpointId) {
    await completeCheckpoint(checkpointId);
  }

  // Save an active checkpoint for the *next* incremental run so failures
  // in the next sync can resume from this point.
  await saveCheckpoint({
    pipelineId: opts.pipeline.id,
    jobId: opts.jobId,
    entityType: opts.provider === 'meta_ads' || opts.provider === 'google_ads' || opts.provider === 'tiktok_business'
      ? 'campaign'
      : 'order',
    cursor: nextCursor,
    rowsProcessed: extracted.rows.length,
    rowsInserted: transformedRows.length,
    rowsFailed: extracted.rows.length - transformedRows.length,
    existingCheckpointId: undefined,
  });

  return {
    rowsSynced: transformedRows.length,
    spreadsheetId: loaded.spreadsheetId,
    nextCursor,
  };
}

/**
 * Convert columnar rows (string | number | null)[][] into objects,
 * run the transform pipeline, then convert back.
 */
async function applyTransform(
  extracted: ExtractResult,
  rules: Awaited<ReturnType<typeof loadTransformRules>>,
  provider: EtlProvider,
  ctx: PipelineContext
): Promise<(string | number | null)[][]> {
  const overlay = await loadApprovedMappingOverlay(ctx.workspaceId, ctx.sourceConnectionId, provider);
  if (rules.length === 0 && Object.keys(overlay).length === 0) return extracted.rows;

  // rows are arrays aligned to columns — convert to objects for transform
  const asObjects = extracted.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    extracted.columns.forEach((col, i) => {
      obj[col] = row[i] ?? null;
    });
    return obj;
  });

  const transformed = await transform(asObjects, rules, {
    platform: provider,
    pipelineId: ctx.pipelineId,
    connectionId: ctx.sourceConnectionId,
  }, overlay);

  // Re-align columns. If transform added/removed fields, use all unique keys
  // preserving original column order for unchanged fields.
  const outputKeys = new Set<string>();
  transformed.forEach((o) => Object.keys(o).forEach((k) => outputKeys.add(k)));

  // Preserve original columns first, append new ones
  const finalColumns = [
    ...extracted.columns,
    ...Array.from(outputKeys).filter((k) => !extracted.columns.includes(k)),
  ];

  const asRows = transformed.map((obj) =>
    finalColumns.map((col) => {
      const val = obj[col];
      if (val === null || val === undefined) return null;
      if (typeof val === 'string' || typeof val === 'number') return val;
      return JSON.stringify(val);
    })
  );

  logger.info(`[ETL][TRANSFORM] ${asObjects.length} rows -> ${asRows.length} rows, ${finalColumns.length} columns`);
  return asRows;
}
