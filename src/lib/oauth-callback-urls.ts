/** Public site base + OAuth redirect URI helpers. */
export function publicBaseUrl(request: Request): string {
  const explicit = process.env.NEXTAUTH_URL?.replace(/\/$/, '');
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '')}`;
  return new URL(request.url).origin;
}

/**
 * The unified OAuth callback route is the only callback route used by new
 * source connections. Keeping its construction here makes the public config
 * shown in the console match the redirect_uri sent to OAuth providers.
 */
export function providerOAuthCallbackUri(baseUrl: string, providerId: string): string {
  const callback = new URL('/api/auth/callback', baseUrl);
  callback.searchParams.set('provider', providerId);
  return callback.toString();
}

export function metaAdsOAuthRedirectUri(request: Request): string {
  return (
    process.env.META_ADS_REDIRECT_URI?.trim() ||
    `${publicBaseUrl(request)}/api/auth/meta-ads/callback`
  );
}

export function googleAdsOAuthRedirectUri(request: Request): string {
  return providerOAuthCallbackUri(publicBaseUrl(request), 'google_ads');
}

export function amazonSpOAuthRedirectUri(request: Request): string {
  return (
    process.env.AMAZON_REDIRECT_URI?.trim() ||
    `${publicBaseUrl(request)}/api/auth/amazon/callback`
  );
}

export function lazadaOAuthRedirectUri(request: Request): string {
  return (
    process.env.LAZADA_REDIRECT_URI?.trim() ||
    `${publicBaseUrl(request)}/api/auth/lazada/callback`
  );
}
