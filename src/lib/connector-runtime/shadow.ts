/**
 * Connector Runtime v1 — shadow-mode comparison.
 *
 * Compares the legacy production outcome against the v1 Gate A verdict for
 * the same run. Pure and side-effect free: shadow evaluation must never
 * change production behavior, issue provider calls, or write anything.
 */
import type { GateAEvaluation, ShadowComparison } from "./types";

export interface LegacySyncOutcome {
  /** Legacy outcome vocabulary, e.g. "success" | "partial" | "failed". */
  outcome: string;
  rowsIngested: number;
  error?: string | null;
}

export function compareShadowRun(
  legacy: LegacySyncOutcome,
  v1: GateAEvaluation,
): ShadowComparison {
  const differences: string[] = [];
  const legacyOk = legacy.outcome === "success";
  const v1Pass = v1.verdict === "PASS";

  if (legacyOk !== v1Pass) {
    differences.push(`outcome-mismatch: legacy=${legacy.outcome} v1=${v1.verdict}`);
  }
  if (legacyOk && v1Pass && legacy.rowsIngested <= 0) {
    differences.push("rows-mismatch: legacy success reported no ingested rows");
  }
  if (!legacyOk && v1Pass && legacy.error) {
    differences.push(`legacy-error-unexplained-by-v1: ${legacy.error.slice(0, 200)}`);
  }
  return { match: differences.length === 0, differences };
}
