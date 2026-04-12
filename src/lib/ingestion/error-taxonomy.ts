/**
 * Normalize pipeline errors for logs, UI, and alerts (priority: actionable > generic).
 */

export type IngestionErrorKind =
  | "auth"
  | "quota"
  | "network"
  | "destination"
  | "source"
  | "validation"
  | "unknown";

export type ClassifiedError = {
  kind: IngestionErrorKind;
  /** Short label for operators, e.g. [auth] */
  tag: string;
  /** Safe to show users; keep under ~500 chars */
  message: string;
};

function lower(s: string) {
  return s.toLowerCase();
}

/**
 * Classify thrown errors from extract/load/cron (best-effort string matching).
 */
export function classifyIngestionError(error: unknown): ClassifiedError {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  const msg = raw.slice(0, 2000);
  const l = lower(msg);

  if (
    l.includes("401") ||
    l.includes("403") ||
    l.includes("unauthorized") ||
    l.includes("invalid_grant") ||
    l.includes("invalid credentials") ||
    l.includes("access token") ||
    l.includes("oauth") ||
    l.includes("credential")
  ) {
    return { kind: "auth", tag: "[auth]", message: msg };
  }
  if (
    l.includes("429") ||
    l.includes("rate limit") ||
    l.includes("quota") ||
    l.includes("resource_exhausted") ||
    l.includes("too many requests")
  ) {
    return { kind: "quota", tag: "[quota]", message: msg };
  }
  if (
    l.includes("econnreset") ||
    l.includes("etimedout") ||
    l.includes("network") ||
    l.includes("fetch failed") ||
    l.includes("socket")
  ) {
    return { kind: "network", tag: "[network]", message: msg };
  }
  if (
    l.includes("spreadsheet") ||
    l.includes("sheets") ||
    l.includes("google sheet") ||
    l.includes("destination")
  ) {
    return { kind: "destination", tag: "[destination]", message: msg };
  }
  if (l.includes("extract") || l.includes("provider") || l.includes("source")) {
    return { kind: "source", tag: "[source]", message: msg };
  }
  if (l.includes("validation") || l.includes("invalid") || l.includes("schema")) {
    return { kind: "validation", tag: "[validation]", message: msg };
  }

  return { kind: "unknown", tag: "[unknown]", message: msg };
}

export function formatLogError(classified: ClassifiedError): string {
  return `${classified.tag} ${classified.message}`.trim().slice(0, 4000);
}
