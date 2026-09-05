import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import prisma from "@/lib/prisma";
import { withSystemScope } from "@/lib/tenant-guard";
import { MANDATORY_PRIOR_GATES, type CertificationEvidencePack, type EvidencePackSignOffInput } from "./types";
import { generateReviewerMarkdown } from "./report-generator";

/** Sort every object recursively, not just top-level keys. Arrays retain their semantic order. */
export function evidenceHash(pack: CertificationEvidencePack): string {
  const { operatorSignOff: _approval, ...base } = pack;
  void _approval;
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]))
      : value;
  return createHash("sha256").update(JSON.stringify(canonical(base))).digest("hex");
}

export function assertMandatoryPriorGatesPassed(pack: CertificationEvidencePack): void {
  for (const gate of MANDATORY_PRIOR_GATES) {
    const outcomes = pack.gateOutcomes.filter(g => g.gate === gate);
    if (outcomes.length !== 1) throw new Error(`Mandatory gate '${gate}' must appear exactly once (MISSING or duplicate).`);
    const outcome = outcomes[0];
    if (gate === "SANDBOX_VERIFIED" && outcome.status === "NOT_APPLICABLE") {
      // Only Google's non-serving test accounts have an approved structural exemption.
      if (pack.provider !== "google_ads" || !outcome.notApplicableReason?.trim() || !outcome.alternativeVerificationPath?.trim()) {
        throw new Error("Unjustified sandbox exemption: approved Google structural reason and alternative verification path required.");
      }
    } else if (outcome.status !== "PASSED") {
      throw new Error(`Security violation: mandatory gate '${gate}' has status '${outcome.status}'. All prior gates must be PASSED.`);
    }
  }
  if (pack.blockers.some(b => b.category !== "HUMAN_SIGN_OFF_REQUIRED")) throw new Error("Unresolved evidence blockers prevent sign-off.");
}

type Scope = { workspaceId: string; evidencePackId: string; expectedEvidencePackHash: string };
type Runtime = { commitSha: string; schemaVersion: string };

async function lockedEvidence(tx: Pick<Prisma.TransactionClient, "$queryRaw">, input: Scope) {
  // Lock the persisted record itself. PostgreSQL serializes independent processes here.
  // Ambiguous historical duplicates fail closed instead of selecting the most convenient pack.
  const records = await tx.$queryRaw<Array<{ id: string; pack: Prisma.JsonValue; certifiedPack: Prisma.JsonValue | null }>>`
    SELECT id, pack, "certifiedPack" FROM "EvidencePackRecord"
    WHERE "workspaceId" = ${input.workspaceId} AND "jobId" = ${input.evidencePackId}
    ORDER BY id FOR UPDATE`;
  if (!records.length) throw new Error("Evidence pack not found in database for requested workspace/run.");
  if (records.length !== 1) throw new Error("Ambiguous evidence records; generate a new certification run.");
  const record = records[0];
  const pack = record.pack as unknown as CertificationEvidencePack;
  if (pack.workspaceId !== input.workspaceId || pack.runId !== input.evidencePackId) throw new Error("Evidence pack not found for requested workspace/run.");
  return { record, pack: structuredClone(pack) };
}

function validateEvidence(pack: CertificationEvidencePack, input: Scope, runtime: Runtime) {
  const ineligible = "Security violation: Only live_certification_evidence packs are eligible for human review sign-off. Synthetic fixtures and sandbox-only records cannot be signed off.";
  if (pack.evidenceClass === "synthetic_fixture") throw new Error(ineligible);
  if (pack.workingTreeDirty !== false || pack.metadata?.workingTreeDirty !== false) throw new Error("Security violation: Cannot sign off an evidence pack produced from a dirty or uncommitted working tree.");
  const hash = evidenceHash(pack);
  if (hash !== input.expectedEvidencePackHash) throw new Error("Security violation: Evidence pack hash mismatch.");
  if (pack.evidenceClass !== "live_certification_evidence") throw new Error(ineligible);
  if (!/^[a-f0-9]{40}$/.test(runtime.commitSha) || pack.metadata.commitSha !== runtime.commitSha) throw new Error("Immutable commit SHA mismatch or missing runtime SHA.");
  if (!runtime.schemaVersion || pack.metadata.schemaVersion !== runtime.schemaVersion) throw new Error("Schema version mismatch.");
  return hash;
}

export async function approveEvidence(input: EvidencePackSignOffInput, runtime: Runtime) {
  if (typeof input.reviewerUserId !== "string" || !input.reviewerUserId.trim()) throw new Error("Security violation: Valid authenticated reviewerUserId is required for sign-off.");
  if (!input.workspaceId || !input.evidencePackId || !input.expectedEvidencePackHash || !input.reviewerUserId) throw new Error("Workspace, evidence pack, hash and authenticated reviewerUserId are required.");
  if (input.reviewerRole !== "OPERATOR") throw new Error(`Security violation: Reviewer role '${input.reviewerRole}' is not authorized for certification sign-off. Final pilot certification requires OPERATOR platform role.`);
  return withSystemScope(() => prisma.$transaction(async tx => {
    const reviewer = await tx.user.findUnique({ where: { id: input.reviewerUserId }, select: { id: true, platformRole: true } });
    if (reviewer?.platformRole !== "OPERATOR") throw new Error("Persisted OPERATOR role required.");
    const { record, pack } = await lockedEvidence(tx, input);
    if (record.certifiedPack || pack.operatorSignOff || pack.highestProvenLevel === "PILOT_CERTIFIED") throw new Error(`Security violation: Evidence pack '${pack.runId}' has already been signed off. Repeated approval is prohibited.`);
    const hash = validateEvidence(pack, input, runtime);
    assertMandatoryPriorGatesPassed(pack);
    const signedAt = new Date().toISOString();
    pack.operatorSignOff = { reviewerUserId: reviewer.id, reviewerRole: "OPERATOR", signedAt, evidencePackId: pack.runId, evidencePackHash: hash, commitSha: pack.metadata.commitSha, schemaVersion: pack.metadata.schemaVersion, comments: input.comments };
    pack.highestProvenLevel = "PILOT_CERTIFIED";
    pack.pilotEligible = pack.certificationEligible = pack.metadata.certificationEligible = true;
    pack.blockers = [];
    pack.gateOutcomes = [...pack.gateOutcomes.filter(g => g.gate !== "PILOT_CERTIFIED"), { gate: "PILOT_CERTIFIED", status: "PASSED", timestamp: signedAt, details: `Signed off by verified OPERATOR ${reviewer.id}`, evidence: { operatorSignOff: pack.operatorSignOff } }];
    await tx.evidencePackRecord.update({ where: { id: record.id }, data: { certifiedPack: JSON.parse(JSON.stringify(pack)) } });
    await tx.auditEvent.create({ data: { workspaceId: input.workspaceId, actorUserId: reviewer.id, action: "ad_connector_certification.signed_off", resource: "connection", resourceId: pack.provider, metadata: { runId: pack.runId, evidenceRecordId: record.id, evidencePackHash: hash, reviewerUserId: reviewer.id, reviewerRole: "OPERATOR", highestProvenLevel: "PILOT_CERTIFIED", signedAt } } });
    // Render before commit too: failures never leave a partial approval behind.
    return { signedEvidencePack: pack, markdownReport: generateReviewerMarkdown(pack) };
  }, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 20_000 }));
}

export async function attestEvidence(input: Scope & { ownerUserId: string; comments?: string }, runtime: Runtime) {
  if (typeof input.ownerUserId !== "string" || !input.ownerUserId.trim()) throw new Error("Valid authenticated ownerUserId is required for attestation.");
  return withSystemScope(() => prisma.$transaction(async tx => {
    const workspace = await tx.workspace.findUnique({ where: { id: input.workspaceId }, select: { ownerId: true } });
    const member = await tx.workspaceMember.findFirst({ where: { workspaceId: input.workspaceId, userId: input.ownerUserId, role: "owner" } });
    if (workspace?.ownerId !== input.ownerUserId && !member) throw new Error("Verified workspace owner required.");
    const { record, pack } = await lockedEvidence(tx, input);
    const hash = validateEvidence(pack, input, runtime);
    const previous = await tx.auditEvent.findFirst({ where: { workspaceId: input.workspaceId, action: "ad_connector_certification.owner_attested", metadata: { path: ["evidenceRecordId"], equals: record.id } } });
    if (previous || pack.ownerAttestation) throw new Error("Evidence pack has already received owner attestation.");
    const attestedAt = new Date().toISOString();
    await tx.auditEvent.create({ data: { workspaceId: input.workspaceId, actorUserId: input.ownerUserId, action: "ad_connector_certification.owner_attested", resource: "connection", resourceId: pack.provider, metadata: { runId: pack.runId, evidenceRecordId: record.id, evidencePackHash: hash, ownerUserId: input.ownerUserId, attestedAt, comments: input.comments ?? null } } });
    // Response-only projection; base evidence and approval are never changed by attestation.
    pack.ownerAttestation = { ownerUserId: input.ownerUserId, ownerRole: "owner", attestedAt, comments: input.comments };
    return { pack, markdownReport: generateReviewerMarkdown(pack) };
  }));
}
