import type { ClassifiedError } from "./error-taxonomy";
import { nextActionForError, type IngestionNextAction } from "./error-taxonomy";

export type AlertReason = "auth" | "exhausted_retries" | "stale";

export function shouldNotifyIngestionFailure(opts: {
  classified: ClassifiedError | null | undefined;
  retryCount?: number;
  maxRetries?: number;
  rowsSynced?: number;
}): { notify: boolean; reason: AlertReason | null; action: IngestionNextAction } {
  const action = nextActionForError(opts.classified);
  if (opts.classified?.kind === "auth") {
    return { notify: true, reason: "auth", action };
  }
  const retryCount = opts.retryCount ?? 0;
  const maxRetries = opts.maxRetries ?? 0;
  if (maxRetries > 0 && retryCount >= maxRetries) {
    return { notify: true, reason: "exhausted_retries", action };
  }
  return { notify: false, reason: null, action };
}

export function shouldNotifyStale(hoursStale: number): boolean {
  return hoursStale >= 26;
}
