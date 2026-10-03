import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertAllowedTestDatabase } from "./pg-test-discipline";
import { setAuthSessionOverride } from "./auth-session";
import { queryWarehouse, type ScopedTransaction } from "./warehouse-query";
import { GET as getWarehouseQuery } from "@/app/api/data-explorer/warehouse/query/route";
import { POST as postSheetsQuery } from "@/app/api/v1/sheets/query/route";

/**
 * PostgreSQL integration: caller-supplied connection filters must narrow an
 * established client scope, never replace it.
 *
 * Regression for a scope-composition defect where `where.connectionId` from
 * the caller overwrote the legacy client's authoritative `in: [...]` set, so
 * `clientId=<legacy A> + connectionId=<B's connection>` returned B's rows.
 */
describe("PostgreSQL integration: warehouse connection filters intersect client scope", () => {
  let db: PrismaClient;
  const suffix = `wcs-${Date.now()}-${process.pid}`;
  const metricDate = "2026-09-04";
  const ids = {
    owner: `user-wcs-${suffix}`,
    workspaceA: `ws-wcs-a-${suffix}`,
    workspaceB: `ws-wcs-b-${suffix}`,
    legacyA: `cl-wcs-legacy-a-${suffix}`,
    legacyB: `cl-wcs-legacy-b-${suffix}`,
    legacyEmpty: `cl-wcs-legacy-empty-${suffix}`,
    explicitA: `cl-wcs-explicit-a-${suffix}`,
    explicitSib: `cl-wcs-explicit-sib-${suffix}`,
    explicitEmpty: `cl-wcs-explicit-empty-${suffix}`,
    connLegacyA: `conn-wcs-legacy-a-${suffix}`,
    connLegacyB: `conn-wcs-legacy-b-${suffix}`,
    connExpA: `conn-wcs-exp-a-${suffix}`,
    connShared: `conn-wcs-shared-${suffix}`,
    connFree: `conn-wcs-free-${suffix}`,
    connRival: `conn-wcs-rival-${suffix}`,
    rivalClient: `cl-wcs-rival-${suffix}`,
  };

  const originalFetch = globalThis.fetch;
  const originalAudiences = process.env.GOOGLE_ID_TOKEN_AUDIENCES;

  async function json(res: Response) {
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  }

  function metric(connectionId: string, workspaceId: string, accountId: string, campaignName: string, spend: number) {
    return {
      workspaceId,
      connectionId,
      platform: "google_ads",
      accountId,
      accountName: campaignName,
      campaignId: `camp-${accountId}`,
      campaignName,
      date: new Date(`${metricDate}T00:00:00.000Z`),
      spend,
      impressions: 100,
      clicks: 10,
      currency: "USD",
    };
  }

  before(async () => {
    const url = process.env.DATABASE_URL;
    assertAllowedTestDatabase(url);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();

    // Fake Google tokeninfo: no live provider requests allowed.
    globalThis.fetch = (async (input: unknown) => {
      assert.ok(
        String(input).startsWith("https://oauth2.googleapis.com/tokeninfo?"),
        "No live provider requests allowed",
      );
      return Response.json({
        email: `${ids.owner}@example.test`,
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iss: "https://accounts.google.com",
        aud: "ci-wcs-client.apps.googleusercontent.com",
      });
    }) as typeof fetch;
    process.env.GOOGLE_ID_TOKEN_AUDIENCES = "ci-wcs-client.apps.googleusercontent.com";

    await db.user.create({
      data: { id: ids.owner, email: `${ids.owner}@example.test`, name: "Scope Owner" },
    });
    await db.workspace.createMany({
      data: [
        { id: ids.workspaceA, ownerId: ids.owner, name: "Scope A", slug: `wcs-a-${suffix}`, plan: "professional" },
        { id: ids.workspaceB, ownerId: ids.owner, name: "Scope B", slug: `wcs-b-${suffix}`, plan: "professional" },
      ],
    });
    await db.workspaceMember.createMany({
      data: [
        { workspaceId: ids.workspaceA, userId: ids.owner, role: "owner" },
        { workspaceId: ids.workspaceB, userId: ids.owner, role: "owner" },
      ],
    });
    await db.client.createMany({
      data: [
        { id: ids.legacyA, workspaceId: ids.workspaceA, name: "Legacy A" },
        { id: ids.legacyB, workspaceId: ids.workspaceA, name: "Legacy B" },
        { id: ids.legacyEmpty, workspaceId: ids.workspaceA, name: "Legacy Empty" },
        { id: ids.explicitA, workspaceId: ids.workspaceA, name: "Explicit A", accountAssignmentsConfiguredAt: new Date() },
        { id: ids.explicitSib, workspaceId: ids.workspaceA, name: "Explicit Sibling", accountAssignmentsConfiguredAt: new Date() },
        { id: ids.explicitEmpty, workspaceId: ids.workspaceA, name: "Explicit Empty", accountAssignmentsConfiguredAt: new Date() },
        { id: ids.rivalClient, workspaceId: ids.workspaceB, name: "Rival" },
      ],
    });
    await db.connection.createMany({
      data: [
        { id: ids.connLegacyA, workspaceId: ids.workspaceA, clientId: ids.legacyA, name: "Legacy A src", provider: "google_ads", type: "source", status: "connected", remoteAccountId: `leg-a-${suffix}`, credentials: "{}" },
        { id: ids.connLegacyB, workspaceId: ids.workspaceA, clientId: ids.legacyB, name: "Legacy B src", provider: "google_ads", type: "source", status: "connected", remoteAccountId: `leg-b-${suffix}`, credentials: "{}" },
        { id: ids.connExpA, workspaceId: ids.workspaceA, name: "Explicit A src", provider: "google_ads", type: "source", status: "connected", remoteAccountId: `exp-a-${suffix}`, credentials: "{}" },
        { id: ids.connShared, workspaceId: ids.workspaceA, name: "Shared MCC", provider: "google_ads", type: "source", status: "connected", remoteAccountId: `shared-${suffix}`, credentials: "{}" },
        { id: ids.connFree, workspaceId: ids.workspaceA, name: "Free src", provider: "google_ads", type: "source", status: "connected", remoteAccountId: `free-${suffix}`, credentials: "{}" },
        { id: ids.connRival, workspaceId: ids.workspaceB, clientId: ids.rivalClient, name: "Rival src", provider: "google_ads", type: "source", status: "connected", remoteAccountId: `rival-${suffix}`, credentials: "{}" },
      ],
    });
    await db.clientProviderAccountAssignment.createMany({
      data: [
        { workspaceId: ids.workspaceA, clientId: ids.explicitA, provider: "google_ads", accountId: "WCS111", connectionId: ids.connExpA },
        { workspaceId: ids.workspaceA, clientId: ids.explicitA, provider: "google_ads", accountId: "WCS222", connectionId: ids.connShared },
        { workspaceId: ids.workspaceA, clientId: ids.explicitSib, provider: "google_ads", accountId: "WCS333", connectionId: ids.connShared },
      ],
    });
    await db.campaignMetric.createMany({
      data: [
        metric(ids.connLegacyA, ids.workspaceA, "WCSL1", "Legacy A Campaign", 10),
        metric(ids.connLegacyB, ids.workspaceA, "WCSL2", "Legacy B Campaign", 20),
        metric(ids.connExpA, ids.workspaceA, "WCS111", "Explicit A Direct", 30),
        metric(ids.connShared, ids.workspaceA, "WCS222", "Explicit A Shared", 40),
        metric(ids.connShared, ids.workspaceA, "WCS333", "Sibling Shared Campaign", 50),
        metric(ids.connFree, ids.workspaceA, "WCSFREE", "Free Row", 60),
        metric(ids.connRival, ids.workspaceB, "WCSRIV", "Rival Campaign", 70),
      ],
    });
    setAuthSessionOverride(async () => ({
      user: { id: ids.owner, email: `${ids.owner}@example.test` },
      expires: "2099-01-01T00:00:00.000Z",
    }));
  });

  after(async () => {
    setAuthSessionOverride(null);
    globalThis.fetch = originalFetch;
    if (originalAudiences === undefined) delete process.env.GOOGLE_ID_TOKEN_AUDIENCES;
    else process.env.GOOGLE_ID_TOKEN_AUDIENCES = originalAudiences;
    try {
      await db.campaignMetric.deleteMany({ where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } } });
      await db.clientProviderAccountAssignment.deleteMany({ where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } } });
      await db.connection.deleteMany({ where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } } });
      await db.client.deleteMany({ where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } } });
      await db.workspaceMember.deleteMany({ where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } } });
      await db.workspace.deleteMany({ where: { id: { in: [ids.workspaceA, ids.workspaceB] } } });
      await db.user.delete({ where: { id: ids.owner } });
    } finally {
      await db.$disconnect();
    }
  });

  const tx = () => db as unknown as ScopedTransaction;

  function names(rows: Array<{ campaignName: string }>) {
    return rows.map((row) => row.campaignName).sort();
  }

  it("legacy client with its own connection returns only its rows with consistent metadata", async () => {
    const result = await queryWarehouse({
      workspaceId: ids.workspaceA,
      clientId: ids.legacyA,
      connectionId: ids.connLegacyA,
      includeTotalCount: true,
    }, tx());
    assert.deepEqual(names(result.rows), ["Legacy A Campaign"]);
    assert.equal(result.totalCount, 1);
    assert.deepEqual(result.platforms, ["google_ads"]);
    assert.equal(result.dateRange.earliest?.toISOString().slice(0, 10), metricDate);
    assert.equal(result.dateRange.latest?.toISOString().slice(0, 10), metricDate);
    assert.equal(result.freshness.jobAttribution, "available");
  });

  it("legacy client with a sibling same-workspace connection returns no rows and empty metadata", async () => {
    const result = await queryWarehouse({
      workspaceId: ids.workspaceA,
      clientId: ids.legacyA,
      connectionId: ids.connLegacyB,
      includeTotalCount: true,
    }, tx());
    assert.deepEqual(result.rows, []);
    assert.equal(result.totalCount, 0);
    assert.deepEqual(result.platforms, []);
    assert.equal(result.dateRange.earliest, null);
    assert.equal(result.dateRange.latest, null);
    assert.equal(result.freshness.jobAttribution, "available");
    assert.equal(result.freshness.latestJobId, null);
  });

  it("legacy client with a rival-workspace connection reveals nothing", async () => {
    const result = await queryWarehouse({
      workspaceId: ids.workspaceA,
      clientId: ids.legacyA,
      connectionId: ids.connRival,
      includeTotalCount: true,
    }, tx());
    assert.deepEqual(result.rows, []);
    assert.equal(result.totalCount, 0);
    assert.deepEqual(result.platforms, []);
  });

  it("legacy-empty client stays empty for any concrete connection", async () => {
    for (const connectionId of [ids.connLegacyA, ids.connLegacyB, ids.connFree]) {
      const result = await queryWarehouse({
        workspaceId: ids.workspaceA,
        clientId: ids.legacyEmpty,
        connectionId,
        includeTotalCount: true,
      }, tx());
      assert.deepEqual(result.rows, [], connectionId);
      assert.equal(result.totalCount, 0, connectionId);
      assert.deepEqual(result.platforms, [], connectionId);
    }
    const bare = await queryWarehouse({
      workspaceId: ids.workspaceA,
      clientId: ids.legacyEmpty,
      includeTotalCount: true,
    }, tx());
    assert.deepEqual(bare.rows, []);
    assert.equal(bare.totalCount, 0);
  });

  it("explicit client keeps exact tuples and narrows on connection or sibling account", async () => {
    const all = await queryWarehouse({
      workspaceId: ids.workspaceA,
      clientId: ids.explicitA,
      includeTotalCount: true,
    }, tx());
    assert.deepEqual(names(all.rows), ["Explicit A Direct", "Explicit A Shared"]);
    assert.equal(all.freshness.jobAttribution, "unavailable");

    const sharedOnly = await queryWarehouse({
      workspaceId: ids.workspaceA,
      clientId: ids.explicitA,
      connectionId: ids.connShared,
      includeTotalCount: true,
    }, tx());
    assert.deepEqual(names(sharedOnly.rows), ["Explicit A Shared"]);

    const foreignConn = await queryWarehouse({
      workspaceId: ids.workspaceA,
      clientId: ids.explicitA,
      connectionId: ids.connLegacyB,
      includeTotalCount: true,
    }, tx());
    assert.deepEqual(foreignConn.rows, []);

    const siblingAccount = await queryWarehouse({
      workspaceId: ids.workspaceA,
      clientId: ids.explicitA,
      accountIds: ["WCS333"],
      includeTotalCount: true,
    }, tx());
    assert.deepEqual(siblingAccount.rows, []);
    assert.equal(siblingAccount.totalCount, 0);

    const empty = await queryWarehouse({
      workspaceId: ids.workspaceA,
      clientId: ids.explicitEmpty,
      connectionId: ids.connExpA,
      includeTotalCount: true,
    }, tx());
    assert.deepEqual(empty.rows, []);
    assert.equal(empty.freshness.status, "unavailable");
  });

  it("missing scope stays workspace-wide and unassigned stays narrowed", async () => {
    const wide = await queryWarehouse({
      workspaceId: ids.workspaceA,
      includeTotalCount: true,
    }, tx());
    assert.deepEqual(names(wide.rows), [
      "Explicit A Direct",
      "Explicit A Shared",
      "Free Row",
      "Legacy A Campaign",
      "Legacy B Campaign",
      "Sibling Shared Campaign",
    ]);
    assert.equal(wide.freshness.jobAttribution, "available");

    const narrowed = await queryWarehouse({
      workspaceId: ids.workspaceA,
      clientId: "unassigned",
      connectionId: ids.connFree,
      includeTotalCount: true,
    }, tx());
    assert.deepEqual(names(narrowed.rows), ["Free Row"]);
    assert.equal(narrowed.freshness.jobAttribution, "unavailable");

    const unassignedForeign = await queryWarehouse({
      workspaceId: ids.workspaceA,
      clientId: "unassigned",
      connectionId: ids.connLegacyA,
      includeTotalCount: true,
    }, tx());
    assert.deepEqual(unassignedForeign.rows, []);
  });

  it("warehouse query route enforces the same intersection for clientId plus connectionId", async () => {
    const base = `workspaceId=${ids.workspaceA}&startDate=${metricDate}&endDate=${metricDate}&startRow=0&endRow=50`;
    const get = async (params: string) => json(await getWarehouseQuery(new Request(`http://localhost/api/data-explorer/warehouse/query?${base}&${params}`)));

    const own = await get(`clientId=${ids.legacyA}&connectionId=${ids.connLegacyA}`);
    assert.equal(own.status, 200);
    assert.deepEqual((own.body.rows as Array<{ campaignName: string }>).map((row) => row.campaignName), ["Legacy A Campaign"]);
    assert.equal(own.body.total, 1);

    const foreign = await get(`clientId=${ids.legacyA}&connectionId=${ids.connLegacyB}`);
    assert.equal(foreign.status, 200);
    assert.deepEqual(foreign.body.rows, []);
    assert.equal(foreign.body.total, 0);
    assert.equal(foreign.body.asOf, null);

    const rival = await get(`clientId=${ids.legacyA}&connectionId=${ids.connRival}`);
    assert.equal(rival.status, 404);
    const missing = await get(`clientId=${ids.legacyA}&connectionId=conn-does-not-exist-${suffix}`);
    assert.equal(missing.status, 404);
    assert.deepEqual(rival.body, missing.body);

    const empty = await get(`clientId=${ids.legacyEmpty}&connectionId=${ids.connLegacyA}`);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.rows, []);
    assert.equal(empty.body.total, 0);
  });

  it("sheets delivery under a legacy client returns own rows and nothing for a foreign connection", async () => {
    const window = { start_date: "2026-09-01", end_date: metricDate };
    const pull = async (extra: object) => json(await postSheetsQuery(new Request("http://localhost/api/v1/sheets/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        googleToken: "synthetic-token",
        workspaceId: ids.workspaceA,
        clientId: ids.legacyA,
        ...window,
        ...extra,
      }),
    })));
    const campaignNames = (body: Record<string, unknown>) =>
      ((body.rows as Array<Array<string>>) ?? []).map((row) => row[5]).sort();

    const own = await pull({ connectionId: ids.connLegacyA });
    assert.equal(own.status, 200);
    assert.deepEqual(campaignNames(own.body), ["Legacy A Campaign"]);

    const foreign = await pull({ connectionId: ids.connLegacyB });
    assert.equal(foreign.status, 200);
    assert.deepEqual(foreign.body.rows, []);
  });
});
