/**
 * Lightweight event hooks for GTM `dataLayer` (and future PostHog).
 * Safe no-ops on the server and when `dataLayer` is missing.
 */
export function trackEvent(name: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { dataLayer?: unknown[] };
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push({ event: name, ...params });
}

export function trackOnce(sessionKey: string, name: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, "1");
  } catch {
    /* private mode */
  }
  trackEvent(name, params);
}
