import type { BatchImportJobResult } from "./warehouse-import-job";

/** Targeted account retries must retain receipts for accounts not re-executed.
 * Connection-wide legacy jobs keep their existing aggregation contract. */
export function mergeTargetedImportReceipts(previous: BatchImportJobResult[], current: BatchImportJobResult[]) {
  const targeted = (row: BatchImportJobResult) => !!(row.accountId ?? row.adAccountId);
  if (!previous.length || !previous.every(targeted) || !current.every(targeted)) return current;
  const key = (row: BatchImportJobResult) => JSON.stringify([row.connectionId, row.provider, row.accountId ?? row.adAccountId, row.executionSince ?? null, row.executionUntil ?? null]);
  const receipts = new Map(previous.map(row => [key(row), row]));
  for (const row of current) receipts.set(key(row), row);
  return [...receipts.values()];
}
