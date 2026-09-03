import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import prisma from "@/lib/prisma";
import { setAuthSessionOverride } from "@/lib/auth-session";
import { POST } from "./[id]/activation/route";

const originalWorkspace = (prisma as any).workspace;
const originalWorkspaceMember = (prisma as any).workspaceMember;

function request(body: unknown) {
  return new Request("https://monstera.test/api/workspaces/workspace-a/activation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/workspaces/[id]/activation", () => {
  beforeEach(() => {
    setAuthSessionOverride(async () => ({
      user: { id: "user-a" },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    }));
    (prisma as any).workspace = {
      findUnique: async ({ where }: any) => where.id === "workspace-a"
        ? { id: "workspace-a", ownerId: "owner-a" }
        : { id: "workspace-b", ownerId: "owner-b" },
    };
    (prisma as any).workspaceMember = {
      findFirst: async ({ where }: any) => where.userId === "user-a" && where.workspaceId === "workspace-a"
        ? { userId: "user-a", workspaceId: "workspace-a", role: "viewer" }
        : null,
    };
  });

  afterEach(() => {
    setAuthSessionOverride(null);
    (prisma as any).workspace = originalWorkspace;
    (prisma as any).workspaceMember = originalWorkspaceMember;
  });

  it("requires authentication", async () => {
    setAuthSessionOverride(async () => null);
    const response = await POST(request({ action: "dashboard_reviewed" }), {
      params: Promise.resolve({ id: "workspace-a" }),
    });
    assert.equal(response.status, 401);
  });

  it("rejects a cross-workspace review attempt", async () => {
    const response = await POST(request({ action: "dashboard_reviewed" }), {
      params: Promise.resolve({ id: "workspace-b" }),
    });
    assert.equal(response.status, 403);
  });

  it("accepts only the dashboard_reviewed action with no browser-controlled fields", async () => {
    const response = await POST(request({ action: "dashboard_reviewed", duration: 365 }), {
      params: Promise.resolve({ id: "workspace-a" }),
    });
    assert.equal(response.status, 400);
  });
});
