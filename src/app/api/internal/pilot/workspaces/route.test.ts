import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import prisma from "@/lib/prisma";
import { setAuthSessionOverride } from "@/lib/auth-session";
import { GET, POST } from "./route";

const originalUser = (prisma as any).user;
const originalWorkspace = (prisma as any).workspace;
const originalInvitation = (prisma as any).workspaceInvitation;

describe("internal pilot workspaces", () => {
  beforeEach(() => {
    setAuthSessionOverride(async () => ({
      user: { id: "operator-a" },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    }));
    (prisma as any).user = { findFirst: async () => ({ id: "operator-a" }) };
    (prisma as any).workspace = { findUnique: async () => null };
    (prisma as any).workspaceInvitation = {
      findFirst: async () => null,
      create: async ({ data }: any) => ({
        id: "invite-a",
        email: data.email,
        expiresAt: data.expiresAt,
        plan: data.plan,
      }),
    };
  });

  afterEach(() => {
    setAuthSessionOverride(null);
    (prisma as any).user = originalUser;
    (prisma as any).workspace = originalWorkspace;
    (prisma as any).workspaceInvitation = originalInvitation;
  });

  it("keeps the operator fleet view inaccessible to ordinary users", async () => {
    (prisma as any).user.findFirst = async () => null;
    const response = await GET(new Request("https://monstera.test/api/internal/pilot/workspaces"));
    assert.equal(response.status, 403);
  });

  it("ignores browser-selected plans for a new pilot invitation", async () => {
    const response = await POST(new Request("https://monstera.test/api/internal/pilot/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "owner@example.test",
        agencyName: "Example Agency",
        agencySlug: "example-agency",
        plan: "enterprise",
        enabledProviders: ["meta_ads"],
      }),
    }));
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.plan, "pilot");
  });
});
