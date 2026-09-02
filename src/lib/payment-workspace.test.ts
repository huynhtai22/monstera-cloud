import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import prisma from "@/lib/prisma";
import { PaymentWorkspaceError, resolveBillableWorkspaceId } from "./payment-workspace";

const originalWorkspaceMember = (prisma as any).workspaceMember;

afterEach(() => {
  (prisma as any).workspaceMember = originalWorkspaceMember;
});

describe("payment workspace selection", () => {
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
