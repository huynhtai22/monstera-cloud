import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { CertificationHarness } from "@/lib/ad-certification/harness";

const FORBIDDEN_CALLER_INPUT_FIELDS = [
  "reviewerUserId",
  "reviewerRole",
  "operatorSignOff",
  "ownerAttestation",
  "status",
  "certificationStatus",
  "highestProvenLevel",
  "pilotEligible",
  "certificationEligible",
];


export async function POST(request: Request) {
  // 1. Session authentication
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse request JSON body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // 3. Reject any caller-declared reviewer identity, role, or certification status
  for (const field of FORBIDDEN_CALLER_INPUT_FIELDS) {
    if (field in body && body[field] !== undefined) {
      return NextResponse.json(
        {
          error: `Security violation: Field '${field}' cannot be declared in request input. Reviewer identity, roles, and certification status must be server-authenticated.`,
        },
        { status: 400 }
      );
    }
  }

  const { workspaceId, evidencePackId, expectedEvidencePackHash, comments, action } = body;
  if (action !== undefined && action !== "owner_attest" && action !== "sign_off") {
    return NextResponse.json({ error: "Unknown certification action" }, { status: 400 });
  }

  if (!workspaceId || typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  if (!evidencePackId || typeof evidencePackId !== "string" || evidencePackId.trim().length === 0) {
    return NextResponse.json({ error: "evidencePackId is required" }, { status: 400 });
  }
  if (!expectedEvidencePackHash || typeof expectedEvidencePackHash !== "string" || expectedEvidencePackHash.trim().length === 0) {
    return NextResponse.json({ error: "expectedEvidencePackHash is required" }, { status: 400 });
  }

  // 4. Resolve authenticated user and database-persisted platformRole
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, platformRole: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 5. Handle Workspace-Owner Attestation (if action === "owner_attest")
  if (action === "owner_attest") {
    // Verify membership as owner in workspace
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: user.id },
      select: { role: true },
    });
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, ownerId: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const isOwner = member?.role === "owner" || workspace.ownerId === user.id;
    if (!isOwner) {
      return NextResponse.json(
        { error: "Forbidden: Only a verified workspace owner can submit owner attestation." },
        { status: 403 }
      );
    }

    const harness = new CertificationHarness();
    try {
      const result = await harness.attestWorkspaceOwner({
        workspaceId,
        evidencePackId,
        expectedEvidencePackHash,
        ownerUserId: user.id,
        comments: typeof comments === "string" ? comments : undefined,
      });

      return NextResponse.json({
        ok: true,
        pack: result.pack,
        markdownReport: result.markdownReport,
        notice: "Workspace owner attestation recorded. Note: Workspace-owner attestation does not award PILOT_CERTIFIED; final pilot certification requires OPERATOR platform role sign-off.",
      });
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) {
        return NextResponse.json({ error: message }, { status: 404 });
      }
      if (message.includes("already received")) {
        return NextResponse.json({ error: message }, { status: 409 });
      }
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  // 6. Final Pilot Certification Sign-Off: Requires persisted platformRole == OPERATOR
  if (user.platformRole !== "OPERATOR") {
    return NextResponse.json(
      {
        error: `Forbidden: Reviewer role '${user.platformRole}' is not authorized for certification sign-off. Final pilot certification requires persisted platformRole equal to OPERATOR.`,
      },
      { status: 403 }
    );
  }

  // 7. Verify workspace exists
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  // 8. Execute Sign-Off via CertificationHarness in an atomic transaction with concurrency control
  const harness = new CertificationHarness();
  try {
    const result = await harness.signOffEvidencePack({
        workspaceId,
        evidencePackId,
        expectedEvidencePackHash,
        reviewerUserId: user.id,
        reviewerRole: "OPERATOR",
        comments: typeof comments === "string" ? comments : undefined,
      });

    return NextResponse.json({
      ok: true,
      signedEvidencePack: result.signedEvidencePack,
      markdownReport: result.markdownReport,
    });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (
      message.includes("already been signed off") ||
      message.includes("Repeated approval is prohibited")
    ) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
