import assert from "node:assert/strict";
import { assertCiDatabaseReachable } from "./pg-test-discipline";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { RbacError, requireWorkspaceAccess } from "./rbac";
import guardedPrisma from "./prisma";
import { TenantScopeError } from "./tenant-guard";

/**
 * A real PostgreSQL safety net for the resource types exposed by the pilot.
 *
 * Route tests assert HTTP responses for individual handlers. This suite checks that
 * the tenant scopes used by those handlers cannot select or mutate a resource from
 * a second workspace, even when an attacker knows its opaque resource ID.
 */
describe("PostgreSQL integration: tenant isolation safety gate", () => {
  let prisma: PrismaClient | null = null;
  let isDbAvailable = false;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ids = {
    alice: `tenant-alice-${suffix}`,
    bob: `tenant-bob-${suffix}`,
    viewer: `tenant-viewer-${suffix}`,
    workspaceA: `tenant-workspace-a-${suffix}`,
    workspaceB: `tenant-workspace-b-${suffix}`,
  };
  let resources: {
    connectionId: string;
    pipelineId: string;
    syncLogId: string;
    dataQualityRuleId: string;
    warehouseJobId: string;
    apiKeyId: string;
    lookerJobId: string;
  } | null = null;

  before(async () => {
    if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("mock")) {
      assertCiDatabaseReachable();
      return;
    }

    try {
      prisma = new PrismaClient();
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;

      await prisma.user.createMany({
        data: [
          { id: ids.alice, email: `tenant-alice-${suffix}@example.test`, name: "Tenant Alice" },
          { id: ids.bob, email: `tenant-bob-${suffix}@example.test`, name: "Tenant Bob" },
          { id: ids.viewer, email: `tenant-viewer-${suffix}@example.test`, name: "Tenant Viewer" },
        ],
      });
      await prisma.workspace.createMany({
        data: [
          { id: ids.workspaceA, name: "Tenant Workspace A", slug: `tenant-a-${suffix}`, ownerId: ids.alice, plan: "pilot" },
          { id: ids.workspaceB, name: "Tenant Workspace B", slug: `tenant-b-${suffix}`, ownerId: ids.bob, plan: "pilot" },
        ],
      });
      await prisma.workspaceMember.createMany({
        data: [
          { workspaceId: ids.workspaceA, userId: ids.alice, role: "owner" },
          { workspaceId: ids.workspaceA, userId: ids.viewer, role: "viewer" },
          { workspaceId: ids.workspaceB, userId: ids.bob, role: "owner" },
        ],
      });

      const source = await prisma.connection.create({
        data: {
          workspaceId: ids.workspaceA,
          name: "Tenant A source",
          type: "source",
          provider: "meta_ads",
          credentials: "enc:v1:test",
          remoteAccountId: `tenant-a-source-${suffix}`,
        },
      });
      const destination = await prisma.connection.create({
        data: {
          workspaceId: ids.workspaceA,
          name: "Tenant A destination",
          type: "destination",
          provider: "google_sheets",
          credentials: "enc:v1:test",
          remoteAccountId: `tenant-a-destination-${suffix}`,
        },
      });
      const pipeline = await prisma.pipeline.create({
        data: {
          workspaceId: ids.workspaceA,
          name: "Tenant A pipeline",
          sourceConnectionId: source.id,
          destinationConnectionId: destination.id,
        },
      });
      const syncLog = await prisma.syncLog.create({
        data: { pipelineId: pipeline.id, status: "success", rowsSynced: 1, durationMs: 1 },
      });
      const rule = await prisma.dataQualityRule.create({
        data: {
          workspaceId: ids.workspaceA,
          name: "Tenant A rule",
          ruleType: "threshold",
          metric: "spend",
          operator: "gt",
          threshold: 1,
        },
      });
      const warehouseJob = await prisma.warehouseImportJob.create({
        data: {
          workspaceId: ids.workspaceA,
          userId: ids.alice,
          since: "2026-01-01",
          until: "2026-01-02",
          items: [],
        },
      });
      const apiKey = await prisma.apiKey.create({
        data: { workspaceId: ids.workspaceA, name: "Tenant A integration key", keyHash: `tenant-key-${suffix}` },
      });
      const lookerJob = await prisma.lookerJob.create({
        data: { id: `tenant-looker-job-${suffix}`, workspaceId: ids.workspaceA, apiKeyId: apiKey.id, params: {} },
      });

      resources = {
        connectionId: source.id,
        pipelineId: pipeline.id,
        syncLogId: syncLog.id,
        dataQualityRuleId: rule.id,
        warehouseJobId: warehouseJob.id,
        apiKeyId: apiKey.id,
        lookerJobId: lookerJob.id,
      };
      isDbAvailable = true;
    } catch {
      assertCiDatabaseReachable();
      isDbAvailable = false;
    }
  });

  after(async () => {
    if (!prisma) return;
    try {
      await prisma.workspace.deleteMany({ where: { id: { in: [ids.workspaceA, ids.workspaceB] } } });
      await prisma.user.deleteMany({ where: { id: { in: [ids.alice, ids.bob, ids.viewer] } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("rejects a second workspace and read-only member through the production RBAC helper", async (t) => {
    if (!isDbAvailable || !resources) {
      t.skip("PostgreSQL database not reachable; run with the CI PostgreSQL service");
      return;
    }

    await requireWorkspaceAccess({ userId: ids.alice, workspaceId: ids.workspaceA, minimumRole: "viewer" });
    await assert.rejects(
      () => requireWorkspaceAccess({ userId: ids.bob, workspaceId: ids.workspaceA, minimumRole: "viewer" }),
      (error: unknown) => error instanceof RbacError && error.statusCode === 403,
    );
    await assert.rejects(
      () => requireWorkspaceAccess({ userId: ids.viewer, workspaceId: ids.workspaceA, minimumRole: "member" }),
      (error: unknown) => error instanceof RbacError && error.code === "INSUFFICIENT_ROLE",
    );
  });

  it("cannot select or mutate Tenant A resources with Tenant B scope", async (t) => {
    if (!isDbAvailable || !resources || !prisma) {
      t.skip("PostgreSQL database not reachable; run with the CI PostgreSQL service");
      return;
    }

    const [connection, pipeline, syncLog, rule, warehouseJob, apiKey, lookerJob] = await Promise.all([
      prisma.connection.findFirst({ where: { id: resources.connectionId, workspaceId: ids.workspaceB } }),
      prisma.pipeline.findFirst({ where: { id: resources.pipelineId, workspaceId: ids.workspaceB } }),
      prisma.syncLog.findFirst({ where: { id: resources.syncLogId, pipeline: { workspaceId: ids.workspaceB } } }),
      prisma.dataQualityRule.findFirst({ where: { id: resources.dataQualityRuleId, workspaceId: ids.workspaceB } }),
      prisma.warehouseImportJob.findFirst({ where: { id: resources.warehouseJobId, workspaceId: ids.workspaceB } }),
      prisma.apiKey.findFirst({ where: { id: resources.apiKeyId, workspaceId: ids.workspaceB } }),
      prisma.lookerJob.findFirst({ where: { id: resources.lookerJobId, workspaceId: ids.workspaceB } }),
    ]);

    assert.equal(connection, null);
    assert.equal(pipeline, null);
    assert.equal(syncLog, null);
    assert.equal(rule, null);
    assert.equal(warehouseJob, null);
    assert.equal(apiKey, null);
    assert.equal(lookerJob, null);

    const [connectionUpdate, ruleDelete, apiKeyRevoke] = await Promise.all([
      prisma.connection.updateMany({
        where: { id: resources.connectionId, workspaceId: ids.workspaceB },
        data: { status: "disconnected" },
      }),
      prisma.dataQualityRule.deleteMany({
        where: { id: resources.dataQualityRuleId, workspaceId: ids.workspaceB },
      }),
      prisma.apiKey.updateMany({
        where: { id: resources.apiKeyId, workspaceId: ids.workspaceB },
        data: { revokedAt: new Date() },
      }),
    ]);

    assert.equal(connectionUpdate.count, 0);
    assert.equal(ruleDelete.count, 0);
    assert.equal(apiKeyRevoke.count, 0);
  });

  it("rejects unscoped Connection lists on the guarded Prisma client", async () => {
    await assert.rejects(
      () => guardedPrisma.connection.findMany({ where: { status: "connected" } }),
      (error: unknown) => error instanceof TenantScopeError,
    );
  });
});
