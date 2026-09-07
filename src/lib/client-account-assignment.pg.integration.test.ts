import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  assignClientProviderAccount,
  unassignClientProviderAccount,
  cutoverUnambiguousAssignments,
  cutoverUnambiguousAssignmentsInTransaction,
  canonicalizeAccountId,
  bulkAssignClientProviderAccounts,
} from "./client-account-assignment";
import { queryWarehouse, type ScopedTransaction } from "./warehouse-query";
import { reportingDataset } from "./report-delivery";
import { loadReportReadiness } from "./report-readiness-server";
import { assertAllowedTestDatabase } from "./pg-test-discipline";
import { GET as getClients } from "@/app/api/clients/route";
import { GET as getExportRows } from "@/app/api/export/rows/route";
import { queryMetricsAggregate } from "./warehouse-aggregate";
import { hashApiKey } from "./api-key-security";
import { setAuthSessionOverride } from "./auth-session";

describe("PostgreSQL integration: client provider account assignments", () => {
  let db: PrismaClient;
  const tx = () => db as unknown as ScopedTransaction;
  const suffix = `caa-${Date.now()}-${process.pid}`;
  const testApiKeySecret = `mc_live_test_${suffix}`;

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
        { id: ids.workspaceA, ownerId: ids.user, name: "Workspace A", slug: `ws-a-${suffix}`, plan: "professional" },
        { id: ids.workspaceB, ownerId: ids.user, name: "Workspace B", slug: `ws-b-${suffix}`, plan: "professional" },
      ],
    });

    await db.apiKey.create({
      data: {
        workspaceId: ids.workspaceA,
        name: "Test Api Key",
        keyHash: hashApiKey(testApiKeySecret),
        keyPrefix: "mc_live_",
        keyLastFour: suffix.slice(-4),
      },
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

  it("rejects ambiguous roots from bulk assignment while preserving explicit manual source selection", async () => {
    const clientId = `cl-bulk-${suffix}`;
    const accountId = "7770007777";
    const firstRoot = `conn-bulk-1-${suffix}`;
    const secondRoot = `conn-bulk-2-${suffix}`;
    await db.client.create({ data: { id: clientId, workspaceId: ids.workspaceA, name: "Bulk client" } });
    await db.connection.createMany({
      data: [
        {
          id: firstRoot, workspaceId: ids.workspaceA, name: "First root", provider: "google_ads", type: "source", status: "connected",
          credentials: JSON.stringify({ customerIds: [accountId] }),
        },
        {
          id: secondRoot, workspaceId: ids.workspaceA, name: "Second root", provider: "google_ads", type: "source", status: "connected",
          credentials: JSON.stringify({ customerIds: [accountId] }),
        },
      ],
    });

    for (const connectionId of [firstRoot, secondRoot]) {
      await assert.rejects(
        () => bulkAssignClientProviderAccounts({
          workspaceId: ids.workspaceA,
          clientId,
          items: [{ provider: "google_ads", accountId, connectionId }],
          actorUserId: ids.user,
        }, tx()),
        (error: any) => error?.statusCode === 409 && String(error.message).includes("unambiguous source"),
      );
    }
    assert.equal(await db.clientProviderAccountAssignment.count({
      where: { workspaceId: ids.workspaceA, provider: "google_ads", accountId },
    }), 0, "bulk order cannot choose either overlapping root");

    const manual = await assignClientProviderAccount({
      workspaceId: ids.workspaceA, clientId, provider: "google_ads", accountId, connectionId: secondRoot, actorUserId: ids.user,
    }, tx());
    assert.equal(manual.assignment.connectionId, secondRoot);
  });

  it("keeps legacy tuples assigned, exposes final explicit unassignments, and excludes alternate owned roots from unassigned queries", async () => {
    const legacyClientId = `cl-unassigned-legacy-${suffix}`;
    const explicitClientId = `cl-unassigned-explicit-${suffix}`;
    const ownerClientId = `cl-unassigned-owner-${suffix}`;
    const legacyConnectionId = `conn-unassigned-legacy-${suffix}`;
    const explicitConnectionId = `conn-unassigned-explicit-${suffix}`;
    const ownerConnectionId = `conn-unassigned-owner-${suffix}`;
    const alternateConnectionId = `conn-unassigned-alternate-${suffix}`;
    const legacyAccount = "8110008111";
    const explicitlyUnassignedAccount = "8220008222";
    const ownedSharedAccount = "8330008333";
    const freeAccount = "8440008444";
    const date = new Date("2026-09-04T12:00:00.000Z");

    await db.client.createMany({ data: [
      { id: legacyClientId, workspaceId: ids.workspaceA, name: "Legacy unassigned client" },
      { id: explicitClientId, workspaceId: ids.workspaceA, name: "Explicit unassigned client" },
      { id: ownerClientId, workspaceId: ids.workspaceA, name: "Tuple owner client", accountAssignmentsConfiguredAt: new Date() },
    ] });
    await db.connection.createMany({ data: [
      { id: legacyConnectionId, workspaceId: ids.workspaceA, clientId: legacyClientId, name: "Legacy source", provider: "google_ads", type: "source", status: "connected", credentials: JSON.stringify({ customerIds: [legacyAccount] }) },
      { id: explicitConnectionId, workspaceId: ids.workspaceA, clientId: explicitClientId, name: "Explicit source", provider: "google_ads", type: "source", status: "connected", credentials: JSON.stringify({ customerIds: [explicitlyUnassignedAccount] }) },
      { id: ownerConnectionId, workspaceId: ids.workspaceA, name: "Tuple owner root", provider: "google_ads", type: "source", status: "connected", credentials: JSON.stringify({ customerIds: [ownedSharedAccount] }) },
      { id: alternateConnectionId, workspaceId: ids.workspaceA, name: "Alternate root", provider: "google_ads", type: "source", status: "connected", credentials: JSON.stringify({ customerIds: [ownedSharedAccount, freeAccount] }) },
    ] });
    await db.campaignMetric.createMany({ data: [
      { workspaceId: ids.workspaceA, connectionId: legacyConnectionId, platform: "google_ads", accountId: legacyAccount, campaignId: `legacy-${suffix}`, date, spend: 1, currency: "USD" },
      { workspaceId: ids.workspaceA, connectionId: explicitConnectionId, platform: "google_ads", accountId: explicitlyUnassignedAccount, campaignId: `explicit-${suffix}`, date, spend: 2, currency: "USD" },
      { workspaceId: ids.workspaceA, connectionId: ownerConnectionId, platform: "google_ads", accountId: ownedSharedAccount, campaignId: `owner-${suffix}`, date, spend: 3, currency: "USD" },
      { workspaceId: ids.workspaceA, connectionId: alternateConnectionId, platform: "google_ads", accountId: ownedSharedAccount, campaignId: `alternate-owned-${suffix}`, date, spend: 4, currency: "USD" },
      { workspaceId: ids.workspaceA, connectionId: alternateConnectionId, platform: "google_ads", accountId: freeAccount, campaignId: `free-${suffix}`, date, spend: 5, currency: "USD" },
    ] });

    await assignClientProviderAccount({
      workspaceId: ids.workspaceA, clientId: explicitClientId, provider: "google_ads", accountId: explicitlyUnassignedAccount, connectionId: explicitConnectionId, actorUserId: ids.user,
    }, tx());
    await unassignClientProviderAccount({
      workspaceId: ids.workspaceA, provider: "google_ads", accountId: explicitlyUnassignedAccount, actorUserId: ids.user,
    }, tx());
    await db.clientProviderAccountAssignment.create({ data: {
      workspaceId: ids.workspaceA, clientId: ownerClientId, provider: "google_ads", accountId: ownedSharedAccount, connectionId: ownerConnectionId,
    } });

    const scopedAccountIds = [legacyAccount, explicitlyUnassignedAccount, ownedSharedAccount, freeAccount];
    const legacyRows = await queryWarehouse({ workspaceId: ids.workspaceA, clientId: legacyClientId, accountIds: scopedAccountIds }, tx());
    assert.deepEqual(legacyRows.rows.map((row) => row.accountId), [legacyAccount]);
    const explicitRows = await queryWarehouse({ workspaceId: ids.workspaceA, clientId: explicitClientId, accountIds: scopedAccountIds }, tx());
    assert.equal(explicitRows.rows.length, 0, "final explicit unassignment does not revive legacy connection scope");

    const unassignedPage = await queryWarehouse({
      workspaceId: ids.workspaceA, clientId: "unassigned", accountIds: scopedAccountIds, limit: 1, includeTotalCount: true,
    }, tx());
    assert.equal(unassignedPage.totalCount, 2);
    assert.equal(unassignedPage.pagination.hasMore, true);
    const unassignedNext = await queryWarehouse({
      workspaceId: ids.workspaceA, clientId: "unassigned", accountIds: scopedAccountIds, limit: 2, cursor: unassignedPage.pagination.nextCursor, includeTotalCount: true,
    }, tx());
    const visibleAccountIds = new Set([...unassignedPage.rows, ...unassignedNext.rows].map((row) => row.accountId));
    assert.deepEqual(visibleAccountIds, new Set([explicitlyUnassignedAccount, freeAccount]));
    assert.equal(unassignedNext.totalCount, 2, "cursor pagination uses the same tuple ownership scope as the count");

    const aggregate = await queryMetricsAggregate({
      workspaceId: ids.workspaceA,
      clientId: "unassigned",
      startDateStr: "2026-09-04",
      endDateStr: "2026-09-04",
      accountIds: scopedAccountIds,
      dimensions: ["accountId"],
      metrics: ["spend"],
    });
    assert.deepEqual(new Set(aggregate.rows.map((row) => row.accountId)), new Set([explicitlyUnassignedAccount, freeAccount]));
  });

  it("rolls back every workspace cutover write when a later client conflicts, while valid clients commit together", async () => {
    const firstClientId = `cl-cutover-first-${suffix}`;
    const conflictingClientId = `cl-cutover-conflict-${suffix}`;
    const existingOwnerId = `cl-cutover-owner-${suffix}`;
    const firstConnectionId = `conn-cutover-first-${suffix}`;
    const conflictingConnectionId = `conn-cutover-conflict-${suffix}`;
    const ownerConnectionId = `conn-cutover-owner-${suffix}`;
    const firstAccount = "8550008555";
    const conflictingAccount = "8660008666";
    await db.client.createMany({ data: [
      { id: firstClientId, workspaceId: ids.workspaceA, name: "First cutover client" },
      { id: conflictingClientId, workspaceId: ids.workspaceA, name: "Conflicting cutover client" },
      { id: existingOwnerId, workspaceId: ids.workspaceA, name: "Existing owner", accountAssignmentsConfiguredAt: new Date() },
    ] });
    await db.connection.createMany({ data: [
      { id: firstConnectionId, workspaceId: ids.workspaceA, clientId: firstClientId, name: "First cutover root", provider: "google_ads", type: "source", status: "connected", credentials: JSON.stringify({ customerIds: [firstAccount] }) },
      { id: conflictingConnectionId, workspaceId: ids.workspaceA, clientId: conflictingClientId, name: "Conflicting cutover root", provider: "google_ads", type: "source", status: "connected", credentials: JSON.stringify({ customerIds: [conflictingAccount] }) },
      { id: ownerConnectionId, workspaceId: ids.workspaceA, name: "Existing owner root", provider: "google_ads", type: "source", status: "connected", credentials: JSON.stringify({ customerIds: [conflictingAccount] }) },
    ] });
    await db.clientProviderAccountAssignment.create({ data: {
      workspaceId: ids.workspaceA, clientId: existingOwnerId, provider: "google_ads", accountId: conflictingAccount, connectionId: ownerConnectionId,
    } });

    await assert.rejects(
      () => db.$transaction(async (transaction) => {
        const scopedTransaction = transaction as unknown as ScopedTransaction;
        await cutoverUnambiguousAssignmentsInTransaction(ids.workspaceA, firstClientId, scopedTransaction, ids.user);
        await cutoverUnambiguousAssignmentsInTransaction(ids.workspaceA, conflictingClientId, scopedTransaction, ids.user);
      }, { isolationLevel: "Serializable" }),
      (error: any) => error?.statusCode === 409,
    );
    const rolledBack = await db.client.findMany({
      where: { id: { in: [firstClientId, conflictingClientId] } },
      select: { id: true, accountAssignmentsConfiguredAt: true },
    });
    assert.ok(rolledBack.every((client) => client.accountAssignmentsConfiguredAt === null));
    assert.equal(await db.clientProviderAccountAssignment.count({ where: { workspaceId: ids.workspaceA, clientId: firstClientId } }), 0);
    assert.equal(await db.auditEvent.count({ where: { workspaceId: ids.workspaceA, resourceId: { in: [firstClientId, conflictingClientId] }, action: "client_account.cutover_completed" } }), 0);

    const validFirstId = `cl-cutover-valid-1-${suffix}`;
    const validSecondId = `cl-cutover-valid-2-${suffix}`;
    const validFirstConnectionId = `conn-cutover-valid-1-${suffix}`;
    const validSecondConnectionId = `conn-cutover-valid-2-${suffix}`;
    await db.client.createMany({ data: [
      { id: validFirstId, workspaceId: ids.workspaceA, name: "Valid cutover one" },
      { id: validSecondId, workspaceId: ids.workspaceA, name: "Valid cutover two" },
    ] });
    await db.connection.createMany({ data: [
      { id: validFirstConnectionId, workspaceId: ids.workspaceA, clientId: validFirstId, name: "Valid cutover root one", provider: "google_ads", type: "source", status: "connected", credentials: JSON.stringify({ customerIds: ["8770008777"] }) },
      { id: validSecondConnectionId, workspaceId: ids.workspaceA, clientId: validSecondId, name: "Valid cutover root two", provider: "google_ads", type: "source", status: "connected", credentials: JSON.stringify({ customerIds: ["8880008888"] }) },
    ] });
    await db.$transaction(async (transaction) => {
      const scopedTransaction = transaction as unknown as ScopedTransaction;
      await cutoverUnambiguousAssignmentsInTransaction(ids.workspaceA, validFirstId, scopedTransaction, ids.user);
      await cutoverUnambiguousAssignmentsInTransaction(ids.workspaceA, validSecondId, scopedTransaction, ids.user);
    }, { isolationLevel: "Serializable" });
    assert.equal(await db.clientProviderAccountAssignment.count({ where: { workspaceId: ids.workspaceA, clientId: { in: [validFirstId, validSecondId] } } }), 2);
    assert.equal(await db.auditEvent.count({ where: { workspaceId: ids.workspaceA, resourceId: { in: [validFirstId, validSecondId] }, action: "client_account.cutover_completed" } }), 2);
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

  it("rejects an ambiguous cutover without activating explicit ownership", async () => {
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
    await assert.rejects(
      () => cutoverUnambiguousAssignments(ids.workspaceA, ids.clientA2, tx(), ids.user),
      (error: any) => error?.statusCode === 409,
    );

    // Client remains legacy and receives neither partial assignments nor a success audit.
    const updatedClient = await db.client.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId: ids.workspaceA, id: ids.clientA2 } },
    });
    assert.equal(updatedClient.accountAssignmentsConfiguredAt, null);
    assert.equal(await db.clientProviderAccountAssignment.count({ where: { workspaceId: ids.workspaceA, clientId: ids.clientA2 } }), 0);
    assert.equal(await db.auditEvent.count({ where: { workspaceId: ids.workspaceA, resourceId: ids.clientA2, action: "client_account.cutover_completed" } }), 0);
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

  it("deterministic cross-product isolation: (conn-A, acc-1) and (conn-B, acc-2) strictly reject cross-matches across warehouse, aggregates, exports, readiness, and reports", async () => {
    const connA = `conn-cp-a-${suffix}`;
    const connB = `conn-cp-b-${suffix}`;
    const clientCPA = `cl-cp-a-${suffix}`;
    const clientCPB = `cl-cp-b-${suffix}`;
    const acc1 = "1110001111";
    const acc2 = "2220002222";

    await db.client.createMany({
      data: [
        { id: clientCPA, workspaceId: ids.workspaceA, name: "Client CP-A", accountAssignmentsConfiguredAt: new Date() },
        { id: clientCPB, workspaceId: ids.workspaceA, name: "Client CP-B", accountAssignmentsConfiguredAt: new Date() },
      ],
    });

    await db.connection.createMany({
      data: [
        {
          id: connA,
          workspaceId: ids.workspaceA,
          name: "Connection CP-A",
          provider: "google_ads",
          type: "source",
          status: "connected",
          remoteAccountId: `mcc-cp-a-${suffix}`,
          credentials: JSON.stringify({ customerIds: [acc1, acc2] }),
        },
        {
          id: connB,
          workspaceId: ids.workspaceA,
          name: "Connection CP-B",
          provider: "google_ads",
          type: "source",
          status: "connected",
          remoteAccountId: `mcc-cp-b-${suffix}`,
          credentials: JSON.stringify({ customerIds: [acc1, acc2] }),
        },
      ],
    });

    // Assign (connA, google_ads, acc1) -> Client CP-A
    // Assign (connB, google_ads, acc2) -> Client CP-B
    await db.clientProviderAccountAssignment.createMany({
      data: [
        {
          workspaceId: ids.workspaceA,
          clientId: clientCPA,
          provider: "google_ads",
          accountId: acc1,
          connectionId: connA,
        },
        {
          workspaceId: ids.workspaceA,
          clientId: clientCPB,
          provider: "google_ads",
          accountId: acc2,
          connectionId: connB,
        },
      ],
    });

    // Seed metrics for ALL 4 combinations:
    // (connA, acc1) -> 100
    // (connA, acc2) -> 200 (should be rejected by Client CP-A and Client CP-B)
    // (connB, acc1) -> 300 (should be rejected by Client CP-A and Client CP-B)
    // (connB, acc2) -> 400
    const testDate = new Date("2026-09-01T12:00:00Z");
    await db.campaignMetric.createMany({
      data: [
        {
          workspaceId: ids.workspaceA,
          connectionId: connA,
          platform: "google_ads",
          accountId: acc1,
          campaignId: "c-a1",
          campaignName: "Camp A1",
          date: testDate,
          spend: 100,
          impressions: 1000,
          clicks: 50,
          currency: "USD",
        },
        {
          workspaceId: ids.workspaceA,
          connectionId: connA,
          platform: "google_ads",
          accountId: acc2,
          campaignId: "c-a2",
          campaignName: "Camp A2",
          date: testDate,
          spend: 200,
          impressions: 2000,
          clicks: 100,
          currency: "USD",
        },
        {
          workspaceId: ids.workspaceA,
          connectionId: connB,
          platform: "google_ads",
          accountId: acc1,
          campaignId: "c-b1",
          campaignName: "Camp B1",
          date: testDate,
          spend: 300,
          impressions: 3000,
          clicks: 150,
          currency: "USD",
        },
        {
          workspaceId: ids.workspaceA,
          connectionId: connB,
          platform: "google_ads",
          accountId: acc2,
          campaignId: "c-b2",
          campaignName: "Camp B2",
          date: testDate,
          spend: 400,
          impressions: 4000,
          clicks: 200,
          currency: "USD",
        },
      ],
    });

    // 1. Warehouse query isolation
    const qA = await queryWarehouse({ workspaceId: ids.workspaceA, clientId: clientCPA }, tx());
    assert.equal(qA.rows.length, 1);
    assert.equal(qA.rows[0].connectionId, connA);
    assert.equal(qA.rows[0].accountId, acc1);
    assert.equal(qA.rows[0].spend, 100);

    const qB = await queryWarehouse({ workspaceId: ids.workspaceA, clientId: clientCPB }, tx());
    assert.equal(qB.rows.length, 1);
    assert.equal(qB.rows[0].connectionId, connB);
    assert.equal(qB.rows[0].accountId, acc2);
    assert.equal(qB.rows[0].spend, 400);

    // 2. Aggregate isolation
    const aggA = await queryMetricsAggregate({
      workspaceId: ids.workspaceA,
      clientId: clientCPA,
      startDateStr: "2026-09-01",
      endDateStr: "2026-09-02",
      metrics: ["spend"],
    });
    assert.equal(aggA.rows[0]["metric:spend"], 100);

    const aggB = await queryMetricsAggregate({
      workspaceId: ids.workspaceA,
      clientId: clientCPB,
      startDateStr: "2026-09-01",
      endDateStr: "2026-09-02",
      metrics: ["spend"],
    });
    assert.equal(aggB.rows[0]["metric:spend"], 400);

    // 3. Export rows isolation
    const exportReqA = new Request(
      `http://localhost/api/export/rows?clientId=${clientCPA}`,
      { headers: { Authorization: `Bearer ${testApiKeySecret}` } }
    );
    const exportResA = await getExportRows(exportReqA);
    assert.equal(exportResA.status, 200);
    const exportDataA = await exportResA.json();
    assert.equal(exportDataA.success, true);
    // Header + 1 row
    assert.equal(exportDataA.rows.length, 2);
    assert.equal(exportDataA.rows[1][1], "Camp A1");
    assert.equal(exportDataA.rows[1][4], 100);

    const exportReqB = new Request(
      `http://localhost/api/export/rows?clientId=${clientCPB}`,
      { headers: { Authorization: `Bearer ${testApiKeySecret}` } }
    );
    const exportResB = await getExportRows(exportReqB);
    assert.equal(exportResB.status, 200);
    const exportDataB = await exportResB.json();
    assert.equal(exportDataB.rows.length, 2);
    assert.equal(exportDataB.rows[1][1], "Camp B2");
    assert.equal(exportDataB.rows[1][4], 400);

    // 4. Report delivery dataset isolation
    const window = { start: "2026-09-01", end: "2026-09-02" };
    const dsA = await reportingDataset(tx(), ids.workspaceA, clientCPA, window, ["google_ads"]);
    assert.equal(dsA.rowCount, 1);

    const dsB = await reportingDataset(tx(), ids.workspaceA, clientCPB, window, ["google_ads"]);
    assert.equal(dsB.rowCount, 1);

    // 5. Readiness isolation
    const readinessA = await loadReportReadiness(ids.workspaceA, window, { clientId: clientCPA, tx: tx() });
    assert.equal(readinessA.evaluations[0].clientId, clientCPA);
    assert.equal(readinessA.evaluations[0].providers[0].connectionId, connA);

    const readinessB = await loadReportReadiness(ids.workspaceA, window, { clientId: clientCPB, tx: tx() });
    assert.equal(readinessB.evaluations[0].clientId, clientCPB);
    assert.equal(readinessB.evaluations[0].providers[0].connectionId, connB);
  });

  it("authority regression: legacy client ignores candidate rows, cutover switches to explicit mode, and final unassignment produces explicit empty scope", async () => {
    const connLeg = `conn-leg-${suffix}`;
    const clientLeg = `cl-leg-${suffix}`;
    const accLeg1 = "3330003333";
    const accLeg2 = "4440004444";

    // Legacy client with accountAssignmentsConfiguredAt = null
    await db.client.create({
      data: {
        id: clientLeg,
        workspaceId: ids.workspaceA,
        name: "Client Legacy",
        accountAssignmentsConfiguredAt: null,
      },
    });

    await db.connection.create({
      data: {
        id: connLeg,
        workspaceId: ids.workspaceA,
        name: "Connection Legacy",
        provider: "google_ads",
        type: "source",
        status: "connected",
        clientId: clientLeg,
        remoteAccountId: `mcc-leg-${suffix}`,
        credentials: JSON.stringify({ customerIds: [accLeg1, accLeg2] }),
      },
    });

    const testDate = new Date("2026-09-02T12:00:00Z");
    await db.campaignMetric.createMany({
      data: [
        {
          workspaceId: ids.workspaceA,
          connectionId: connLeg,
          platform: "google_ads",
          accountId: accLeg1,
          campaignId: "c-leg-1",
          campaignName: "Camp Leg 1",
          date: testDate,
          spend: 150,
          currency: "USD",
        },
        {
          workspaceId: ids.workspaceA,
          connectionId: connLeg,
          platform: "google_ads",
          accountId: accLeg2,
          campaignId: "c-leg-2",
          campaignName: "Camp Leg 2",
          date: testDate,
          spend: 250,
          currency: "USD",
        },
      ],
    });

    // Insert a candidate / rogue row in ClientProviderAccountAssignment (only accLeg1)
    await db.clientProviderAccountAssignment.create({
      data: {
        workspaceId: ids.workspaceA,
        clientId: clientLeg,
        provider: "google_ads",
        accountId: accLeg1,
        connectionId: connLeg,
      },
    });

    // 1. Before cutover (legacy mode): queries MUST ignore the assignment row and return BOTH accounts via Connection.clientId
    const legQ = await queryWarehouse({ workspaceId: ids.workspaceA, clientId: clientLeg }, tx());
    assert.equal(legQ.rows.length, 2, "Legacy client must query Connection.clientId, ignoring candidate assignment");

    const legDataset = await reportingDataset(tx(), ids.workspaceA, clientLeg, { start: "2026-09-02", end: "2026-09-03" }, ["google_ads"]);
    assert.equal(legDataset.rowCount, 2, "Legacy reportingDataset must return all connection rows");

    // 2. Refresh / GET calls cannot change authority
    setAuthSessionOverride(async () => ({
      user: { id: ids.viewer, email: `${ids.viewer}@example.com` },
      expires: "2099-01-01T00:00:00.000Z",
    }));
    try {
      const getRes = await getClients(new Request(`http://localhost/api/clients?workspaceId=${ids.workspaceA}`));
      assert.equal(getRes.status, 200);
    } finally {
      setAuthSessionOverride(null);
    }
    const clientCheck = await db.client.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId: ids.workspaceA, id: clientLeg } },
    });
    assert.equal(clientCheck.accountAssignmentsConfiguredAt, null, "GET cannot mutate cutover marker");

    // 3. Perform explicit cutover
    const cutover = await cutoverUnambiguousAssignments(ids.workspaceA, clientLeg, tx(), ids.user);
    assert.ok(cutover.configuredAt);
    const configuredClient = await db.client.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId: ids.workspaceA, id: clientLeg } },
    });
    assert.ok(configuredClient.accountAssignmentsConfiguredAt !== null);

    // 4. Now in explicit mode: unassign all accounts
    await unassignClientProviderAccount(
      { workspaceId: ids.workspaceA, provider: "google_ads", accountId: accLeg1, actorUserId: ids.user },
      tx()
    );
    await unassignClientProviderAccount(
      { workspaceId: ids.workspaceA, provider: "google_ads", accountId: accLeg2, actorUserId: ids.user },
      tx()
    );

    const remainingAssignments = await db.clientProviderAccountAssignment.count({
      where: { workspaceId: ids.workspaceA, clientId: clientLeg },
    });
    assert.equal(remainingAssignments, 0);

    // 5. Explicit client with 0 assignments MUST return 0 rows (NEVER restore legacy data!)
    const emptyQ = await queryWarehouse({ workspaceId: ids.workspaceA, clientId: clientLeg }, tx());
    assert.equal(emptyQ.rows.length, 0, "Explicit client with zero assignments must return zero warehouse rows");

    const emptyDataset = await reportingDataset(tx(), ids.workspaceA, clientLeg, { start: "2026-09-02", end: "2026-09-03" }, ["google_ads"]);
    assert.equal(emptyDataset.rowCount, 0, "Explicit client with zero assignments must return zero dataset rows");

    const emptyExport = await getExportRows(
      new Request(`http://localhost/api/export/rows?clientId=${clientLeg}`, {
        headers: { Authorization: `Bearer ${testApiKeySecret}` },
      })
    );
    const emptyExportData = await emptyExport.json();
    assert.equal(emptyExportData.rows.length, 0, "Explicit client with zero assignments must export zero rows");
  });

  it("shared MCC export: two clients sharing one MCC connection export only their own assigned accounts; rival client rejected with 404", async () => {
    const connMCC = `conn-mcc-shared-${suffix}`;
    const client1 = `cl-mcc-1-${suffix}`;
    const client2 = `cl-mcc-2-${suffix}`;
    const accM1 = "5550005555";
    const accM2 = "6660006666";

    await db.client.createMany({
      data: [
        { id: client1, workspaceId: ids.workspaceA, name: "Client MCC 1", accountAssignmentsConfiguredAt: new Date() },
        { id: client2, workspaceId: ids.workspaceA, name: "Client MCC 2", accountAssignmentsConfiguredAt: new Date() },
      ],
    });

    await db.connection.create({
      data: {
        id: connMCC,
        workspaceId: ids.workspaceA,
        name: "Shared Agency MCC",
        provider: "google_ads",
        type: "source",
        status: "connected",
        remoteAccountId: `mcc-shared-${suffix}`,
        credentials: JSON.stringify({ customerIds: [accM1, accM2] }),
      },
    });

    await db.clientProviderAccountAssignment.createMany({
      data: [
        { workspaceId: ids.workspaceA, clientId: client1, provider: "google_ads", accountId: accM1, connectionId: connMCC },
        { workspaceId: ids.workspaceA, clientId: client2, provider: "google_ads", accountId: accM2, connectionId: connMCC },
      ],
    });

    const testDate = new Date("2026-09-03T12:00:00Z");
    await db.campaignMetric.createMany({
      data: [
        {
          workspaceId: ids.workspaceA,
          connectionId: connMCC,
          platform: "google_ads",
          accountId: accM1,
          campaignId: "c-m1",
          campaignName: "Client 1 Campaign",
          date: testDate,
          spend: 555,
          currency: "USD",
        },
        {
          workspaceId: ids.workspaceA,
          connectionId: connMCC,
          platform: "google_ads",
          accountId: accM2,
          campaignId: "c-m2",
          campaignName: "Client 2 Campaign",
          date: testDate,
          spend: 666,
          currency: "USD",
        },
      ],
    });

    // Export for Client 1
    const res1 = await getExportRows(
      new Request(`http://localhost/api/export/rows?clientId=${client1}&sourceId=${connMCC}`, {
        headers: { Authorization: `Bearer ${testApiKeySecret}` },
      })
    );
    assert.equal(res1.status, 200);
    const data1 = await res1.json();
    assert.equal(data1.rows.length, 2); // Header + 1 row
    assert.equal(data1.rows[1][1], "Client 1 Campaign");
    assert.equal(data1.rows[1][4], 555);

    // Export for Client 2
    const res2 = await getExportRows(
      new Request(`http://localhost/api/export/rows?clientId=${client2}&sourceId=${connMCC}`, {
        headers: { Authorization: `Bearer ${testApiKeySecret}` },
      })
    );
    assert.equal(res2.status, 200);
    const data2 = await res2.json();
    assert.equal(data2.rows.length, 2); // Header + 1 row
    assert.equal(data2.rows[1][1], "Client 2 Campaign");
    assert.equal(data2.rows[1][4], 666);

    // Cross-workspace rival client ID rejection
    const rivalRes = await getExportRows(
      new Request(`http://localhost/api/export/rows?clientId=${ids.clientB}&sourceId=${connMCC}`, {
        headers: { Authorization: `Bearer ${testApiKeySecret}` },
      })
    );
    assert.equal(rivalRes.status, 404, "Rival workspace client ID must return 404");

    // Non-existent client ID rejection
    const nonExistentRes = await getExportRows(
      new Request(`http://localhost/api/export/rows?clientId=non-existent-client-id&sourceId=${connMCC}`, {
        headers: { Authorization: `Bearer ${testApiKeySecret}` },
      })
    );
    assert.equal(nonExistentRes.status, 404, "Non-existent client ID must return 404");
  });
});
