import type { ExtractResult, PipelineContext } from "@/etl/types";

/** Placeholder until Lazada order/finance APIs are wired into the ETL runner. */
export async function extractLazadaOrders(
  _ctx: PipelineContext,
  _sourceCreds: unknown,
  _cursorRaw: string | null
): Promise<ExtractResult> {
  return { columns: [], rows: [], nextCursor: null };
}
