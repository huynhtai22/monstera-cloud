export type EtlProvider = 'shopee' | 'meta_ads' | 'google_ads' | 'tiktok_business' | 'shopify';

export type EtlCursor = Record<string, unknown> | null;

export interface ExtractResult {
  columns: string[];
  rows: (string | number | null)[][];
  nextCursor: EtlCursor;
}

export interface PipelineContext {
  /** Request origin, used for internal mock endpoints in dev */
  requestOrigin: string;
  /** Workspace/pipeline identifiers for logging */
  pipelineId: string;
  pipelineName: string;
  sourceConnectionId: string;
}

export function safeJsonParse(value: string): any | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

