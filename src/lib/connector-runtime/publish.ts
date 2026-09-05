/**
 * Connector Runtime v1 — fenced transactional publication.
 *
 * Persists a Gate A verdict artifact plus exactly one audit event inside a
 * single tenant-fenced transaction. Insert-only: this module exposes no
 * update or delete path, so published verdicts are immutable.
 */
import prisma from "@/lib/prisma";
import { withSystemScope } from "@/lib/tenant-guard";
import { assertArtifactBounds, buildArtifact } from "./foundation";
import { assertConnectorProviderId } from "./types";
import type { GateAEvaluation } from "./types";

export async function publishGateAVerdict(input: {
  workspaceId: string;
  connectionId: string;
  runId: string;
  provider: string;
  evaluation: GateAEvaluation;
  actorUserId: string;
}): Promise<{ artifactId: string; verdict: GateAEvaluation["verdict"] }> {
  const provider = assertConnectorProviderId(input.provider);
  if (provider !== "google_ads") {
    throw new Error(
      `Only google_ads verdicts may be published; ${provider} must wait until Google Gate A passes.`
    );
  }
  if (!input.workspaceId || !input.connectionId || !input.runId || !input.actorUserId) {
    throw new Error("Publication requires workspaceId, connectionId, runId and actorUserId.");
  }

  const artifact = buildArtifact({
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    runId: input.runId,
    provider,
    kind: "gate_a_verdict",
    payload: input.evaluation,
  });
  assertArtifactBounds([artifact]);

  return withSystemScope(() =>
    prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: input.actorUserId },
        select: { id: true, platformRole: true },
      });
      if (actor?.platformRole !== "OPERATOR") {
        throw new Error("Persisted OPERATOR platform role required to publish a gate verdict.");
      }      const record = await tx.connectorRunArtifact.create({
        data: {
          workspaceId: artifact.workspaceId,
          connectionId: artifact.connectionId,
          runId: artifact.runId,
          provider: artifact.provider,
          kind: artifact.kind,
          payloadHash: artifact.payloadHash,
          payload: JSON.parse(JSON.stringify(artifact.payload)),
          retainedUntil: new Date(artifact.retainedUntil),
        },
        select: { id: true },
      });
      await tx.auditEvent.create({
        data: {
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          action: "connector_runtime.gate_a_published",
          resource: "connection",
          resourceId: input.connectionId,
          metadata: {
            runId: input.runId,
            artifactId: record.id,
            verdict: input.evaluation.verdict,
            reasons: input.evaluation.reasons,
            reviewerUserId: actor.id,
            reviewerRole: "OPERATOR",
          },
        },
      });
      return { artifactId: record.id, verdict: input.evaluation.verdict };
    }),
  );
}
