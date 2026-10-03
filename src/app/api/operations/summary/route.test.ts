import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertAllowedTestDatabase } from "@/lib/pg-test-discipline";
import { setAuthSessionOverride } from "@/lib/auth-session";
import * as routeModule from "./route";

const { GET } = routeModule;

/**
 * Route contract for GET /api/operations/summary.
 *
 * The summary itself is read-only: this suite asserts authentication,
 * authorization, sanitized client-context failures, cache posture and the
 * absence of any mutation method. Isolation breadth lives in
 * src/lib/operations-summary.pg.integration.test.ts.
 */
describe("operations summary route", () => {
  let db: PrismaClient;
  const suffix = `opsr-${Date.now()}-${process.pid}`;
  const ids = {
    owner: `user-owner-${suffix}`,
    viewer: `user-viewer-${suffix}`,
    outsider: `user-outsider-${suffix}`,
    workspaceA: `ws-a-${suffix}`,
    workspaceB: `ws-b-${suffix}`,
    clientA: `cl-a-${suffix}`,
    clientB: `cl-b-${suffix}`,
    connA: `conn-a-${suffix}`,
    connB: `conn-b-${suffix}`,
  };

  const asUser = (userId: string | null) =>
    setAuthSessionOverride(
      userId
        ? async () => ({ user: { id: userId, email: `${userId}@example.test` }, expires: "2099-01-01T00:00:00.000Z" })
        : async () => null,
    );

  async function json(res: Response) {
    return { status: res.status, body: (await res.json()) as Record<string, unknown>, headers: res.headers };
  }

  const get = (query: string) => GET(new Request(`http://localhost/api/operations/summary?${query}`));

  before(async () => {
    const url = assertAllowedTestDatabase(process.env.DATABASE_URL);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    await db.user.createMany({
      data: [
        { id: ids.owner, email: `${ids.owner}@example.test`, name: "Owner" },
        { id: ids.viewer, email: `${ids.viewer}@example.test`, name: "Viewer" },
        { id: ids.outsider, email: `${ids.outsider}@example.test`, name: "Outsider" },
      ],
    });
    await db.workspace.createMany({
      data: [
        { id: ids.workspaceA, ownerId: ids.owner, name: "Ops A", slug: `ops-a-${suffix}`, plan: "professional" },
        { id: ids.workspaceB, ownerId: ids.owner, name: "Ops B", slug: `ops-b-${suffix}`, plan: "professional" },
      ],
    });
    await db.workspaceMember.createMany({
      data: [
        { workspaceId: ids.workspaceA, userId: ids.owner, role: "owner" },
        { workspaceId: ids.workspaceA, userId: ids.viewer, role: "viewer" },
        { workspaceId: ids.workspaceB, userId: ids.owner, role: "owner" },
      ],
    });
    await db.client.createMany({
      data: [
        { id: ids.clientA, workspaceId: ids.workspaceA, name: "Aurora", accountAssignmentsConfiguredAt: new Date() },
        { id: ids.clientB, workspaceId: ids.workspaceB, name: "Rival", accountAssignmentsConfiguredAt: new Date() },
      ],
    });
    await db.connection.createMany({
      data: [
        { id: ids.connA, workspaceId: ids.workspaceA, name: "Google A", provider: "google_ads", type: "source", status: "connected", remoteAccountId: `mcc-a-${suffix}`, credentials: "{}" },
        { id: ids.connB, workspaceId: ids.workspaceB, name: "Google B", provider: "google_ads", type: "source", status: "connected", remoteAccountId: `mcc-b-${suffix}`, credentials: "{}" },
      ],
    });
    await db.clientProviderAccountAssignment.createMany({
      data: [
        { workspaceId: ids.workspaceA, clientId: ids.clientA, provider: "google_ads", accountId: "1110001111", connectionId: ids.connA },
        { workspaceId: ids.workspaceB, clientId: ids.clientB, provider: "google_ads", accountId: "9990009999", connectionId: ids.connB },
      ],
    });
    await db.providerAccountHealth.createMany({
      data: [
        { workspaceId: ids.workspaceA, connectionId: ids.connA, provider: "google_ads", accountId: "1110001111", status: "healthy" },
        { workspaceId: ids.workspaceB, connectionId: ids.connB, provider: "google_ads", accountId: "9990009999", status: "healthy" },
      ],
    });
  });

  after(async () => {
    setAuthSessionOverride(null);
    try {
      await db.providerAccountHealth.deleteMany({ where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } } });
      await db.clientProviderAccountAssignment.deleteMany({ where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } } });
      await db.connection.deleteMany({ where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } } });
      await db.client.deleteMany({ where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } } });
      await db.workspaceMember.deleteMany({ where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } } });
      await db.workspace.deleteMany({ where: { id: { in: [ids.workspaceA, ids.workspaceB] } } });
      await db.user.deleteMany({ where: { id: { in: [ids.owner, ids.viewer, ids.outsider] } } });
    } finally {
      await db.$disconnect();
    }
  });

  it("exports GET only — no mutation method exists on the module", () => {
    const exported = Object.keys(routeModule);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      assert.equal(exported.includes(method), false, `${method} must not be exported`);
    }
    assert.ok(exported.includes("GET"));
  });

  it("rejects an unauthenticated request with 401", async () => {
    asUser(null);
    const result = await json(await get(`workspaceId=${ids.workspaceA}`));
    assert.equal(result.status, 401);
    assert.equal("sections" in result.body, false);
  });

  it("rejects missing, unknown and oversized query input with a sanitized 400", async () => {
    asUser(ids.owner);
    for (const query of [
      "",
      "workspaceId=",
      `workspaceId=${ids.workspaceA}&unexpected=1`,
      `workspaceId=${ids.workspaceA}&clientId=${"x".repeat(161)}`,
      `workspaceId=${encodeURIComponent("not valid")}`,
    ]) {
      const result = await json(await get(query));
      assert.equal(result.status, 400, query);
      assert.equal("sections" in result.body, false, query);
    }
  });

  it("rejects a non-member with 403 and never returns workspace evidence", async () => {
    asUser(ids.outsider);
    const result = await json(await get(`workspaceId=${ids.workspaceA}`));
    assert.equal(result.status, 403);
    assert.equal("sections" in result.body, false);
  });

  it("permits a viewer and returns a no-store, bounded summary", async () => {
    asUser(ids.viewer);
    const result = await json(await get(`workspaceId=${ids.workspaceA}`));
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "private, no-store");
    const sections = result.body.sections as Record<string, { limit: number }>;
    assert.deepEqual(
      Object.keys(sections).sort(),
      ["anomalies", "connectorHealth", "delivery", "freshness", "ingestion", "readiness"],
    );
    assert.equal(result.body.workspaceId, ids.workspaceA);
    assert.equal((result.body.clientContext as { status: string }).status, "none");
    const navigation = result.body.navigation as Record<string, string>;
    for (const href of Object.values(navigation)) {
      assert.ok(href.startsWith("/"), `${href} must be an internal path`);
    }
  });

  it("rejects a malformed client context with a sanitized 400", async () => {
    asUser(ids.owner);
    const result = await json(await get(`workspaceId=${ids.workspaceA}&clientId=${encodeURIComponent(" all ")}`));
    assert.equal(result.status, 400);
    assert.equal(result.body.code, "INVALID_CLIENT");
    assert.equal("sections" in result.body, false);
  });

  it("rejects the unassigned sentinel explicitly rather than guessing a scope", async () => {
    asUser(ids.owner);
    const result = await json(await get(`workspaceId=${ids.workspaceA}&clientId=unassigned`));
    assert.equal(result.status, 400);
    assert.equal(result.body.code, "UNSUPPORTED_CLIENT_SCOPE");
    assert.equal("sections" in result.body, false);
  });

  it("makes rival and nonexistent clients indistinguishable 404s", async () => {
    asUser(ids.owner);
    const rival = await json(await get(`workspaceId=${ids.workspaceA}&clientId=${ids.clientB}`));
    const missing = await json(await get(`workspaceId=${ids.workspaceA}&clientId=cl-absent-${suffix}`));
    assert.equal(rival.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(rival.body, missing.body);
    assert.equal(rival.body.code, "CLIENT_NOT_FOUND");
    assert.equal("sections" in rival.body, false);
  });

  it("accepts the all-clients sentinel as an intentional workspace-wide scope", async () => {
    asUser(ids.owner);
    const result = await json(await get(`workspaceId=${ids.workspaceA}&clientId=all`));
    assert.equal(result.status, 200);
    assert.equal((result.body.clientContext as { status: string }).status, "all");
  });
});
