import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  assignClientProviderAccount,
  unassignClientProviderAccount,
  switchAuthoritativeConnection,
  getWorkspaceDiscoveredAccounts,
  cutoverUnambiguousAssignments,
} from "./client-account-assignment";
import { queryWarehouse, type ScopedTransaction } from "./warehouse-query";
import { reportingDataset } from "./report-delivery";
import { assertCiDatabaseReachableWhenMissing } from "./pg-test-discipline";

describe("PostgreSQL integration: client provider account assignments", () => {
  let db: PrismaClient | null = null;
  const tx = () => db as unknown as ScopedTransaction;
  const suffix = `caa-${Date.now()}-${process.pid}`;

  const ids = {
    user: `user-${suffix}`,
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
    assertCiDatabaseReachableWhenMissing();
    const url = process.env.DATABASE_URL;
    if (!url || url.includes("mock")) {
      return;
    }
    try {
      db = new PrismaClient({ datasources: { db: { url } } });
      await db.$connect();
      // Test basic query to make sure DB is responsive
      await db.$queryRaw`SELECT 1`;
    } catch {
      db = null;
      return;
    }

    // Seed test fixtures
    await db.user.create({
      data: {
        id: ids.user,
        email: `${ids.user}@example.com`,
        name: "Test User",
      },
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
          credentials: JSON.stringify({ customerIds: ["111-222-3333", "999-000-1111"] }),
        },
        {
          id: ids.connA2,
          workspaceId: ids.workspaceA,
          name: "Google MCC 2",
          provider: "google_ads",
          type: "source",
          status: "connected",
          remoteAccountId: `mcc-2-${suffix}`,
          credentials: JSON.stringify({ customerIds: ["111-222-3333"] }),
        },
        {
          id: ids.connB1,
          workspaceId: ids.workspaceB,
          name: "Google MCC Tenant B",
          provider: "google_ads",
          type: "source",
          status: "connected",
          remoteAccountId: `mcc-b1-${suffix}`,
          credentials: JSON.stringify({ customerIds: ["111-222-3333"] }),
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
        where: { id: ids.user },
      });
      await db.$disconnect();
    } catch {
      // Best-effort cleanup
    }
  });

  it("enforces database-level composite foreign keys across workspaces", async () => {
    if (!db) return;

    // 1. Attempting to insert assignment with Workspace A, but Client from Workspace B
    await assert.rejects(
      () =>
        db!.clientProviderAccountAssignment.create({
          data: {
            workspaceId: ids.workspaceA,
            clientId: ids.clientB, // Belongs to workspaceB!
            provider: "google_ads",
            accountId: "111-222-3333",
            connectionId: ids.connA1,
            status: "active",
          },
        }),
      (err: any) => {
        // Must fail with Postgres Foreign Key violation (code 23503 or Prisma P2003)
        return err.code === "P2003" || String(err.message).includes("Foreign key");
      }
    );

    // 2. Attempting to insert assignment with Workspace A, but Connection from Workspace B
    await assert.rejects(
      () =>
        db!.clientProviderAccountAssignment.create({
          data: {
            workspaceId: ids.workspaceA,
            clientId: ids.clientA,
            provider: "google_ads",
            accountId: "111-222-3333",
            connectionId: ids.connB1, // Belongs to workspaceB!
            status: "active",
          },
        }),
      (err: any) => {
        return err.code === "P2003" || String(err.message).includes("Foreign key");
      }
    );
  });

  it("enforces database-level uniqueness on (workspaceId, provider, accountId) and supports safe reassignment", async () => {
    if (!db) return;

    // First assignment: assign 111-222-3333 to clientA
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
    assert.equal(res1.assignment.clientId, ids.clientA);

    // Reassign to clientA2
    const res2 = await assignClientProviderAccount(
      {
        workspaceId: ids.workspaceA,
        clientId: ids.clientA2,
        provider: "google_ads",
        accountId: "111-222-3333",
        connectionId: ids.connA1,
        actorUserId: ids.user,
      },
      tx()
    );

    assert.equal(res2.action, "reassigned");
    assert.equal(res2.assignment.clientId, ids.clientA2);

    // Verify exactly ONE assignment exists in DB for this provider account
    const count = await db.clientProviderAccountAssignment.count({
      where: {
        workspaceId: ids.workspaceA,
        provider: "google_ads",
        accountId: "111-222-3333",
      },
    });
    assert.equal(count, 1);

    // Verify audit events were written
    const audits = await db.auditEvent.findMany({
      where: {
        workspaceId: ids.workspaceA,
        resource: "client_provider_account_assignment",
      },
      orderBy: { createdAt: "asc" },
    });
    assert.ok(audits.some((a) => a.action === "client_account.assigned"));
    assert.ok(audits.some((a) => a.action === "client_account.reassigned"));
  });

  it("discovers accounts with multi-root detection and switches authoritative connection", async () => {
    if (!db) return;

    // Both connA1 and connA2 have access to 111-222-3333
    const discovered = await getWorkspaceDiscoveredAccounts(ids.workspaceA, tx());
    const target = discovered.find((a) => a.accountId === "111-222-3333");

    assert.ok(target);
    assert.equal(target.hasMultipleRootConnections, true);
    assert.equal(target.availableConnections.length, 2);
    assert.equal(target.authoritativeConnectionId, ids.connA1);

    // Switch authoritative connection to connA2
    const switchRes = await switchAuthoritativeConnection(
      {
        workspaceId: ids.workspaceA,
        provider: "google_ads",
        accountId: "111-222-3333",
        newConnectionId: ids.connA2,
        actorUserId: ids.user,
      },
      tx()
    );

    assert.equal(switchRes.changed, true);
    assert.equal(switchRes.assignment.connectionId, ids.connA2);

    // Verify discovered account reflects the new authoritative connection
    const updatedDiscovered = await getWorkspaceDiscoveredAccounts(ids.workspaceA, tx());
    const updatedTarget = updatedDiscovered.find((a) => a.accountId === "111-222-3333");
    assert.ok(updatedTarget);
    assert.equal(updatedTarget.authoritativeConnectionId, ids.connA2);
  });

  it("scopes warehouse queries strictly to assigned accounts and authoritative connection", async () => {
    if (!db) return;

    // Seed campaign metrics:
    // Row 1: account 111-222-3333 via connA2 (authoritative for clientA2)
    // Row 2: account 999-000-1111 via connA1 (not assigned to clientA2)
    // Row 3: account 111-222-3333 via connA1 (non-authoritative connection for 111-222-3333)
    const today = new Date("2026-09-01T00:00:00Z");

    await db.campaignMetric.createMany({
      data: [
        {
          id: `metric-1-${suffix}`,
          workspaceId: ids.workspaceA,
          connectionId: ids.connA2,
          platform: "google_ads",
          accountId: "111-222-3333",
          accountName: "Auth Account Row",
          date: today,
          impressions: 1000,
          clicks: 50,
          spend: 100,
          currency: "USD",
        },
        {
          id: `metric-2-${suffix}`,
          workspaceId: ids.workspaceA,
          connectionId: ids.connA1,
          platform: "google_ads",
          accountId: "999-000-1111",
          accountName: "Unassigned Account Row",
          date: today,
          impressions: 2000,
          clicks: 100,
          spend: 200,
          currency: "USD",
        },
        {
          id: `metric-3-${suffix}`,
          workspaceId: ids.workspaceA,
          connectionId: ids.connA1,
          platform: "google_ads",
          accountId: "111-222-3333",
          accountName: "Duplicate Root Non-Auth Row",
          date: today,
          impressions: 500,
          clicks: 25,
          spend: 50,
          currency: "USD",
        },
      ],
    });

    // Query for clientA2: should return ONLY metric-1 (connA2, 111-222-3333)
    const clientQuery = await queryWarehouse(
      {
        workspaceId: ids.workspaceA,
        clientId: ids.clientA2,
        limit: 10,
      },
      tx()
    );

    assert.equal(clientQuery.rows.length, 1);
    assert.equal(clientQuery.rows[0].id, `metric-1-${suffix}`);
    assert.equal(clientQuery.rows[0].accountId, "111-222-3333");
    assert.equal(clientQuery.rows[0].connectionId, ids.connA2);

    // Unassign 111-222-3333 from clientA2
    await unassignClientProviderAccount(
      {
        workspaceId: ids.workspaceA,
        provider: "google_ads",
        accountId: "111-222-3333",
        actorUserId: ids.user,
      },
      tx()
    );

    // Query for clientA2 should now return 0 rows
    const unassignedQuery = await queryWarehouse(
      {
        workspaceId: ids.workspaceA,
        clientId: ids.clientA2,
        limit: 10,
      },
      tx()
    );
    assert.equal(unassignedQuery.rows.length, 0);
  });

  it("binds assignments into report dataset fingerprint and invalidates on assignment change", async () => {
    if (!db) return;

    const window = { start: "2026-08-25", end: "2026-08-31" };

    // Baseline: no active assignment for clientA
    const dataset1 = await reportingDataset(tx(), ids.workspaceA, ids.clientA, window);

    // Assign account to clientA
    await assignClientProviderAccount(
      {
        workspaceId: ids.workspaceA,
        clientId: ids.clientA,
        provider: "google_ads",
        accountId: "999-000-1111",
        connectionId: ids.connA1,
        actorUserId: ids.user,
      },
      tx()
    );

    const dataset2 = await reportingDataset(tx(), ids.workspaceA, ids.clientA, window);

    // Fingerprints MUST differ
    assert.notEqual(dataset1.fingerprint, dataset2.fingerprint);

    // Switch authoritative connection
    await switchAuthoritativeConnection(
      {
        workspaceId: ids.workspaceA,
        provider: "google_ads",
        accountId: "999-000-1111",
        newConnectionId: ids.connA1, // unchanged check
      },
      tx()
    );

    // Unassign account
    await unassignClientProviderAccount(
      {
        workspaceId: ids.workspaceA,
        provider: "google_ads",
        accountId: "999-000-1111",
      },
      tx()
    );

    const dataset3 = await reportingDataset(tx(), ids.workspaceA, ids.clientA, window);

    // After unassigning, fingerprint reverts or matches clean empty state
    assert.notEqual(dataset2.fingerprint, dataset3.fingerprint);
    assert.equal(dataset1.fingerprint, dataset3.fingerprint);
  });

  it("safely cuts over only unambiguous accounts and skips overlapping roots", async () => {
    if (!db) return;

    // Attach connA1 as legacy clientId on clientA
    await db.connection.update({
      where: { id: ids.connA1 },
      data: { clientId: ids.clientA },
    });

    // connA1 has access to:
    // - "999-000-1111" (appears ONLY under connA1) -> UNAMBIGUOUS
    // - "111-222-3333" (appears under both connA1 and connA2) -> OVERLAPPING/AMBIGUOUS

    // Clear existing assignments for workspaceA first
    await db.clientProviderAccountAssignment.deleteMany({
      where: { workspaceId: ids.workspaceA },
    });

    const cutover = await cutoverUnambiguousAssignments(ids.workspaceA, ids.clientA, tx());

    // Only 999-000-1111 should be cut over!
    assert.equal(cutover.length, 1);
    assert.equal(cutover[0].accountId, "999-000-1111");
    assert.equal(cutover[0].clientId, ids.clientA);

    // 111-222-3333 must NOT be in DB assignments
    const ambiguousInDb = await db.clientProviderAccountAssignment.findUnique({
      where: {
        workspaceId_provider_accountId: {
          workspaceId: ids.workspaceA,
          provider: "google_ads",
          accountId: "111-222-3333",
        },
      },
    });
    assert.equal(ambiguousInDb, null);

    // Discovered accounts shows 111-222-3333 as visibly unassigned with multi-root warning
    const discovered = await getWorkspaceDiscoveredAccounts(ids.workspaceA, tx());
    const discoveredAmbiguous = discovered.find((a) => a.accountId === "111-222-3333");
    assert.ok(discoveredAmbiguous);
    assert.equal(discoveredAmbiguous.isAssigned, false);
    assert.equal(discoveredAmbiguous.hasMultipleRootConnections, true);
  });
});
