/**
 * Prevent open redirects: only allow same-origin relative paths.
 */
export function safeCallbackUrl(raw: string | null | undefined, fallback: string): string {
  if (!raw || typeof raw !== "string") return fallback;
  const t = raw.trim();
  if (!t.startsWith("/") || t.startsWith("//")) return fallback;
  return t;
}
