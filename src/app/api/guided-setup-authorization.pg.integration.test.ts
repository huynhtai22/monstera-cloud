import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PATCH as configPATCH, GET as configGET } from "@/app/api/reports/readiness/configuration/route";
import { requireWorkspaceAccess } from "@/lib/rbac";
import { setAuthSessionOverride } from "@/lib/auth-session";
import { assertCiDatabaseReachableWhenMissing } from "@/lib/pg-test-discipline";

assertCiDatabaseReachableWhenMissing();

/**
 * Guided setup remediation contract 6: backend minimum roles are unchanged.
 * Exercises the real configuration handler and the real RBAC resolver against
 * a disposable database with synthetic memberships.
 */
describe("guided setup authorization matrix", { skip: !process.env.DATABASE_URL }, () => {
  const db = new PrismaClient();
  const uid = randomUUID();
  const ws = `setup-auth-ws-${uid}`;
  const client = `setup-auth-client-${uid}`;
  const owner = `setup-auth-owner-${uid}`;
  const admin = `setup-auth-admin-${uid}`;
  const member = `setup-auth-member-${uid}`;
  const viewer = `setup-auth-viewer-${uid}`;

  function asUser(id: string | null) {
    setAuthSessionOverride(async () => (id ? { user: { id, email: `${id}@example.test` }, expires: new Date(Date.now() + 86400000).toISOString() } : null));
  }
  function configRequest(method: string, body?: unknown) {
    return new Request("http://localhost/api/reports/readiness/configuration", {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
    });
  }

  before(async () => {
    await db.$connect();
    await db.user.createMany({ data: [owner, admin, member, viewer].map((id) => ({ id, email: `${id}@example.test` })) });
    await db.workspace.create({ data: { id: ws, slug: ws, name: ws, ownerId: owner, plan: "professional" } });
    await db.workspaceMember.createMany({
      data: [
        { workspaceId: ws, userId: owner, role: "owner" },
        { workspaceId: ws, userId: admin, role: "admin" },
        { workspaceId: ws, userId: member, role: "member" },
        { workspaceId: ws, userId: viewer, role: "viewer" },
      ],
    });
    await db.client.create({ data: { id: client, workspaceId: ws, name: "Auth Client" } });
  });

  after(async () => {
    setAuthSessionOverride(null);
    await db.client.deleteMany({ where: { id: client } }).catch(() => undefined);
    await db.workspaceMember.deleteMany({ where: { workspaceId: ws } }).catch(() => undefined);
    await db.workspace.deleteMany({ where: { id: ws } }).catch(() => undefined);
    await db.user.deleteMany({ where: { id: { in: [owner, admin, member, viewer] } } }).catch(() => undefined);
    await db.$disconnect();
  });

  it("member configuration writes stay forbidden while member reads stay allowed", async () => {
    asUser(member);
    const denied = await configPATCH(configRequest("PATCH", {
      workspaceId: ws,
      clientId: client,
      requirements: { providers: ["meta_ads"], destinations: ["google_sheets"] },
    }));
    assert.equal(denied.status, 403);
    const allowed = await configGET(new Request(
      `http://localhost/api/reports/readiness/configuration?${new URLSearchParams({ workspaceId: ws, clientId: client })}`,
    ));
    assert.equal(allowed.status, 200);
    const body = (await allowed.json()) as { canEdit: boolean; role: string };
    assert.equal(body.canEdit, false);
    assert.equal(body.role, "member");
  });

  it("admin configuration writes stay allowed and report the admin role", async () => {
    asUser(admin);
    const saved = await configPATCH(configRequest("PATCH", {
      workspaceId: ws,
      clientId: client,
      requirements: { providers: ["meta_ads"], destinations: ["google_sheets"] },
    }));
    assert.equal(saved.status, 200);
    const read = await configGET(new Request(
      `http://localhost/api/reports/readiness/configuration?${new URLSearchParams({ workspaceId: ws, clientId: client })}`,
    ));
    assert.equal(read.status, 200);
    const body = (await read.json()) as { canEdit: boolean; role: string; requiredProviders: string[] };
    assert.equal(body.canEdit, true);
    assert.equal(body.role, "admin");
    assert.deepEqual(body.requiredProviders, ["meta_ads"]);
  });

  it("viewer reads stay allowed without edit rights", async () => {
    asUser(viewer);
    const read = await configGET(new Request(
      `http://localhost/api/reports/readiness/configuration?${new URLSearchParams({ workspaceId: ws, clientId: client })}`,
    ));
    assert.equal(read.status, 200);
    const body = (await read.json()) as { canEdit: boolean; role: string };
    assert.equal(body.canEdit, false);
    assert.equal(body.role, "viewer");
  });

  it("RBAC resolver preserves member, viewer and admin boundaries", async () => {
    const memberAccess = await requireWorkspaceAccess({ userId: member, workspaceId: ws, minimumRole: "member" });
    assert.equal(memberAccess.membership.role, "member");
    await assert.rejects(
      requireWorkspaceAccess({ userId: viewer, workspaceId: ws, minimumRole: "member" }),
      /workspace|role|access|forbidden/i,
    );
    await assert.rejects(
      requireWorkspaceAccess({ userId: member, workspaceId: ws, minimumRole: "admin" }),
      /workspace|role|access|forbidden/i,
    );
    const adminAccess = await requireWorkspaceAccess({ userId: admin, workspaceId: ws, minimumRole: "admin" });
    assert.equal(adminAccess.membership.role, "admin");
    const viewerAccess = await requireWorkspaceAccess({ userId: viewer, workspaceId: ws, minimumRole: "viewer" });
    assert.equal(viewerAccess.membership.role, "viewer");
  });
});
