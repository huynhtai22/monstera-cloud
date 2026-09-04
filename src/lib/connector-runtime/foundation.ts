/**
 * Connector Runtime v1 — Foundation.
 *
 * Pure artifact lifecycle: content hashing, retention metadata, bounds, and
 * zero-provider-call replay. No database access, no network access here.
 */
import { randomUUID, createHash } from "node:crypto";
import {
  MAX_ARTIFACTS_PER_RUN,
  MAX_ARTIFACT_BYTES,
  RUN_ARTIFACT_RETENTION_DAYS,
  assertConnectorProviderId,
  type RuntimeArtifact,
} from "./types";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

export function hashArtifactPayload(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(payload) ?? null))
    .digest("hex");
}

export function retainedUntilFor(createdAt: Date): Date {
  return new Date(createdAt.getTime() + RUN_ARTIFACT_RETENTION_DAYS * 86_400_000);
}

export function isArtifactRetained(
  artifact: Pick<RuntimeArtifact, "retainedUntil">,
  now: Date = new Date(),
): boolean {
  return new Date(artifact.retainedUntil).getTime() > now.getTime();
}

export function buildArtifact(input: {
  workspaceId: string;
  connectionId: string;
  runId: string;
  provider: string;
  kind: string;
  payload: unknown;
  createdAt?: Date;
}): RuntimeArtifact {
  if (!input.workspaceId || !input.connectionId || !input.runId || !input.kind) {
    throw new Error("Artifact requires workspaceId, connectionId, runId and kind.");
  }
  const provider = assertConnectorProviderId(input.provider);
  const createdAt = input.createdAt ?? new Date();
  return {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    runId: input.runId,
    provider,
    kind: input.kind,
    payloadHash: hashArtifactPayload(input.payload),
    payload: input.payload,
    createdAt: createdAt.toISOString(),
    retainedUntil: retainedUntilFor(createdAt).toISOString(),
  };
}

/** Enforce bounded artifacts before persistence or evaluation. */
export function assertArtifactBounds(artifacts: RuntimeArtifact[]): void {
  if (artifacts.length > MAX_ARTIFACTS_PER_RUN) {
    throw new Error(
      `Artifact set exceeds bound of ${MAX_ARTIFACTS_PER_RUN} per run (got ${artifacts.length}).`
    );
  }
  for (const artifact of artifacts) {
    const bytes = Buffer.byteLength(JSON.stringify(artifact.payload ?? null), "utf8");
    if (bytes > MAX_ARTIFACT_BYTES) {
      throw new Error(
        `Artifact '${artifact.kind}' exceeds bound of ${MAX_ARTIFACT_BYTES} bytes (got ${bytes}).`
      );
    }
  }
}

/** Recompute the content hash; any stored-payload divergence fails. */
export function verifyArtifactIntegrity(artifact: RuntimeArtifact): void {
  if (hashArtifactPayload(artifact.payload) !== artifact.payloadHash) {
    throw new Error(`Artifact integrity failure for '${artifact.kind}' (${artifact.id}).`);
  }
}

/**
 * Replay gateway. A replay must never reach an external provider: the
 * forbidden gateway throws on any use, so a passing replay is proof that
 * evaluation consumed stored artifacts only.
 */
export interface ReplayGateway {
  fetchReport(request: unknown): Promise<unknown>;
  fetchAccount(request: unknown): Promise<unknown>;
}

export function forbiddenReplayGateway(reason = "Provider calls are forbidden during replay."): ReplayGateway {
  const deny = async (): Promise<unknown> => {
    throw new Error(reason);
  };
  return { fetchReport: deny, fetchAccount: deny };
}

/**
 * Re-run a pure evaluator against stored artifacts. The gateway is threaded
 * through so any evaluator that touches the network fails loudly instead of
 * silently issuing provider calls.
 */
export function replayGateAEvaluation<T>(
  artifacts: RuntimeArtifact[],
  gateway: ReplayGateway,
  evaluate: (artifacts: RuntimeArtifact[], gateway: ReplayGateway) => T,
): T {
  assertArtifactBounds(artifacts);
  for (const artifact of artifacts) verifyArtifactIntegrity(artifact);
  return evaluate(artifacts, gateway);
}
