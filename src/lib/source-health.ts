/**
 * Source health counting for the Sources page. A `partial` sync state is
 * deliberately NOT counted as fully connected — it has its own bucket.
 */
export interface SourceHealthCounts {
  connected: number;
  needsAttention: number;
  available: number;
  partial: number;
}

export function countSourceHealthStatuses(
  integrations: Array<{ status: string }>
): SourceHealthCounts {
  let connected = 0;
  let needsAttention = 0;
  let available = 0;
  let partial = 0;
  for (const i of integrations) {
    if (i.status === "available") available += 1;
    else if (i.status === "error") needsAttention += 1;
    else if (i.status === "partial") partial += 1; // partial ≠ fully connected
    else connected += 1;
  }
  return { connected, needsAttention, available, partial };
}
