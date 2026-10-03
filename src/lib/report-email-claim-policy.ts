export type ReportEmailClaimDisposition = "in_progress" | "mark_ambiguous" | "ambiguous";

/** An ambiguous claim always blocks new keys; expiration only changes a started claim into ambiguous. */
export function reportEmailClaimDisposition(input: {
  status: string;
  providerStartedAt: Date;
  now: number;
  staleAfterMs: number;
}): ReportEmailClaimDisposition {
  if (input.status === "AMBIGUOUS") return "ambiguous";
  if (
    input.status === "PROVIDER_STARTED" &&
    input.now - input.providerStartedAt.getTime() > input.staleAfterMs
  ) {
    return "mark_ambiguous";
  }
  return "in_progress";
}
