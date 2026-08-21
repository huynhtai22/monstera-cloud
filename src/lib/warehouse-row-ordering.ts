/**
 * Deterministic warehouse-row ordering for delivery surfaces (Sheets add-on,
 * Looker Studio).
 *
 * Rules:
 * 1. If the request supplies an explicit account order (repeated accountId
 *    params preserve the client's selection order), rows are grouped by that
 *    order — Account 1's rows before Account 3's, regardless of names/IDs.
 * 2. With no explicit order (or for accounts missing from it), rows fall back
 *    to a stable deterministic key: platform, account name/id, date desc,
 *    campaign name, entity id. Identical queries always return identical order.
 *
 * Ordering is display-level: it re-orders the returned page only and never
 * changes query semantics, pagination cursors, or aggregation results.
 */

export type OrderableWarehouseRow = {
  platform: string;
  accountId: string;
  accountName?: string | null;
  date: Date;
  campaignName?: string | null;
  entityId?: string | null;
};

function accountSortKey(row: OrderableWarehouseRow): string {
  return (row.accountName && row.accountName.trim()) || row.accountId || "";
}

/** Deterministic fallback comparator (no explicit account order supplied). */
export function compareRowsDeterministic(a: OrderableWarehouseRow, b: OrderableWarehouseRow): number {
  const platform = a.platform.localeCompare(b.platform);
  if (platform !== 0) return platform;
  const account = accountSortKey(a).localeCompare(accountSortKey(b));
  if (account !== 0) return account;
  const date = b.date.getTime() - a.date.getTime(); // newest first
  if (date !== 0) return date;
  const campaign = (a.campaignName ?? "").localeCompare(b.campaignName ?? "");
  if (campaign !== 0) return campaign;
  return (a.entityId ?? "").localeCompare(b.entityId ?? "");
}

/** Meta account ids may appear as `act_123` or `123`; index both forms. */
function buildAccountIndex(explicitAccountIds: string[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const raw of explicitAccountIds) {
    const id = raw.trim();
    if (!id) continue;
    const bare = id.startsWith("act_") ? id.slice(4) : id;
    if (!index.has(id)) index.set(id, index.size);
    if (!index.has(bare)) index.set(bare, index.size);
  }
  return index;
}

/**
 * Stable order rows by explicit account selection order first, deterministic
 * fallback second. Rows whose account is absent from the explicit list sort
 * after the listed accounts (deterministically).
 */
export function orderRowsByExplicitAccounts<T extends OrderableWarehouseRow>(
  rows: T[],
  explicitAccountIds: string[]
): T[] {
  const accountIndex = buildAccountIndex(explicitAccountIds);
  if (accountIndex.size === 0) return [...rows].sort(compareRowsDeterministic);

  const accountRank = (row: T): number => {
    const direct = accountIndex.get(row.accountId);
    if (direct !== undefined) return direct;
    const bare = row.accountId.startsWith("act_") ? row.accountId.slice(4) : row.accountId;
    return accountIndex.get(bare) ?? Number.MAX_SAFE_INTEGER;
  };

  return [...rows].sort((a, b) => {
    const rank = accountRank(a) - accountRank(b);
    if (rank !== 0) return rank;
    return compareRowsDeterministic(a, b);
  });
}
