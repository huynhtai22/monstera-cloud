import assert from "node:assert/strict";
import { before, after, it, describe } from "node:test";
import { readFileSync } from "node:fs";
import { PrismaClient, Prisma } from "@prisma/client";
import { createGuardedPrisma } from "./prisma";
import { withDatabaseTenantContext, withDatabaseSystemContext } from "./database-tenant-context";
import { assertAllowedTestDatabase } from "./pg-test-discipline";
import { queryWarehouse } from "./warehouse-query";

describe("database-enforced tenant isolation (real restricted login)", () => {
  let admin: PrismaClient;
  let runtime: PrismaClient;
  let guarded: ReturnType<typeof createGuardedPrisma>;
  const suffix = `${process.pid}-${Date.now()}`;
  const a = `rls-a-${suffix}`, b = `rls-b-${suffix}`, user = `rls-user-${suffix}`;
  const previous = process.env.DATABASE_RLS_ENFORCED;

  before(async () => {
    const url = new URL(assertAllowedTestDatabase(process.env.DATABASE_URL));
    admin = new PrismaClient();
    // Fixed test-only role; intentionally fails if another suite already owns it.
    await admin.$executeRawUnsafe("CREATE ROLE monstera_rls_runtime_test LOGIN PASSWORD 'local-rls-test-only' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE");
    await admin.$executeRawUnsafe("GRANT USAGE ON SCHEMA public TO monstera_rls_runtime_test");
    await admin.$executeRawUnsafe("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO monstera_rls_runtime_test");
    const policy = readFileSync("scripts/tenant-rls-policy.sql", "utf8").replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "");
    await admin.$executeRawUnsafe(policy);
    // An unrelated permissive policy cannot punch through the restrictive fence.
    await admin.$executeRawUnsafe('CREATE POLICY rls_test_wide ON "ApiKey" USING (true) WITH CHECK (true)');
    await admin.user.create({ data: { id: user, email: `${user}@example.test` } });
    for (const id of [a, b]) {
      await admin.workspace.create({ data: { id, name: id, slug: id, ownerId: user } });
      await admin.apiKey.create({ data: { id: `${id}-key`, workspaceId: id, name: id } });
      await admin.connection.create({ data: { id: `${id}-conn`, workspaceId: id, name: id, type: "source", provider: "google_ads", credentials: "synthetic" } });
      await admin.campaignMetric.create({ data: { workspaceId: id, connectionId: `${id}-conn`, platform: "google_ads", accountId: `${id}-account`, date: new Date("2026-09-20"), spend: 10 } });
      await admin.pipeline.create({ data: { id: `${id}-pipe`, workspaceId: id, name: id, sourceConnectionId: `${id}-conn`, destinationConnectionId: `${id}-conn` } });
      await admin.syncLog.create({ data: { id: `${id}-log`, pipelineId: `${id}-pipe`, status: "success" } });
      await admin.syncLogDetail.create({ data: { id: `${id}-detail`, syncLogId: `${id}-log`, stage: "load", status: "success" } });
    }
    await admin.workspaceInvitation.create({ data: { id: `null-${suffix}`, tokenHash: suffix, email: "invite@example.test", invitedByUserId: user, expiresAt: new Date(), enabledProviders: [] } });
    url.username = "monstera_rls_runtime_test";
    url.password = "local-rls-test-only";
    url.searchParams.set("connection_limit", "1");
    runtime = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    guarded = createGuardedPrisma(runtime);
    process.env.DATABASE_RLS_ENFORCED = "1";
  });

  after(async () => {
    if (previous === undefined) delete process.env.DATABASE_RLS_ENFORCED;
    else process.env.DATABASE_RLS_ENFORCED = previous;
    await runtime?.$disconnect();
    if (admin) {
      await admin.syncLogDetail.deleteMany({ where: { id: { in: [`${a}-detail`, `${b}-detail`] } } });
      await admin.workspaceInvitation.deleteMany({ where: { id: `null-${suffix}` } });
      await admin.campaignMetric.deleteMany({ where: { workspaceId: { in: [a, b] } } });
      await admin.workspace.deleteMany({ where: { id: { in: [a, b] } } });
      await admin.user.deleteMany({ where: { id: user } });
      await admin.$executeRawUnsafe('DROP POLICY IF EXISTS rls_test_wide ON "ApiKey"');
      await admin.$executeRawUnsafe("DROP OWNED BY monstera_rls_runtime_test");
      await admin.$executeRawUnsafe("DROP ROLE monstera_rls_runtime_test");
      await admin.$disconnect();
    }
  });

  it("denies unscoped raw SQL and isolates direct, root, nullable and child rows", async () => {
    assert.deepEqual(await runtime.$queryRaw`SELECT id FROM "ApiKey"`, []);
    await withDatabaseTenantContext(guarded, a, async tx => {
      assert.deepEqual(await tx.$queryRaw`SELECT id FROM "ApiKey"`, [{ id: `${a}-key` }]);
      assert.deepEqual(await tx.$queryRaw`SELECT id FROM "Workspace"`, [{ id: a }]);
      assert.deepEqual(await tx.$queryRaw`SELECT id FROM "SyncLogDetail"`, [{ id: `${a}-detail` }]);
      assert.deepEqual(await tx.$queryRaw`SELECT id FROM "WorkspaceInvitation"`, []);
      const rows = await queryWarehouse({ workspaceId: a }, tx);
      assert.equal(rows.rows.length, 1);
      assert.equal(rows.rows[0].accountId, `${a}-account`);
    }, { isolationLevel: "RepeatableRead" });
  });

  it("covers every non-global model with a restrictive database policy", async () => {
    const globalModels = new Set(["User", "Account", "Session", "VerificationToken", "PasswordResetToken", "LoginEvent", "UserSession", "DashboardTemplate"]);
    const policies = await admin.$queryRaw<Array<{ relname: string }>>`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_policy p ON p.polrelid = c.oid
      WHERE n.nspname = 'public' AND c.relrowsecurity AND p.polname = 'monstera_workspace_isolation' AND NOT p.polpermissive`;
    const protectedTables = new Set(policies.map(p => p.relname));
    for (const model of Prisma.dmmf.datamodel.models) {
      if (!globalModels.has(model.name)) assert.ok(protectedTables.has(model.dbName ?? model.name), `${model.name} needs a policy or explicit global classification`);
    }
  });

  it("refuses enforced mode when a tenant table has RLS disabled", async () => {
    await admin.$executeRawUnsafe('ALTER TABLE "ApiKey" DISABLE ROW LEVEL SECURITY');
    try {
      await assert.rejects(withDatabaseTenantContext(guarded, a, async () => true), /active restrictive policies/);
    } finally {
      await admin.$executeRawUnsafe('ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY');
    }
  });

  it("blocks cross-tenant insert, update, delete and reparenting", async () => {
    await assert.rejects(withDatabaseTenantContext(guarded, a, tx => tx.$executeRaw`
      INSERT INTO "ApiKey" (id, name, "workspaceId") VALUES ('rls-forged', 'bad', ${b})`));
    await withDatabaseTenantContext(guarded, a, async tx => {
      assert.equal(await tx.$executeRaw`UPDATE "ApiKey" SET name = 'bad' WHERE id = ${`${b}-key`}`, 0);
      assert.equal(await tx.$executeRaw`DELETE FROM "ApiKey" WHERE id = ${`${b}-key`}`, 0);
    });
    await assert.rejects(withDatabaseTenantContext(guarded, a, tx => tx.$executeRaw`
      UPDATE "ApiKey" SET "workspaceId" = ${b} WHERE id = ${`${a}-key`}`));
    await assert.rejects(withDatabaseTenantContext(guarded, a, tx => tx.$executeRaw`
      UPDATE "SyncLogDetail" SET "syncLogId" = ${`${b}-log`} WHERE id = ${`${a}-detail`}`));
    await assert.rejects(withDatabaseTenantContext(guarded, a, tx => tx.$executeRaw`
      UPDATE "Pipeline" SET "sourceConnectionId" = ${`${b}-conn`} WHERE id = ${`${a}-pipe`}`));
  });

  it("rejects system escalation and migration-owner misuse", async () => {
    await withDatabaseTenantContext(guarded, a, async tx => {
      await tx.$executeRaw`SELECT set_config('monstera.system_scope', '1', true)`;
      assert.deepEqual(await tx.$queryRaw`SELECT id FROM "ApiKey"`, [{ id: `${a}-key` }]);
    });
    await assert.rejects(withDatabaseSystemContext(guarded, async () => true), /membership required/);
    await assert.rejects(withDatabaseTenantContext(createGuardedPrisma(admin), a, async () => true), /non-owner/);
  });

  it("does not leak context after commit, rollback, or queued tenants on one pool connection", async () => {
    await assert.rejects(withDatabaseTenantContext(guarded, a, async () => { throw new Error("rollback"); }), /rollback/);
    assert.deepEqual(await runtime.$queryRaw`SELECT id FROM "ApiKey"`, []);
    const results = await Promise.all([a, b, a, b].map(id => withDatabaseTenantContext(guarded, id,
      tx => tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "ApiKey"`)));
    assert.deepEqual(results, [a, b, a, b].map(id => [{ id: `${id}-key` }]));
    assert.deepEqual(await runtime.$queryRaw`SELECT id FROM "ApiKey"`, []);
  });

  it("rejects nested transactions and tenant switching; preserves RepeatableRead", async () => {
    await withDatabaseTenantContext(guarded, a, async tx => {
      const [level] = await tx.$queryRaw<Array<{ transaction_isolation: string }>>`SHOW transaction_isolation`;
      assert.equal(level.transaction_isolation, "repeatable read");
      await assert.rejects(withDatabaseTenantContext(guarded, b, async () => true), /already active/);
    }, { isolationLevel: "RepeatableRead" });
  });
});
