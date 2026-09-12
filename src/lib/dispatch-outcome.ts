/**
 * Tri-state delivery outcome shared by every scheduled-dispatch transport.
 *
 * CONFIRMED: the provider responded with a success status.
 * DEFINITIVE_FAILED: the provider rejected the request with a clear non-2xx
 *   response, or the failure is provably pre-connection (nothing was sent).
 * AMBIGUOUS: the request may have reached the provider and been accepted but
 *   its outcome could not be observed (timeout, abort, connection reset after
 *   sending, malformed response). Ambiguous outcomes must never be retried
 *   automatically for the same occurrence.
 */
export type DispatchChannelOutcome = "CONFIRMED" | "DEFINITIVE_FAILED" | "AMBIGUOUS";

/**
 * Classifies a transport failure. Only provably pre-connection failures are
 * definitive; every other failure — including generic network exceptions — is
 * treated as ambiguous because the provider may have accepted the request.
 */
export function classifyTransportFailure(err: unknown): DispatchChannelOutcome {
  const cause = (err as { cause?: { code?: string } } | null)?.cause;
  const code = cause?.code;
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "DEFINITIVE_FAILED";
  }
  return "AMBIGUOUS";
}
