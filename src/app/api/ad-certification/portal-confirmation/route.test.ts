import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import prisma from "@/lib/prisma";
import { setAuthSessionOverride } from "@/lib/auth-session";
import { POST } from "./route";

const saved = {
  user: (prisma as any).user,
  workspace: (prisma as any).workspace,
  workspaceMember: (prisma as any).workspaceMember,
  connection: (prisma as any).connection,
  auditEvent: (prisma as any).auditEvent,
};
let currentUserId = "owner-1";
let memberRole: string | null = null;
let createdAudit: any;

function request(body: unknown) {
  return new Request("https://monstera.test/api/ad-certification/portal-confirmation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const body = {
  workspaceId: "workspace-1",
  connectionId: "connection-1",
  accountId: "123-456-7890",
  facts: {
    appAccountMode: "live",
    grantedScopesOrPermissions: ["https://www.googleapis.com/auth/adwords"],
    accessLevelStatus: "basic",
    authorizationModel: "oauth2_user_consent",
    tokenLifecycleModel: "refreshable_offline",
  },
};

describe("POST /api/ad-certification/portal-confirmation", () => {
  beforeEach(() => {
    currentUserId = "owner-1";
    memberRole = null;
    createdAudit = undefined;
    setAuthSessionOverride(async () => ({
      user: { id: currentUserId, email: "owner@example.test" },
      expires: new Date(Date.now() + 60_000).toISOString(),
    }));
    (prisma as any).user = { findUnique: async ({ where }: any) => where.id === currentUserId ? { id: currentUserId } : null };
    (prisma as any).workspace = { findUnique: async ({ where }: any) => where.id === "workspace-1" ? { id: where.id, ownerId: "owner-1" } : null };
    (prisma as any).workspaceMember = { findFirst: async () => memberRole ? { role: memberRole } : null };
    (prisma as any).connection = {
      findFirst: async ({ where }: any) => where.id === "connection-1" && where.workspaceId === "workspace-1"
        ? { id: "connection-1", remoteAccountId: "1234567890" }
        : null,
    };
    (prisma as any).auditEvent = { create: async ({ data }: any) => { createdAudit = data; return { id: "audit-1" }; } };
  });

  after(() => {
    for (const [key, value] of Object.entries(saved)) (prisma as any)[key] = value;
  });

  it("persists portal facts only after the workspace owner confirms the connected CID", async () => {
    const response = await POST(request(body));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(createdAudit.actorUserId, "owner-1");
    assert.equal(createdAudit.action, "PORTAL_ACCESS_CONFIRMED");
    assert.equal(createdAudit.resourceId, body.accountId);
    assert.equal(createdAudit.metadata.connectionId, body.connectionId);
    assert.equal(createdAudit.metadata.facts.accessLevelStatus, "basic");
    assert.equal(createdAudit.metadata.verificationSource, "portal_owner_confirmed");
  });

  it("rejects a non-owner without writing an audit record", async () => {
    currentUserId = "member-1";
    memberRole = "editor";
    const response = await POST(request(body));
    assert.equal(response.status, 403);
    assert.equal(createdAudit, undefined);
  });

  it("rejects a CID that does not match the selected connected account", async () => {
    const response = await POST(request({ ...body, accountId: "987-654-3210" }));
    assert.equal(response.status, 400);
    assert.equal(createdAudit, undefined);
  });
});
