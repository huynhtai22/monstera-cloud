/** Maps DB Connection.provider → dashboard catalog card id (one connect slot per type). */
export function integrationCatalogId(provider: string): string {
  const p = (provider || '').toLowerCase();
  if (p === 'tiktok') return 'tiktok_shop';
  if (p === 'shopee') return 'shopee';
  return provider;
}
