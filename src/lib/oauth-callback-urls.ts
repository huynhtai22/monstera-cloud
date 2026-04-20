/**
 * Public site base + OAuth redirect URIs for Meta Ads and Google Ads.
 * Must stay in sync with api/auth/meta-ads/* and api/auth/google-ads/* routes.
 */
export function publicBaseUrl(request: Request): string {
  const explicit = process.env.NEXTAUTH_URL?.replace(/\/$/, '');
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '')}`;
  return new URL(request.url).origin;
}

export function metaAdsOAuthRedirectUri(request: Request): string {
  return (
    process.env.META_ADS_REDIRECT_URI?.trim() ||
    `${publicBaseUrl(request)}/api/auth/meta-ads/callback`
  );
}

export function googleAdsOAuthRedirectUri(request: Request): string {
  return (
    process.env.GOOGLE_ADS_REDIRECT_URI?.trim() ||
    `${publicBaseUrl(request)}/api/auth/google-ads/callback`
  );
}

export function amazonSpOAuthRedirectUri(request: Request): string {
  return (
    process.env.AMAZON_REDIRECT_URI?.trim() ||
    `${publicBaseUrl(request)}/api/auth/amazon/callback`
  );
}
