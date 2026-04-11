import type { EtlProvider, PipelineContext } from '@/etl/types';
import { extractForProvider } from '@/etl/extract';
import { loadToGoogleSheets } from '@/etl/loaders/googleSheets';

export async function runEtlPipeline(opts: {
  userId: string;
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
  });

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
    nextCursor: extracted.nextCursor,
  };
}

