import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import prisma from "@/lib/prisma";
import { PaymentWorkspaceError, resolveBillableWorkspaceId, requireSelfServeAgencyPro } from "./payment-workspace";

const originalWorkspaceMember = (prisma as any).workspaceMember;
const originalWorkspace = (prisma as any).workspace;

afterEach(() => {
  (prisma as any).workspaceMember = originalWorkspaceMember;
  (prisma as any).workspace = originalWorkspace;
});

describe("payment workspace selection", () => {
  it("rejects a member without ownership, including a different tenant", async () => {
    (prisma as any).workspaceMember = { findFirst: async () => null };
    await assert.rejects(() => resolveBillableWorkspaceId({ userId: "viewer", requestedWorkspaceId: "other-tenant" }), (error: unknown) => error instanceof PaymentWorkspaceError && error.statusCode === 403);
  });

  it("checks server-held plan and status before allowing a self-serve order", async () => {
    for (const workspace of [null, { plan: "starter", status: "ACTIVE" }, { plan: "enterprise", status: "ACTIVE" }, { plan: "professional", status: "SUSPENDED" }]) {
      (prisma as any).workspace = { findUnique: async (args: any) => { assert.deepEqual(args.where, { id: "selected-workspace" }); return workspace; } };
      await assert.rejects(() => requireSelfServeAgencyPro("selected-workspace"), (error: unknown) => error instanceof PaymentWorkspaceError && error.statusCode === 409);
    }
    for (const plan of ["free", "professional"]) {
      (prisma as any).workspace = { findUnique: async () => ({ plan, status: "ACTIVE", subscriptionProvider: "vietqr_domestic", subscriptionEndsAt: new Date("2026-10-01") }) };
      await requireSelfServeAgencyPro("selected-workspace");
    }
  });
  it("uses the explicitly requested workspace only when the payer owns it", async () => {
    (prisma as any).workspaceMember = {
      findFirst: async (args: any) => {
        assert.deepEqual(args.where, { workspaceId: "workspace-a", userId: "user-a", role: "owner" });
        return { workspaceId: "workspace-a" };
      },
    };

    assert.equal(await resolveBillableWorkspaceId({ userId: "user-a", requestedWorkspaceId: "workspace-a" }), "workspace-a");
  });

  it("does not silently choose a workspace when the user owns more than one", async () => {
    (prisma as any).workspaceMember = {
      findMany: async () => [{ workspaceId: "workspace-a" }, { workspaceId: "workspace-b" }],
    };

    await assert.rejects(
      () => resolveBillableWorkspaceId({ userId: "user-a" }),
      (error: unknown) => error instanceof PaymentWorkspaceError && error.statusCode === 409,
    );
  });
});
