import type { ExtractResult } from "@/etl/types";

/** Placeholder until Lazada order/finance APIs are wired into the ETL runner. */
export async function extractLazadaOrders(): Promise<ExtractResult> {
  return { columns: [], rows: [], nextCursor: null };
}
