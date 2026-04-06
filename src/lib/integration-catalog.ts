/** Maps DB Connection.provider → console catalog card id (one connect slot per type). */
export function integrationCatalogId(provider: string): string {
  const p = (provider || '').toLowerCase();
  if (p === 'tiktok') return 'tiktok_shop';
  if (p === 'tiktok_shop') return 'tiktok_shop';
  if (p === 'tiktok_business') return 'tiktok_business';
  if (p === 'shopee') return 'shopee';
  if (p === 'meta_ads') return 'meta_ads';
  if (p === 'google_ads') return 'google_ads';
  return provider;
}
