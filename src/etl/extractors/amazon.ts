import type { ExtractResult, PipelineContext } from "@/etl/types";

/**
 * Placeholder extractor — OAuth stores SP-API LWA tokens; order/report pulls
 * can be added against sandbox or production SP-API endpoints later.
 */
export async function extractAmazonOrders(
  _ctx: PipelineContext,
  _sourceCreds: unknown,
  _cursorRaw: string | null
): Promise<ExtractResult> {
  return { columns: [], rows: [], nextCursor: null };
}
