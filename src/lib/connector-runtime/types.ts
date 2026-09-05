/**
 * Connector Runtime v1 — shared types.
 *
 * Provider identifiers are plain strings validated at every boundary.
 * Only Google Gate A is implemented; Meta and TikTok must not begin
 * until Google Gate A passes.
 */

export const CONNECTOR_PROVIDERS = [
  "google_ads",
  "meta_ads",
  "tiktok_business",
] as const;

export type ConnectorProviderId = (typeof CONNECTOR_PROVIDERS)[number];

/**
 * Accept only known provider identifier strings. Anything else — objects,
 * enums from other domains, unknown strings — is rejected at the boundary.
 */
export function assertConnectorProviderId(value: unknown): ConnectorProviderId {
  if (
    typeof value !== "string" ||
    !(CONNECTOR_PROVIDERS as readonly string[]).includes(value)
  ) {
    throw new Error(
      `Unknown connector provider identifier: ${typeof value === "string" ? value : typeof value}.`
    );
  }
  return value as ConnectorProviderId;
}

/** Retention window for runtime artifacts. Enforcement (expiry jobs) is out of scope. */
export const RUN_ARTIFACT_RETENTION_DAYS = 30;

/** Bounded artifacts: caps per run and per artifact payload. */
export const MAX_ARTIFACTS_PER_RUN = 25;
export const MAX_ARTIFACT_BYTES = 256_000;

/** Artifact kinds the Google Gate A evaluator requires. */
export const GOOGLE_GATE_A_REQUIRED_KINDS = [
  "connection",
  "report",
  "warehouse",
  "reconciliation",
] as const;

export interface RuntimeArtifact {
  id: string;
  workspaceId: string;
  connectionId: string;
  runId: string;
  provider: ConnectorProviderId;
  kind: string;
  payloadHash: string;
  payload: unknown;
  /** ISO timestamps. retainedUntil is always createdAt + 30 days. */
  createdAt: string;
  retainedUntil: string;
}

export type GateAVerdict = "PASS" | "FAIL";

export interface GateAEvaluation {
  verdict: GateAVerdict;
  reasons: string[];
  /** Content hashes of the artifacts the verdict was computed from. */
  artifactHashes: string[];
  evaluatedAt: string;
}

export interface ShadowComparison {
  match: boolean;
  differences: string[];
}
