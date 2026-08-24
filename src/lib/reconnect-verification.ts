export type ReconnectStatusSnapshot = {
  status: string;
  updatedAt: string;
  hasError: boolean;
};

export type ReconnectVerificationOutcome =
  | "pending"
  | "success"
  | "cancelled"
  | "timeout";

export function isVerifiedReconnectSuccess(
  snapshot: ReconnectStatusSnapshot | null,
  baselineUpdatedAt: string,
): boolean {
  if (!snapshot || snapshot.status !== "connected" || snapshot.hasError) return false;

  const baseline = new Date(baselineUpdatedAt).getTime();
  const updated = new Date(snapshot.updatedAt).getTime();
  return Number.isFinite(baseline) && Number.isFinite(updated) && updated > baseline;
}

export function resolveReconnectVerification(input: {
  snapshot: ReconnectStatusSnapshot | null;
  baselineUpdatedAt: string;
  popupClosed: boolean;
  timedOut: boolean;
}): ReconnectVerificationOutcome {
  if (isVerifiedReconnectSuccess(input.snapshot, input.baselineUpdatedAt)) return "success";
  if (input.timedOut) return "timeout";
  if (input.popupClosed) return "cancelled";
  return "pending";
}
