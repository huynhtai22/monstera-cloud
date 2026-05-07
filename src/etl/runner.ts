import type { EtlProvider, PipelineContext } from '@/etl/types';
import { extractForProvider } from '@/etl/extract';
import { loadToGoogleSheets } from '@/etl/loaders/googleSheets';

export async function runEtlPipeline(opts: {
  userId: string;
  userPlan: string;
  provider: EtlProvider;
  pipeline: any;
  ctx: PipelineContext;
  sourceCreds: any;
}): Promise<{
  rowsSynced: number;
  spreadsheetId: string;
  nextCursor: Record<string, unknown> | null;
}> {
  const extracted = await extractForProvider({
    provider: opts.provider,
    ctx: opts.ctx,
    sourceCreds: opts.sourceCreds,
    cursorRaw: opts.pipeline.syncCursor ?? null,
    userPlan: opts.userPlan,
  });

  // Data Drift Detection: compare columns with last sync
  if (opts.pipeline.syncCursor && extracted.columns.length > 0) {
    try {
      const lastCursor = JSON.parse(opts.pipeline.syncCursor);
      const lastCols = lastCursor.columns as string[] | undefined;
      if (lastCols && JSON.stringify(lastCols) !== JSON.stringify(extracted.columns)) {
          console.warn(`[ETL][DRIFT] Column schema changed for pipeline ${opts.pipeline.id}. Old: ${lastCols.length}, New: ${extracted.columns.length}`);
      }
    } catch (e) {}
  }

  if (extracted.rows.length === 0) {
    return { rowsSynced: 0, spreadsheetId: '', nextCursor: extracted.nextCursor };
  }

  const loaded = await loadToGoogleSheets({
    userId: opts.userId,
    pipeline: opts.pipeline,
    columns: extracted.columns,
    rows: extracted.rows,
  });

  return {
    rowsSynced: extracted.rows.length,
    spreadsheetId: loaded.spreadsheetId,
    nextCursor: { ...(extracted.nextCursor || {}), columns: extracted.columns },
  };
}
