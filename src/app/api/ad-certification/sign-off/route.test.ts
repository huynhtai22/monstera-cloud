import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import prisma from "@/lib/prisma";
import { setAuthSessionOverride } from "@/lib/auth-session";
import { POST } from "./route";
import { CertificationHarness } from "@/lib/ad-certification/harness";
import { TestCertificationHarness } from "@/lib/ad-certification/test-simulation-adapter";
import type { CertificationEvidencePack } from "@/lib/ad-certification/types";

const originalUser = (prisma as any).user;
const originalWorkspace = (prisma as any).workspace;
const originalWorkspaceMember = (prisma as any).workspaceMember;
const originalEvidencePackRecord = (prisma as any).evidencePackRecord;
const originalAuditEvent = (prisma as any).auditEvent;

function jsonRequest(body: unknown) {
  return new Request("https://monstera.test/api/ad-certification/sign-off", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ad-certification/sign-off (Server-Authenticated Certification Sign-Off)", () => {
  const testHarness = new TestCertificationHarness();
  let livePack: CertificationEvidencePack;
  let syntheticPack: CertificationEvidencePack;
  let incompletePack: CertificationEvidencePack;
  let livePackHash: string;
  let auditEvents: Array<Record<string, unknown>> = [];

  beforeEach(async () => {
    auditEvents = [];

    // Create a complete live evidence pack with all prior gates passed
    const liveRun = await testHarness.executeTestSimulation(
      {
        workspaceId: "ws-primary",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "b-live-test",
        evidenceClass: "live_certification_evidence",
        trustedRuntimeMetadata: {
          commitSha: "2d963fd5e0bf226197abf5c65679462e6d915d90",
          schemaVersion: "20260904160000",
          workingTreeDirty: false,
        },
        simulation: {
          simulatePersistedLiveState: true,
          simulatedProviderAccessFacts: {
            observedApiVersion: "v23",
            appAccountMode: "live",
            grantedScopesOrPermissions: ["https://www.googleapis.com/auth/adwords"],
            accessLevelStatus: "basic",
            authorizationModel: "oauth2_user_consent",
            tokenLifecycleModel: "refreshable_offline",
            verificationSource: "portal_owner_confirmed",
            verifiedAt: new Date().toISOString(),
            status: "VERIFIED",
          },
          simulatedConnection: true,
          simulatedWarehouseRows: 42,
          simulatedWarehouseTotals: { spend: 5000, impressions: 20000, clicks: 1200, conversions: 80, revenue: 15000 },
          simulatedDestinationReceiptId: "rcpt_clean_01",
          simulatedRecoveryPassed: true,
        },
        nativeComparison: { spend: 5000, impressions: 20000, clicks: 1200, conversions: 80, revenue: 15000 },
        snapshotTiming: {
          accountTimezone: "Asia/Ho_Chi_Minh",
          currency: "VND",
          nativeRetrievalTime: "2026-08-08T01:00:00Z",
          monsteraDataThroughTime: "2026-08-08T01:00:00Z",
          warehouseQueryTime: "2026-08-08T01:02:00Z",
        },
      }
    );
    livePack = liveRun.evidencePack;
    livePackHash = CertificationHarness.computeEvidencePackHash(livePack);

    // Create a synthetic pack
    const synthRun = await testHarness.execute({
      workspaceId: "ws-primary",
      provider: "google_ads",
      accountId: "123-456-7890",
      startDate: "2026-08-01",
      endDate: "2026-08-07",
      buildId: "b-synth-test",
      evidenceClass: "synthetic_fixture",
      trustedRuntimeMetadata: {
        commitSha: "2d963fd5e0bf226197abf5c65679462e6d915d90",
        schemaVersion: "20260904160000",
        workingTreeDirty: false,
      },
    });
    syntheticPack = synthRun.evidencePack;

    // Create an incomplete pack (missing RECOVERY_VERIFIED)
    incompletePack = JSON.parse(JSON.stringify(livePack));
    incompletePack.runId = "pack-incomplete-01";
    const recGate = incompletePack.gateOutcomes.find((g) => g.gate === "RECOVERY_VERIFIED");
    if (recGate) {
      recGate.status = "BLOCKED";
      recGate.details = "Recovery verification incomplete";
    }
    incompletePack.highestProvenLevel = "DESTINATION_VERIFIED";
    CertificationHarness.registerActiveEvidencePack(incompletePack);

    // Default mock DB state
    (prisma as any).user = {
      findUnique: async ({ where }: any) => {
        if (where.id === "user-operator") {
          return { id: "user-operator", email: "operator@monstera.test", platformRole: "OPERATOR" };
        }
        if (where.id === "user-owner") {
          return { id: "user-owner", email: "owner@agency.test", platformRole: "USER" };
        }
        if (where.id === "user-ordinary") {
          return { id: "user-ordinary", email: "ordinary@agency.test", platformRole: "USER" };
        }
        if (where.id === "user-rival") {
          return { id: "user-rival", email: "rival@rivalagency.test", platformRole: "USER" };
        }
        return null;
      },
    };

    (prisma as any).workspace = {
      findUnique: async ({ where }: any) => {
        if (where.id === "ws-primary") {
          return { id: "ws-primary", name: "Primary Agency", ownerId: "user-owner" };
        }
        if (where.id === "ws-rival") {
          return { id: "ws-rival", name: "Rival Agency", ownerId: "user-rival" };
        }
        return null;
      },
      findFirst: async ({ where }: any) => {
        if (where.id === "ws-primary" && where.ownerId === "user-owner") {
          return { id: "ws-primary", ownerId: "user-owner" };
        }
        return null;
      },
    };

    (prisma as any).workspaceMember = {
      findFirst: async ({ where }: any) => {
        if (where.workspaceId === "ws-primary" && where.userId === "user-owner") {
          return { workspaceId: "ws-primary", userId: "user-owner", role: "owner" };
        }
        if (where.workspaceId === "ws-primary" && where.userId === "user-ordinary") {
          return { workspaceId: "ws-primary", userId: "user-ordinary", role: "member" };
        }
        if (where.workspaceId === "ws-rival" && where.userId === "user-rival") {
          return { workspaceId: "ws-rival", userId: "user-rival", role: "owner" };
        }
        return null;
      },
    };

    (prisma as any).evidencePackRecord = {
      findFirst: async ({ where }: any) => {
        if (where.workspaceId === "ws-primary" && where.jobId === livePack.runId) {
          return { workspaceId: "ws-primary", jobId: livePack.runId, pack: livePack };
        }
        if (where.workspaceId === "ws-primary" && where.jobId === syntheticPack.runId) {
          return { workspaceId: "ws-primary", jobId: syntheticPack.runId, pack: syntheticPack };
        }
        if (where.workspaceId === "ws-primary" && where.jobId === incompletePack.runId) {
          return { workspaceId: "ws-primary", jobId: incompletePack.runId, pack: incompletePack };
        }
        return null;
      },
      create: async ({ data }: any) => data,
    };

    (prisma as any).auditEvent = {
      create: async ({ data }: any) => {
        auditEvents.push(data);
        return data;
      },
    };
  });

  afterEach(() => {
    setAuthSessionOverride(null);
    (prisma as any).user = originalUser;
    (prisma as any).workspace = originalWorkspace;
    (prisma as any).workspaceMember = originalWorkspaceMember;
    (prisma as any).evidencePackRecord = originalEvidencePackRecord;
    (prisma as any).auditEvent = originalAuditEvent;
  });

  // 1. Signed-out users
  it("rejects signed-out users with 401 Unauthorized", async () => {
    setAuthSessionOverride(async () => null);
    const res = await POST(
      jsonRequest({
        workspaceId: "ws-primary",
        evidencePackId: livePack.runId,
        expectedEvidencePackHash: livePackHash,
      })
    );
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "Unauthorized");
  });

  // 2. Ordinary users
  it("rejects ordinary users without OPERATOR platformRole with 403 Forbidden", async () => {
    setAuthSessionOverride(async () => ({
      user: { id: "user-ordinary" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));

    const res = await POST(
      jsonRequest({
        workspaceId: "ws-primary",
        evidencePackId: livePack.runId,
        expectedEvidencePackHash: livePackHash,
      })
    );
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.ok(body.error.includes("requires persisted platformRole equal to OPERATOR"));
  });

  // 3. Workspace owners (cannot award PILOT_CERTIFIED, but can attest)
  it("rejects workspace owners attempting final PILOT_CERTIFIED sign-off", async () => {
    setAuthSessionOverride(async () => ({
      user: { id: "user-owner" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));

    const res = await POST(
      jsonRequest({
        workspaceId: "ws-primary",
        evidencePackId: livePack.runId,
        expectedEvidencePackHash: livePackHash,
      })
    );
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.ok(body.error.includes("requires persisted platformRole equal to OPERATOR"));
  });

  it("permits workspace owners to submit owner attestation without awarding PILOT_CERTIFIED", async () => {
    setAuthSessionOverride(async () => ({
      user: { id: "user-owner" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));

    const res = await POST(
      jsonRequest({
        workspaceId: "ws-primary",
        evidencePackId: livePack.runId,
        expectedEvidencePackHash: livePackHash,
        action: "owner_attest",
        comments: "Confirmed by Agency Owner",
      })
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    // Invariant: highestProvenLevel is UNCHANGED and pilotEligible remains false
    assert.equal(body.pack.highestProvenLevel, "RECOVERY_VERIFIED");
    assert.equal(body.pack.pilotEligible, false);
    assert.equal(body.pack.ownerAttestation.ownerUserId, "user-owner");
    assert.equal(body.pack.ownerAttestation.ownerRole, "owner");
    assert.ok(body.notice.includes("does not award PILOT_CERTIFIED"));
  });

  // 4. Forged roles in request input
  it("rejects caller-declared reviewerRole in request input with 400 Bad Request", async () => {
    setAuthSessionOverride(async () => ({
      user: { id: "user-operator" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));

    const res = await POST(
      jsonRequest({
        workspaceId: "ws-primary",
        evidencePackId: livePack.runId,
        expectedEvidencePackHash: livePackHash,
        reviewerRole: "OPERATOR",
      })
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes("Security violation: Field 'reviewerRole' cannot be declared in request input"));
  });

  it("rejects caller-declared reviewerUserId in request input with 400 Bad Request", async () => {
    setAuthSessionOverride(async () => ({
      user: { id: "user-operator" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));

    const res = await POST(
      jsonRequest({
        workspaceId: "ws-primary",
        evidencePackId: livePack.runId,
        expectedEvidencePackHash: livePackHash,
        reviewerUserId: "forged-user-id",
      })
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes("Security violation: Field 'reviewerUserId' cannot be declared in request input"));
  });

  it("rejects caller-declared operatorSignOff object in request input with 400 Bad Request", async () => {
    setAuthSessionOverride(async () => ({
      user: { id: "user-operator" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));

    const res = await POST(
      jsonRequest({
        workspaceId: "ws-primary",
        evidencePackId: livePack.runId,
        expectedEvidencePackHash: livePackHash,
        operatorSignOff: { forged: true },
      })
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes("Security violation: Field 'operatorSignOff' cannot be declared in request input"));
  });

  it("rejects caller-declared highestProvenLevel in request input with 400 Bad Request", async () => {
    setAuthSessionOverride(async () => ({
      user: { id: "user-operator" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));

    const res = await POST(
      jsonRequest({
        workspaceId: "ws-primary",
        evidencePackId: livePack.runId,
        expectedEvidencePackHash: livePackHash,
        highestProvenLevel: "PILOT_CERTIFIED",
      })
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes("Security violation: Field 'highestProvenLevel' cannot be declared in request input"));
  });

  // 5. Rival workspaces
  it("rejects rival workspace user attempting owner attestation with 403 Forbidden", async () => {
    setAuthSessionOverride(async () => ({
      user: { id: "user-rival" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));

    const res = await POST(
      jsonRequest({
        workspaceId: "ws-primary",
        evidencePackId: livePack.runId,
        expectedEvidencePackHash: livePackHash,
        action: "owner_attest",
      })
    );
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.ok(body.error.includes("Only a verified workspace owner can submit owner attestation"));
  });

  it("rejects mismatched workspaceId for an evidence pack with 404 Not Found", async () => {
    setAuthSessionOverride(async () => ({
      user: { id: "user-operator" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));

    const res = await POST(
      jsonRequest({
        workspaceId: "ws-rival", // Pack belongs to ws-primary, not ws-rival
        evidencePackId: livePack.runId,
        expectedEvidencePackHash: livePackHash,
      })
    );
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.ok(body.error.includes("not found"));
  });

  // 6. Changed hashes (tampered pack)
  it("rejects tampered evidence pack hash with 400 Bad Request", async () => {
    setAuthSessionOverride(async () => ({
      user: { id: "user-operator" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));

    const res = await POST(
      jsonRequest({
        workspaceId: "ws-primary",
        evidencePackId: livePack.runId,
        expectedEvidencePackHash: "tampered_fake_hash_1234567890abcdef",
      })
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes("Evidence pack hash mismatch"));
  });

  // 7. Synthetic evidence
  it("rejects synthetic fixtures with 400 Bad Request", async () => {
    setAuthSessionOverride(async () => ({
      user: { id: "user-operator" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));

    const synthHash = CertificationHarness.computeEvidencePackHash(syntheticPack);
    const res = await POST(
      jsonRequest({
        workspaceId: "ws-primary",
        evidencePackId: syntheticPack.runId,
        expectedEvidencePackHash: synthHash,
      })
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes("Only live_certification_evidence packs are eligible for human review sign-off"));
  });

  // 8. Incomplete gates
  it("rejects evidence packs with incomplete gates with 400 Bad Request", async () => {
    setAuthSessionOverride(async () => ({
      user: { id: "user-operator" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));

    const incompleteHash = CertificationHarness.computeEvidencePackHash(incompletePack);
    const res = await POST(
      jsonRequest({
        workspaceId: "ws-primary",
        evidencePackId: incompletePack.runId,
        expectedEvidencePackHash: incompleteHash,
      })
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes("mandatory gate 'RECOVERY_VERIFIED' has status 'BLOCKED'"));
  });

  // 9. Repeated approval (replay protection / double approval)
  it("rejects repeated sign-off on an already approved pack with 409 Conflict", async () => {
    setAuthSessionOverride(async () => ({
      user: { id: "user-operator" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));

    // First sign-off succeeds
    const firstRes = await POST(
      jsonRequest({
        workspaceId: "ws-primary",
        evidencePackId: livePack.runId,
        expectedEvidencePackHash: livePackHash,
        comments: "Initial valid approval",
      })
    );
    assert.equal(firstRes.status, 200);
    const firstBody = await firstRes.json();
    assert.equal(firstBody.signedEvidencePack.highestProvenLevel, "PILOT_CERTIFIED");

    // Second sign-off on the same pack must return 409 Conflict
    const signedHash = CertificationHarness.computeEvidencePackHash(firstBody.signedEvidencePack);
    const secondRes = await POST(
      jsonRequest({
        workspaceId: "ws-primary",
        evidencePackId: livePack.runId,
        expectedEvidencePackHash: signedHash,
        comments: "Replay approval attempt",
      })
    );
    assert.equal(secondRes.status, 409);
    const secondBody = await secondRes.json();
    assert.ok(secondBody.error.includes("already been signed off"));
    assert.ok(secondBody.error.includes("Repeated approval is prohibited"));
  });

  // 10. Successful OPERATOR approval
  it("successfully signs off live evidence pack with OPERATOR role, binding server metadata and emitting audit event", async () => {
    setAuthSessionOverride(async () => ({
      user: { id: "user-operator" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));

    const res = await POST(
      jsonRequest({
        workspaceId: "ws-primary",
        evidencePackId: livePack.runId,
        expectedEvidencePackHash: livePackHash,
        comments: "All compliance standards and reconciliation verified",
      })
    );

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    const pack = body.signedEvidencePack;
    assert.equal(pack.highestProvenLevel, "PILOT_CERTIFIED");
    assert.equal(pack.pilotEligible, true);
    assert.equal(pack.certificationEligible, true);

    // Operator sign-off fields derived from session & server timestamp
    assert.ok(pack.operatorSignOff);
    assert.equal(pack.operatorSignOff.reviewerUserId, "user-operator");
    assert.equal(pack.operatorSignOff.reviewerRole, "OPERATOR");
    assert.equal(pack.operatorSignOff.evidencePackHash, livePackHash);
    assert.equal(pack.operatorSignOff.comments, "All compliance standards and reconciliation verified");
    assert.ok(pack.operatorSignOff.signedAt);

    // PILOT_CERTIFIED gate is PASSED
    const pilotGate = pack.gateOutcomes.find((g: any) => g.gate === "PILOT_CERTIFIED");
    assert.equal(pilotGate.status, "PASSED");

    // HUMAN_SIGN_OFF_REQUIRED blocker is cleared
    assert.equal(pack.blockers.filter((b: any) => b.category === "HUMAN_SIGN_OFF_REQUIRED").length, 0);

    // Markdown report generated with sign-off details
    assert.ok(body.markdownReport.includes("Authenticated Operator Sign-Off"));
    assert.ok(body.markdownReport.includes("`OPERATOR`"));
    assert.ok(body.markdownReport.includes("`user-operator`"));

    // Workspace-scoped audit event emitted
    const signOffAudit = auditEvents.find((e) => e.action === "ad_connector_certification.signed_off");
    assert.ok(signOffAudit);
    assert.equal(signOffAudit.workspaceId, "ws-primary");
    assert.equal(signOffAudit.resource, "connection");
    assert.equal((signOffAudit.metadata as any).reviewerUserId, "user-operator");
    assert.equal((signOffAudit.metadata as any).reviewerRole, "OPERATOR");
    assert.equal((signOffAudit.metadata as any).highestProvenLevel, "PILOT_CERTIFIED");
  });
});
