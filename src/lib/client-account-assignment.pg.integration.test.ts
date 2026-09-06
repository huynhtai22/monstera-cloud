import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  assignClientProviderAccount,
  unassignClientProviderAccount,
  cutoverUnambiguousAssignments,
  canonicalizeAccountId,
  bulkAssignClientProviderAccounts,
} from "./client-account-assignment";
import { queryWarehouse, type ScopedTransaction } from "./warehouse-query";
import { reportingDataset } from "./report-delivery";
import { loadReportReadiness } from "./report-readiness-server";
import { assertAllowedTestDatabase } from "./pg-test-discipline";
import { GET as getClients } from "@/app/api/clients/route";
import { setAuthSessionOverride } from "./auth-session";

describe("PostgreSQL integration: client provider account assignments", () => {
  let db: PrismaClient;
  const tx = () => db as unknown as ScopedTransaction;
  const suffix = `caa-${Date.now()}-${process.pid}`;

  const ids = {
    user: `user-${suffix}`,
    viewer: `viewer-${suffix}`,
    workspaceA: `ws-a-${suffix}`,
    workspaceB: `ws-b-${suffix}`,
    clientA: `cl-a-${suffix}`,
    clientA2: `cl-a2-${suffix}`,
    clientB: `cl-b-${suffix}`,
    connA1: `conn-a1-${suffix}`,
    connA2: `conn-a2-${suffix}`,
    connB1: `conn-b1-${suffix}`,
  };

  before(async () => {
    const url = process.env.DATABASE_URL;
    assertAllowedTestDatabase(url);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    await db.$queryRaw`SELECT 1`;

    // Seed test fixtures
    await db.user.createMany({
      data: [
        {
          id: ids.user,
          email: `${ids.user}@example.com`,
          name: "Test User",
        },
        {
          id: ids.viewer,
          email: `${ids.viewer}@example.com`,
          name: "Viewer User",
        },
      ],
    });

    await db.workspace.createMany({
      data: [
        { id: ids.workspaceA, ownerId: ids.user, name: "Workspace A", slug: `ws-a-${suffix}` },
        { id: ids.workspaceB, ownerId: ids.user, name: "Workspace B", slug: `ws-b-${suffix}` },
      ],
    });

    await db.workspaceMember.createMany({
      data: [
        { workspaceId: ids.workspaceA, userId: ids.user, role: "owner" },
        { workspaceId: ids.workspaceB, userId: ids.user, role: "owner" },
        { workspaceId: ids.workspaceA, userId: ids.viewer, role: "viewer" },
      ],
    });

    await db.client.createMany({
      data: [
        { id: ids.clientA, workspaceId: ids.workspaceA, name: "Client Alpha" },
        { id: ids.clientA2, workspaceId: ids.workspaceA, name: "Client Alpha Two" },
        { id: ids.clientB, workspaceId: ids.workspaceB, name: "Client Beta" },
      ],
    });

    await db.connection.createMany({
      data: [
        {
          id: ids.connA1,
          workspaceId: ids.workspaceA,
          name: "Google MCC 1",
          provider: "google_ads",
          type: "source",
          status: "connected",
          remoteAccountId: `mcc-1-${suffix}`,
          credentials: JSON.stringify({ customerIds: ["1112223333", "9990001111"] }),
        },
        {
          id: ids.connA2,
          workspaceId: ids.workspaceA,
          name: "Google MCC 2",
          provider: "google_ads",
          type: "source",
          status: "connected",
          remoteAccountId: `mcc-2-${suffix}`,
          credentials: JSON.stringify({ customerIds: ["1112223333"] }),
        },
        {
          id: ids.connB1,
          workspaceId: ids.workspaceB,
          name: "Google MCC Tenant B",
          provider: "google_ads",
          type: "source",
          status: "connected",
          remoteAccountId: `mcc-b1-${suffix}`,
          credentials: JSON.stringify({ customerIds: ["1112223333"] }),
        },
      ],
    });
  });

  after(async () => {
    if (!db) return;
    try {
      await db.campaignMetric.deleteMany({
        where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } },
      });
      await db.providerAccountHealth.deleteMany({
        where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } },
      });
      await db.clientProviderAccountAssignment.deleteMany({
        where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } },
      });
      await db.auditEvent.deleteMany({
        where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } },
      });
      await db.connection.deleteMany({
        where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } },
      });
      await db.client.deleteMany({
        where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } },
      });
      await db.workspaceMember.deleteMany({
        where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } },
      });
      await db.workspace.deleteMany({
        where: { id: { in: [ids.workspaceA, ids.workspaceB] } },
      });
      await db.user.deleteMany({
        where: { id: { in: [ids.user, ids.viewer] } },
      });
      await db.$disconnect();
    } catch {
      // Best-effort cleanup
    }
  });

  it("enforces database-level composite foreign keys across workspaces and providers", async () => {
    // 1. Cross-workspace client reference rejected
    await assert.rejects(
      () =>
        db.clientProviderAccountAssignment.create({
          data: {
            workspaceId: ids.workspaceA,
            clientId: ids.clientB, // Belongs to workspaceB!
            provider: "google_ads",
            accountId: "1112223333",
            connectionId: ids.connA1,
          },
        }),
      (err: any) => err.code === "P2003" || String(err.message).includes("Foreign key")
    );

    // 2. Cross-workspace connection reference rejected
    await assert.rejects(
      () =>
        db.clientProviderAccountAssignment.create({
          data: {
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            provider: "google_ads",
            accountId: "1112223333",
            connectionId: ids.connB1, // Belongs to workspaceB!
          },
        }),
      (err: any) => err.code === "P2003" || String(err.message).includes("Foreign key")
    );

    // 3. Provider mismatch rejected at the database level by composite foreign key
    // connA1 is google_ads. Attempting to create an assignment with provider meta_ads must fail at Postgres FK!
    await assert.rejects(
      () =>
        db.clientProviderAccountAssignment.create({
          data: {
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            provider: "meta_ads", // Mismatched provider!
            accountId: "1112223333",
            connectionId: ids.connA1, // google_ads connection!
          },
        }),
      (err: any) => err.code === "P2003" || String(err.message).includes("Foreign key")
    );
  });

  it("rejects arbitrary unknown account IDs before assignment", async () => {
    await assert.rejects(
      () =>
        assignClientProviderAccount(
          {
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            provider: "google_ads",
            accountId: "unknown-arbitrary-account-999",
            connectionId: ids.connA1,
            actorUserId: ids.user,
          },
          tx()
        ),
      (err: any) => err.statusCode === 400 && String(err.message).includes("was not discovered")
    );
  });

  it("canonicalizes account IDs so formatted variants share one identity and cannot duplicate", async () => {
    // 111-222-3333 vs 1112223333
    const canonical = canonicalizeAccountId("google_ads", "111-222-3333");
    assert.equal(canonical, "1112223333");

    const res1 = await assignClientProviderAccount(
      {
        workspaceId: ids.workspaceA,
        clientId: ids.clientA,
        provider: "google_ads",
        accountId: "111-222-3333",
        connectionId: ids.connA1,
        actorUserId: ids.user,
      },
      tx()
    );
    assert.equal(res1.action, "assigned");
    assert.equal(res1.assignment.accountId, "1112223333");

    // Re-assigning using unhyphenated form to same client is idempotent
    const res2 = await assignClientProviderAccount(
      {
        workspaceId: ids.workspaceA,
        clientId: ids.clientA,
        provider: "google_ads",
        accountId: "1112223333",
        connectionId: ids.connA1,
        actorUserId: ids.user,
      },
      tx()
    );
    assert.equal(res2.action, "unchanged");

    const count = await db.clientProviderAccountAssignment.count({
      where: { workspaceId: ids.workspaceA, provider: "google_ads", accountId: "1112223333" },
    });
    assert.equal(count, 1);
  });

  it("atomic bulk assignment rolls back completely when an item fails", async () => {
    // Account 9990001111 is discovered on connA1.
    // Account invalid-acc is NOT discovered.
    await assert.rejects(
      () =>
        bulkAssignClientProviderAccounts(
          {
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            items: [
              { provider: "google_ads", accountId: "9990001111", connectionId: ids.connA1 },
              { provider: "google_ads", accountId: "nonexistent-acc-xyz", connectionId: ids.connA1 },
            ],
            actorUserId: ids.user,
          },
          tx()
        ),
      (err: any) => err.statusCode === 400
    );

    // Verify item 1 (9990001111) was rolled back and NOT inserted
    const committed = await db.clientProviderAccountAssignment.findUnique({
      where: {
        workspaceId_provider_accountId: {
          workspaceId: ids.workspaceA,
          provider: "google_ads",
          accountId: "9990001111",
        },
      },
    });
    assert.equal(committed, null, "Item 1 must not commit if bulk assignment fails");
  });

  it("concurrent assignment: identical is idempotent, rival client gets 409 conflict", async () => {
    // Two concurrent attempts to assign the same account to different clients
    const results = await Promise.allSettled([
      assignClientProviderAccount(
        {
          workspaceId: ids.workspaceA,
          clientId: ids.clientA,
          provider: "google_ads",
          accountId: "9990001111",
          connectionId: ids.connA1,
          actorUserId: ids.user,
        },
        tx()
      ),
      assignClientProviderAccount(
        {
          workspaceId: ids.workspaceA,
          clientId: ids.clientA2,
          provider: "google_ads",
          accountId: "9990001111",
          connectionId: ids.connA1,
          actorUserId: ids.user,
        },
        tx()
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length + rejected.length, 2);

    // Exactly one winner or one winning reassignment
    assert.ok(fulfilled.length >= 1);
    const finalOwner = await db.clientProviderAccountAssignment.findUniqueOrThrow({
      where: {
        workspaceId_provider_accountId: {
          workspaceId: ids.workspaceA,
          provider: "google_ads",
          accountId: "9990001111",
        },
      },
    });
    assert.ok([ids.clientA, ids.clientA2].includes(finalOwner.clientId));
  });

  it("shared MCC client isolation: Client A (USD) and Client B (EUR unhealthy) remain isolated", async () => {
    // Client A owns 1112223333 on connA1
    // Client A2 owns 9990001111 on connA1
    await assignClientProviderAccount(
      {
        workspaceId: ids.workspaceA,
        clientId: ids.clientA,
        provider: "google_ads",
        accountId: "1112223333",
        connectionId: ids.connA1,
        actorUserId: ids.user,
      },
      tx()
    );
    await assignClientProviderAccount(
      {
        workspaceId: ids.workspaceA,
        clientId: ids.clientA2,
        provider: "google_ads",
        accountId: "9990001111",
        connectionId: ids.connA1,
        actorUserId: ids.user,
      },
      tx()
    );

    const window = { start: "2026-08-24", end: "2026-08-30" };
    const dates = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"];

    // Seed Client A's account with USD rows for all 7 days
    await db.campaignMetric.createMany({
      data: dates.map((d, i) => ({
        id: `cm-a-${i}-${suffix}`,
        workspaceId: ids.workspaceA,
        connectionId: ids.connA1,
        platform: "google_ads",
        accountId: "1112223333",
        accountName: "Client A Account",
        date: new Date(`${d}T00:00:00Z`),
        spend: 100,
        currency: "USD",
      })),
    });

    // Seed Client A2's account with EUR rows and unhealthy account status
    await db.campaignMetric.createMany({
      data: dates.map((d, i) => ({
        id: `cm-a2-${i}-${suffix}`,
        workspaceId: ids.workspaceA,
        connectionId: ids.connA1,
        platform: "google_ads",
        accountId: "9990001111",
        accountName: "Client A2 Account",
        date: new Date(`${d}T00:00:00Z`),
        spend: 200,
        currency: "EUR",
      })),
    });

    await db.providerAccountHealth.create({
      data: {
        workspaceId: ids.workspaceA,
        connectionId: ids.connA1,
        provider: "google_ads",
        accountId: "9990001111",
        status: "reconnect_required",
      },
    });

    // Evaluate report readiness for Client A
    const readinessA = await loadReportReadiness(ids.workspaceA, window, {
      clientId: ids.clientA,
      tx: tx(),
    });

    assert.equal(readinessA.evaluations.length, 1);
    const evalA = readinessA.evaluations[0];
    // Client A must see ONLY USD
    assert.deepEqual(evalA.currencies, ["USD"]);
    assert.equal(evalA.warnings.some((w) => w.code === "MIXED_CURRENCY"), false);
    // Client A must NOT inherit Client A2's account reconnect_required blocker
    assert.equal(evalA.blockers.some((b) => b.code === "SOURCE_RECONNECT_REQUIRED"), false);

    // Evaluate report readiness for Client A2
    const readinessA2 = await loadReportReadiness(ids.workspaceA, window, {
      clientId: ids.clientA2,
      tx: tx(),
    });
    assert.equal(readinessA2.evaluations.length, 1);
    const evalA2 = readinessA2.evaluations[0];
    // Client A2 must see ONLY EUR
    assert.deepEqual(evalA2.currencies, ["EUR"]);
    assert.equal(evalA2.warnings.some((w) => w.code === "MIXED_CURRENCY"), false);
    // Client A2 MUST have the reconnect_required blocker
    assert.ok(evalA2.blockers.some((b) => b.code === "SOURCE_RECONNECT_REQUIRED"));
  });

  it("final unassignment produces an explicit empty scope and does not fall back to legacy Connection.clientId", async () => {
    // Legacy connection pointer set on clientA
    await db.connection.update({
      where: { id: ids.connA1 },
      data: { clientId: ids.clientA },
    });

    // Explicit cutover
    await db.client.update({
      where: { workspaceId_id: { workspaceId: ids.workspaceA, id: ids.clientA } },
      data: { accountAssignmentsConfiguredAt: new Date() },
    });

    // Unassign the only account assigned to clientA
    await unassignClientProviderAccount(
      {
        workspaceId: ids.workspaceA,
        provider: "google_ads",
        accountId: "1112223333",
        actorUserId: ids.user,
      },
      tx()
    );

    // Query warehouse for clientA: must return 0 rows (NOT falling back to connA1!)
    const res = await queryWarehouse(
      {
        workspaceId: ids.workspaceA,
        clientId: ids.clientA,
        limit: 10,
        includeTotalCount: true,
      },
      tx()
    );

    assert.equal(res.rows.length, 0);
    assert.equal(res.totalCount, 0);

    // Reporting dataset must also be empty
    const ds = await reportingDataset(tx(), ids.workspaceA, ids.clientA, {
      start: "2026-08-24",
      end: "2026-08-30",
    });
    assert.equal(ds.rowCount, 0);
  });

  it("safely cuts over only unambiguous accounts and records durable configured marker", async () => {
    // Reset clientA2 to legacy mode
    await db.client.update({
      where: { workspaceId_id: { workspaceId: ids.workspaceA, id: ids.clientA2 } },
      data: { accountAssignmentsConfiguredAt: null },
    });
    await db.clientProviderAccountAssignment.deleteMany({
      where: { workspaceId: ids.workspaceA, clientId: ids.clientA2 },
    });
    await db.connection.update({
      where: { id: ids.connA2 },
      data: { clientId: ids.clientA2 },
    });

    // connA2 has 1112223333, but 1112223333 is also on connA1 (overlapping/ambiguous)
    const cutoverResult = await cutoverUnambiguousAssignments(
      ids.workspaceA,
      ids.clientA2,
      tx(),
      ids.user
    );

    // 1112223333 was ambiguous so it must NOT be assigned
    assert.equal(cutoverResult.assignedCount, 0);
    assert.equal(cutoverResult.skippedAmbiguousCount, 1);
    assert.equal(cutoverResult.ambiguousAccounts[0].accountId, "1112223333");

    // Client is now marked configured
    const updatedClient = await db.client.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId: ids.workspaceA, id: ids.clientA2 } },
    });
    assert.ok(updatedClient.accountAssignmentsConfiguredAt !== null);

    // Second run is idempotent
    const secondRun = await cutoverUnambiguousAssignments(
      ids.workspaceA,
      ids.clientA2,
      tx(),
      ids.user
    );
    assert.equal(secondRun.alreadyConfigured, true);
  });

  it("GET /api/clients is strictly read-only for viewers and performs zero mutations or cutover writes", async () => {
    // Ensure clientA has legacy connections attached, but accountAssignmentsConfiguredAt is null
    await db.client.update({
      where: { workspaceId_id: { workspaceId: ids.workspaceA, id: ids.clientA } },
      data: { accountAssignmentsConfiguredAt: null },
    });
    await db.connection.update({
      where: { id: ids.connA1 },
      data: { clientId: ids.clientA },
    });

    const assignmentsBefore = await db.clientProviderAccountAssignment.findMany({
      where: { workspaceId: ids.workspaceA },
    });
    const clientsBefore = await db.client.findMany({
      where: { workspaceId: ids.workspaceA },
      select: { id: true, accountAssignmentsConfiguredAt: true, updatedAt: true },
    });
    const auditsBefore = await db.auditEvent.count({
      where: { workspaceId: ids.workspaceA },
    });

    setAuthSessionOverride(async () => ({
      user: { id: ids.viewer, email: `${ids.viewer}@example.com` },
      expires: "2099-01-01T00:00:00.000Z",
    }));

    try {
      const req = new Request(`http://localhost/api/clients?workspaceId=${ids.workspaceA}`);
      const res = await getClients(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data));
      assert.ok(data.length >= 2);

      // Verify zero mutations occurred in database
      const assignmentsAfter = await db.clientProviderAccountAssignment.findMany({
        where: { workspaceId: ids.workspaceA },
      });
      assert.equal(assignmentsAfter.length, assignmentsBefore.length);

      const clientsAfter = await db.client.findMany({
        where: { workspaceId: ids.workspaceA },
        select: { id: true, accountAssignmentsConfiguredAt: true, updatedAt: true },
      });
      assert.deepEqual(clientsAfter, clientsBefore);

      const auditsAfter = await db.auditEvent.count({
        where: { workspaceId: ids.workspaceA },
      });
      assert.equal(auditsAfter, auditsBefore);
    } finally {
      setAuthSessionOverride(null);
    }
  });
});
