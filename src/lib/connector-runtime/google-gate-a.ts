/**
 * Connector Runtime v1 — Google Gate A.
 *
 * Pure evaluation of one Google Ads sync run from its stored artifacts.
 * No database access, no provider calls. Meta and TikTok are rejected
 * here until Google Gate A passes; they must not begin.
 */
import { GOOGLE_GATE_A_REQUIRED_KINDS, assertConnectorProviderId } from "./types";
import { verifyArtifactIntegrity } from "./foundation";
import type { GateAEvaluation, RuntimeArtifact } from "./types";

export interface GateAWarehouseSummary {
  rowsWritten: number;
  /** A zero-row run passes only with an explicit justification. */
  zeroRowJustified: boolean;
}

export interface GateAVariance {
  metric: string;
  /** Null means the provider total was zero and no percentage exists. */
  percentVariance: number | null;
}

export interface GoogleGateAInput {
  provider: string;
  runId: string;
  artifacts: RuntimeArtifact[];
  warehouse: GateAWarehouseSummary;
  reconciliation: {
    variances: GateAVariance[];
    /** Maximum tolerated percentage variance per metric. */
    tolerancePercent: number;
  };
}

/**
 * Artifacts are a bounded evidence collection, not an ordered execution log.
 * Persisted replays may arrive in database order, so publish a canonical
 * multiset representation: stable across retrieval order while retaining every
 * occurrence for integrity/audit evidence.
 */
function canonicalArtifactHashes(artifacts: RuntimeArtifact[]): string[] {
  return artifacts.map((artifact) => artifact.payloadHash).sort();
}

export function evaluateGoogleGateA(input: GoogleGateAInput): GateAEvaluation {
  const reasons: string[] = [];
  const fail = (reason: string) => reasons.push(reason);

  let provider: string;
  try {
    provider = assertConnectorProviderId(input.provider);
  } catch {
    return failVerdict(input, [`unknown-provider:${String(input.provider)}`]);
  }
  if (provider !== "google_ads") {
    return failVerdict(input, [
      `provider-not-in-scope:${provider} (only google_ads may begin; meta_ads and tiktok_business are deferred until Google Gate A passes)`,
    ]);
  }

  const byKind = new Map(input.artifacts.map((artifact) => [artifact.kind, artifact]));
  for (const kind of GOOGLE_GATE_A_REQUIRED_KINDS) {
    if (!byKind.has(kind)) fail(`missing-artifact:${kind}`);
  }
  for (const artifact of input.artifacts) {
    if (artifact.runId !== input.runId) fail(`foreign-run-artifact:${artifact.kind}`);
    if (artifact.provider !== "google_ads") fail(`foreign-provider-artifact:${artifact.kind}`);
    try {
      verifyArtifactIntegrity(artifact);
    } catch {
      fail(`integrity-failure:${artifact.kind}`);
    }
  }

  if (input.warehouse.rowsWritten < 0) fail("negative-rows-written");
  if (input.warehouse.rowsWritten === 0 && !input.warehouse.zeroRowJustified) {
    fail("zero-rows-unjustified");
  }

  for (const variance of input.reconciliation.variances) {
    if (
      variance.percentVariance !== null &&
      Math.abs(variance.percentVariance) > input.reconciliation.tolerancePercent
    ) {
      fail(`variance-breach:${variance.metric}`);
    }
  }

  if (reasons.length > 0) return failVerdict(input, reasons);
  return {
    verdict: "PASS",
    reasons: [],
    artifactHashes: canonicalArtifactHashes(input.artifacts),
    evaluatedAt: new Date().toISOString(),
  };

  function failVerdict(
    failedInput: GoogleGateAInput,
    failedReasons: string[],
  ): GateAEvaluation {
    return {
      verdict: "FAIL",
      reasons: failedReasons,
      artifactHashes: canonicalArtifactHashes(failedInput.artifacts),
      evaluatedAt: new Date().toISOString(),
    };
  }
}
