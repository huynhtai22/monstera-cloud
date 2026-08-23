import assert from "node:assert/strict";
import { assertCiDatabaseReachable } from "./pg-test-discipline";
import { after, before, describe, it } from "node:test";
import prisma from "@/lib/prisma"; // guarded client ($extends query hook)
import { TenantScopeError, withSystemScope } from "./tenant-guard";

/**
 * Real PostgreSQL verification of the tenant-guard coverage extension
 * (audit 2026-08): every newly guarded model must reject unscoped bulk
 * reads/writes/creates, accept explicitly workspace-scoped operations,
 * and keep fleet cron/webhook paths working through narrow withSystemScope
 * boundaries. Requires a reachable DATABASE_URL; fails (not skips) in CI.
 */
describe("PostgreSQL integration: tenant-guard coverage", () => {
    const suffix = `${Date.now()}-${process.pid}`;
    const ids = {
        ownerA: `tg-owner-a-${suffix}`,
        ownerB: `tg-owner-b-${suffix}`,
        wsA: `tg-ws-a-${suffix}`,
        wsB: `tg-ws-b-${suffix}`,
    };
    let dbAvailable = false;

    async function expectTenantScopeError(run: () => Promise<unknown>, label: string) {
        let caught: unknown = null;
        try {
            await run();
        } catch (err) {
            caught = err;
        }
        assert.ok(
            caught instanceof TenantScopeError,
            `${label} must be rejected by the tenant guard (got ${String(caught)})`,
        );
    }

    before(async () => {
        if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("mock")) {
            assertCiDatabaseReachable();
            return;
        }
        try {
            await prisma.$queryRaw`SELECT 1`;
            dbAvailable = true;
        } catch {
            assertCiDatabaseReachable();
            return;
        }
        await prisma.user.createMany({
            data: [
                { id: ids.ownerA, email: `${ids.ownerA}@example.test` },
                { id: ids.ownerB, email: `${ids.ownerB}@example.test` },
            ],
        });
        await prisma.workspace.createMany({
            data: [
                { id: ids.wsA, name: "TG WS A", slug: ids.wsA, ownerId: ids.ownerA },
                { id: ids.wsB, name: "TG WS B", slug: ids.wsB, ownerId: ids.ownerB },
            ],
        });
    });

    after(async () => {
        if (!dbAvailable) return;
        await withSystemScope(async () => {
            // Cascade removes clients/pipelines/metrics/audit events etc.
            await prisma.workspace.deleteMany({ where: { id: { in: [ids.wsA, ids.wsB] } } });
            await prisma.user.deleteMany({ where: { id: { in: [ids.ownerA, ids.ownerB] } } });
        });
        await prisma.$disconnect();
    });

    it("blocks unscoped bulk reads on newly guarded models", async () => {
        if (!dbAvailable) return;
        await expectTenantScopeError(() => prisma.client.findMany({}), "client.findMany");
        await expectTenantScopeError(() => prisma.pipeline.count({}), "pipeline.count");
        await expectTenantScopeError(
            () => prisma.retailOrder.aggregate({ _count: { _all: true } }),
            "retailOrder.aggregate",
        );
        await expectTenantScopeError(
            () => prisma.auditEvent.groupBy({ by: ["action"] }),
            "auditEvent.groupBy",
        );
    });

    it("blocks unscoped bulk updates and deletes", async () => {
        if (!dbAvailable) return;
        await expectTenantScopeError(
            () =>
                prisma.pipeline.updateMany({
                    where: { status: "active" },
                    data: { healthStatus: "stale" },
                }),
            "pipeline.updateMany(status-only)",
        );
        await expectTenantScopeError(
            () => prisma.retailOrder.deleteMany({ where: { platform: "shopee" } }),
            "retailOrder.deleteMany(platform-only)",
        );
    });

    it("requires workspace scope on creates and upserts", async () => {
        if (!dbAvailable) return;
        // Intentionally malformed payloads: valid Prisma types but missing the
        // tenant key. Cast keeps TypeScript from rejecting what the guard must
        // reject at runtime.
        const unscopedAuditCreate = {
            data: { action: "guard.probe", resource: "test" },
        } as unknown as Parameters<typeof prisma.auditEvent.create>[0];
        await expectTenantScopeError(
            () => prisma.auditEvent.create(unscopedAuditCreate),
            "auditEvent.create(no workspaceId)",
        );
        const unscopedViolationCreate = {
            data: { ruleId: "nonexistent", expectedValue: 1, actualValue: 2 },
        } as unknown as Parameters<typeof prisma.dataQualityViolation.create>[0];
        await expectTenantScopeError(
            () => prisma.dataQualityViolation.create(unscopedViolationCreate),
            "dataQualityViolation.create(no workspaceId)",
        );

        // Scoped creates succeed.
        const event = await prisma.auditEvent.create({
            data: {
                workspaceId: ids.wsA,
                action: "guard.scoped_create_ok",
                resource: "test",
            },
        });
        assert.ok(event.id);
    });

    it("allows single-id updateMany without a workspace filter", async () => {
        if (!dbAvailable) return;
        const result = await prisma.pipeline.updateMany({
            where: { id: `no-such-pipeline-${suffix}` },
            data: { healthStatus: "stale" },
        });
        assert.equal(result.count, 0);
    });

    it("keeps scoped reads tenant-isolated at the data level", async () => {
        if (!dbAvailable) return;
        const clientA = await prisma.client.create({
            data: { workspaceId: ids.wsA, name: "Client A" },
        });
        const clientB = await prisma.client.create({
            data: { workspaceId: ids.wsB, name: "Client B" },
        });

        const rowsA = await prisma.client.findMany({
            where: { workspaceId: ids.wsA },
            select: { id: true },
        });
        assert.deepEqual(rowsA.map((r) => r.id), [clientA.id]);

        // Cross-tenant writes must not leak: A's filter cannot touch B's row.
        const crossUpdate = await prisma.client.updateMany({
            where: { id: clientB.id, workspaceId: ids.wsA },
            data: { name: "hijacked" },
        });
        assert.equal(crossUpdate.count, 0);

        const stillIntact = await prisma.client.findUnique({ where: { id: clientB.id } });
        assert.equal(stillIntact?.name, "Client B");

        await prisma.client.delete({ where: { id: clientB.id } });
        await prisma.client.delete({ where: { id: clientA.id } });
    });

    it("preserves nested ownership-path filters (workspace / pipeline nesting)", async () => {
        if (!dbAvailable) return;
        const rows = await prisma.client.findMany({
            where: { workspace: { is: { id: ids.wsA } } },
            select: { id: true },
        });
        assert.ok(Array.isArray(rows));
    });

    it("preserves fleet system-worker semantics through explicit withSystemScope", async () => {
        if (!dbAvailable) return;
        const fleetPipelines = await withSystemScope(async () => {
            return await prisma.pipeline.findMany({});
        });
        assert.ok(Array.isArray(fleetPipelines));

        const fleetBulk = await withSystemScope(async () => {
            return await prisma.pipeline.updateMany({
                where: { id: `no-such-${suffix}` },
                data: { healthStatus: "stale" },
            });
        });
        assert.equal(fleetBulk.count, 0);

        // System scope is bounded to the callback — it does not leak outwards.
        await expectTenantScopeError(
            () => prisma.client.findMany({}),
            "post-system-scope client.findMany",
        );
    });
});
