import { classifyTransportFailure } from "@/lib/dispatch-outcome";

export type ApprovedBlueprintEmailOutcome =
  | { status: "ACCEPTED"; providerMessageId: string | null }
  | { status: "DEFINITIVE_FAILED"; failureCode: "provider_rejected" | "pre_connection_failure" }
  | { status: "AMBIGUOUS"; failureCode: "transport_ambiguous" };

export function classifyApprovedEmailResponse(response: {
  data: { id?: string } | null;
  error: unknown | null;
}): ApprovedBlueprintEmailOutcome {
  if (response.error) return { status: "DEFINITIVE_FAILED", failureCode: "provider_rejected" };
  return { status: "ACCEPTED", providerMessageId: response.data?.id ?? null };
}

export function classifyApprovedEmailException(error: unknown): ApprovedBlueprintEmailOutcome {
  return classifyTransportFailure(error) === "DEFINITIVE_FAILED"
    ? { status: "DEFINITIVE_FAILED", failureCode: "pre_connection_failure" }
    : { status: "AMBIGUOUS", failureCode: "transport_ambiguous" };
}
