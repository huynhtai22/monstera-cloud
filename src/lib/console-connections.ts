/** Count saved connections, including disconnected records with retained history. */
export function countConsoleConnections(rows: readonly { id: string }[]): number {
  return new Set(rows.map(row => row.id)).size;
}

/** Group only a verified manager identity; similar names are not evidence of duplication. */
export function groupConsoleConnections<T extends { id: string; provider?: string; managerBadge?: string | null }>(rows: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.managerBadge ? `${row.provider}:${row.managerBadge}` : row.id;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}
