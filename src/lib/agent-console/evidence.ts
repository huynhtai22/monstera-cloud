import {
  agentConsoleTransaction,
  requireWorkspaceRole,
  AgentConsoleError,
} from "./persistence";

export function sanitizeProvenance<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;
  if (Array.isArray(data)) {
    return data.map(sanitizeProvenance) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  const sensitiveRegex = /token|secret|password|credential|apikey|api_key|auth/i;
  for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
    if (sensitiveRegex.test(key)) {
      result[key] = "[REDACTED]";
    } else if (typeof val === "object" && val !== null) {
      result[key] = sanitizeProvenance(val);
    } else {
      result[key] = val;
    }
  }
  return result as T;
}

export async function getEvidenceDetail(
  userId: string,
  workspaceId: string,
  evidenceId: string
) {
  if (!workspaceId || !evidenceId) {
    throw new AgentConsoleError("invalid_input", "workspaceId and evidenceId are required", 400);
  }

  return agentConsoleTransaction(async (tx) => {
    await requireWorkspaceRole(tx, workspaceId, userId, ["owner", "admin", "member", "viewer"]);

    const evidence = await tx.agentEvidenceSnapshot.findFirst({
      where: { id: evidenceId, workspaceId },
    });

    if (!evidence) {
      throw new AgentConsoleError("evidence_not_found", "Evidence snapshot not found", 404);
    }

    if (evidence.isExpired) {
      return {
        evidence: {
          id: evidence.id,
          workspaceId: evidence.workspaceId,
          datasetFingerprint: evidence.datasetFingerprint,
          isExpired: true,
          retentionStatus: "marked_expired",
          message: "Evidence snapshot is expired and unavailable per retention policy",
          createdAt: evidence.createdAt,
        },
      };
    }

    // Redacted immutable facts: safe for viewer/member display without raw credentials
    return {
      evidence: {
        id: evidence.id,
        workspaceId: evidence.workspaceId,
        datasetFingerprint: evidence.datasetFingerprint,
        grain: evidence.grain,
        metrics: evidence.metrics,
        inventory: evidence.inventory,
        actualSince: evidence.actualSince,
        actualUntil: evidence.actualUntil,
        currencies: evidence.currencies,
        timezones: evidence.timezones,
        calculationVersion: evidence.calculationVersion,
        provenance: sanitizeProvenance(evidence.provenance),
        citations: sanitizeProvenance(evidence.citations),
        isExpired: false,
        retentionStatus: "retained",
        createdAt: evidence.createdAt,
      },
    };
  });
}

