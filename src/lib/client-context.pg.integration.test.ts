import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { hashApiKey } from "./api-key-security";
import { assertAllowedTestDatabase } from "./pg-test-discipline";
import { setAuthSessionOverride } from "./auth-session";
import { GET as getMetrics } from "@/app/api/metrics/query/route";
import { GET as getPerformance } from "@/app/api/reports/performance/route";
import { GET as getExportRows } from "@/app/api/export/rows/route";
import { GET as getWarehouseQuery } from "@/app/api/data-explorer/warehouse/query/route";
import { GET as getPlatforms } from "@/app/api/metrics/platforms/route";
import { GET as getAccounts } from "@/app/api/metrics/accounts/route";
import {
  assertQueryableClientContext,
  resolveClientContext,
  warehouseClientId,
} from "./client-context-server";

describe("PostgreSQL integration: client context isolation", () => {
  let db: PrismaClient;
  const suffix = `ccx-${Date.now()}-${process.pid}`;
  const testApiKeySecret = `mc_live_test_${suffix}`;
  const metricDate = "2026-09-04";

  const ids = {
    owner: `user-owner-${suffix}`,
    member: `user-member-${suffix}`,
    viewer: `user-viewer-${suffix}`,
    workspaceA: `ws-a-${suffix}`,
    workspaceB: `ws-b-${suffix}`,
    clientA: `cl-a-${suffix}`,
    clientAEmpty: `cl-a-empty-${suffix}`,
    clientB: `cl-b-${suffix}`,
    connA: `conn-a-${suffix}`,
    connA2: `conn-a2-${suffix}`,
    connB: `conn-b-${suffix}`,
  };

  async function asUser(userId: string) {
    setAuthSessionOverride(async () => ({
      user: { id: userId, email: `${userId}@example.com` },
      expires: "2099-01-01T00:00:00.000Z",
    }));
  }

  async function json(res: Response) {
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  }

  before(async () => {
    const url = process.env.DATABASE_URL;
    assertAllowedTestDatabase(url);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    await db.$queryRaw`SELECT 1`;

    await db.user.createMany({
      data: [
        { id: ids.owner, email: `${ids.owner}@example.com`, name: "Owner" },
        { id: ids.member, email: `${ids.member}@example.com`, name: "Member" },
        { id: ids.viewer, email: `${ids.viewer}@example.com`, name: "Viewer" },
      ],
    });
    await db.workspace.createMany({
      data: [
        { id: ids.workspaceA, ownerId: ids.owner, name: "Workspace A", slug: `ws-a-${suffix}`, plan: "professional" },
        { id: ids.workspaceB, ownerId: ids.owner, name: "Workspace B", slug: `ws-b-${suffix}`, plan: "professional" },
      ],
    });
    await db.workspaceMember.createMany({
      data: [
        { workspaceId: ids.workspaceA, userId: ids.owner, role: "owner" },
        { workspaceId: ids.workspaceA, userId: ids.member, role: "member" },
        { workspaceId: ids.workspaceA, userId: ids.viewer, role: "viewer" },
        { workspaceId: ids.workspaceB, userId: ids.owner, role: "owner" },
      ],
    });
    await db.apiKey.create({
      data: {
        workspaceId: ids.workspaceA,
        name: "Context test key",
        keyHash: hashApiKey(testApiKeySecret),
        keyPrefix: "mc_live_",
        keyLastFour: suffix.slice(-4),
      },
    });
    await db.client.createMany({
      data: [
        { id: ids.clientA, workspaceId: ids.workspaceA, name: "Aurora Retailer", accountAssignmentsConfiguredAt: new Date() },
        { id: ids.clientAEmpty, workspaceId: ids.workspaceA, name: "Empty Client", accountAssignmentsConfiguredAt: new Date() },
        { id: ids.clientB, workspaceId: ids.workspaceB, name: "Rival Client", accountAssignmentsConfiguredAt: new Date() },
      ],
    });
    await db.connection.createMany({
      data: [
        {
          id: ids.connA,
          workspaceId: ids.workspaceA,
          name: "Google A",
          provider: "google_ads",
          type: "source",
          status: "connected",
          remoteAccountId: `mcc-a-${suffix}`,
          credentials: JSON.stringify({ customerIds: ["1110001111"] }),
        },
        {
          id: ids.connA2,
          workspaceId: ids.workspaceA,
          name: "Meta A",
          provider: "meta_ads",
          type: "source",
          status: "connected",
          remoteAccountId: `meta-a-${suffix}`,
          credentials: JSON.stringify({ adAccountIds: ["act_222"] }),
        },
        {
          id: ids.connB,
          workspaceId: ids.workspaceB,
          name: "Google B",
          provider: "google_ads",
          type: "source",
          status: "connected",
          remoteAccountId: `mcc-b-${suffix}`,
          credentials: JSON.stringify({ customerIds: ["9990009999"] }),
        },
      ],
    });
    await db.clientProviderAccountAssignment.createMany({
      data: [
        { workspaceId: ids.workspaceA, clientId: ids.clientA, provider: "google_ads", accountId: "1110001111", connectionId: ids.connA },
        { workspaceId: ids.workspaceB, clientId: ids.clientB, provider: "google_ads", accountId: "9990009999", connectionId: ids.connB },
      ],
    });
    await db.campaignMetric.createMany({
      data: [
        {
          workspaceId: ids.workspaceA,
          connectionId: ids.connA,
          platform: "google_ads",
          accountId: "1110001111",
          accountName: "Aurora Google",
          campaignId: "camp-a",
          campaignName: "Aurora Campaign",
          date: new Date(`${metricDate}T00:00:00.000Z`),
          spend: 111,
          impressions: 1100,
          clicks: 11,
          currency: "USD",
        },
        {
          workspaceId: ids.workspaceA,
          connectionId: ids.connA2,
          platform: "meta_ads",
          accountId: "act_222",
          accountName: "Unassigned Meta",
          campaignId: "camp-meta",
          campaignName: "Workspace Meta Campaign",
          date: new Date(`${metricDate}T00:00:00.000Z`),
          spend: 222,
          impressions: 2200,
          clicks: 22,
          currency: "USD",
        },
        {
          workspaceId: ids.workspaceB,
          connectionId: ids.connB,
          platform: "google_ads",
          accountId: "9990009999",
          accountName: "Rival Google",
          campaignId: "camp-b",
          campaignName: "Rival Campaign",
          date: new Date(`${metricDate}T00:00:00.000Z`),
          spend: 999,
          impressions: 9900,
          clicks: 99,
          currency: "USD",
        },
      ],
    });
  });

  after(async () => {
    setAuthSessionOverride(null);
    try {
      await db.campaignMetric.deleteMany({ where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } } });
      await db.clientProviderAccountAssignment.deleteMany({ where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } } });
      await db.connection.deleteMany({ where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } } });
      await db.client.deleteMany({ where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } } });
      await db.apiKey.deleteMany({ where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } } });
      await db.workspaceMember.deleteMany({ where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } } });
      await db.workspace.deleteMany({ where: { id: { in: [ids.workspaceA, ids.workspaceB] } } });
      await db.user.deleteMany({ where: { id: { in: [ids.owner, ids.member, ids.viewer] } } });
    } finally {
      await db.$disconnect();
    }
  });

  it("resolves a current-workspace client and rejects rival/missing/malformed ids without leaking existence", async () => {
    const valid = await resolveClientContext({
      workspaceId: ids.workspaceA,
      requestedClientId: ids.clientA,
      surface: "warehouse",
    }, db as never);
    assert.equal(valid.status, "resolved");
    assert.equal(warehouseClientId(valid), ids.clientA);

    const rival = await resolveClientContext({
      workspaceId: ids.workspaceA,
      requestedClientId: ids.clientB,
      surface: "warehouse",
    }, db as never);
    const missing = await resolveClientContext({
      workspaceId: ids.workspaceA,
      requestedClientId: "cl-does-not-exist",
      surface: "warehouse",
    }, db as never);
    assert.equal(rival.status, "not_found");
    assert.equal(missing.status, "not_found");
    const rivalErr = (() => {
      try { assertQueryableClientContext(rival); } catch (error) { return error as { statusCode: number; code: string; message: string }; }
    })();
    const missingErr = (() => {
      try { assertQueryableClientContext(missing); } catch (error) { return error as { statusCode: number; code: string; message: string }; }
    })();
    assert.deepEqual(
      { status: rivalErr?.statusCode, code: rivalErr?.code, message: rivalErr?.message },
      { status: missingErr?.statusCode, code: missingErr?.code, message: missingErr?.message },
    );
  });

  it("metrics, reports, warehouse, and export isolate two clients and never fall back from an invalid id", async () => {
    await asUser(ids.owner);
    try {
      const validMetrics = await json(await getMetrics(new Request(
        `http://localhost/api/metrics/query?workspaceId=${ids.workspaceA}&clientId=${ids.clientA}&startDate=${metricDate}&endDate=${metricDate}`,
      )));
      assert.equal(validMetrics.status, 200);
      const validRows = (validMetrics.body.metrics as Array<{ campaignName: string; spend: number }>) ?? [];
      assert.equal(validRows.length, 1);
      assert.equal(validRows[0]?.campaignName, "Aurora Campaign");
      assert.equal(validRows[0]?.spend, 111);

      const allMetrics = await json(await getMetrics(new Request(
        `http://localhost/api/metrics/query?workspaceId=${ids.workspaceA}&clientId=all&startDate=${metricDate}&endDate=${metricDate}`,
      )));
      assert.equal(allMetrics.status, 200);
      const allRows = (allMetrics.body.metrics as Array<{ campaignName: string }>) ?? [];
      assert.equal(allRows.length, 2);
      assert.ok(allRows.some((row) => row.campaignName === "Aurora Campaign"));
      assert.ok(allRows.some((row) => row.campaignName === "Workspace Meta Campaign"));
      assert.equal(allRows.some((row) => row.campaignName === "Rival Campaign"), false);

      const rivalMetrics = await json(await getMetrics(new Request(
        `http://localhost/api/metrics/query?workspaceId=${ids.workspaceA}&clientId=${ids.clientB}&startDate=${metricDate}&endDate=${metricDate}`,
      )));
      const missingMetrics = await json(await getMetrics(new Request(
        `http://localhost/api/metrics/query?workspaceId=${ids.workspaceA}&clientId=cl-missing-${suffix}&startDate=${metricDate}&endDate=${metricDate}`,
      )));
      const malformedMetrics = await json(await getMetrics(new Request(
        `http://localhost/api/metrics/query?workspaceId=${ids.workspaceA}&clientId=${encodeURIComponent("not valid")}&startDate=${metricDate}&endDate=${metricDate}`,
      )));
      assert.equal(rivalMetrics.status, 404);
      assert.equal(missingMetrics.status, 404);
      assert.equal(malformedMetrics.status, 400);
      assert.deepEqual(rivalMetrics.body, missingMetrics.body);
      assert.equal(rivalMetrics.body.error, "Client not found in workspace");
      assert.equal("metrics" in rivalMetrics.body, false);

      const report = await json(await getPerformance(new Request(
        `http://localhost/api/reports/performance?workspaceId=${ids.workspaceA}&clientId=${ids.clientA}&startDate=${metricDate}&endDate=${metricDate}`,
      )));
      assert.equal(report.status, 200);
      const reportBody = report.body as { report: { overall: { totalSpend: number } }; client: { id: string } };
      assert.equal(reportBody.client.id, ids.clientA);
      assert.equal(reportBody.report.overall.totalSpend, 111);

      const rivalReport = await json(await getPerformance(new Request(
        `http://localhost/api/reports/performance?workspaceId=${ids.workspaceA}&clientId=${ids.clientB}&startDate=${metricDate}&endDate=${metricDate}`,
      )));
      assert.equal(rivalReport.status, 404);
      assert.equal("report" in rivalReport.body, false);

      const warehouse = await json(await getWarehouseQuery(new Request(
        `http://localhost/api/data-explorer/warehouse/query?workspaceId=${ids.workspaceA}&clientId=${ids.clientA}&startDate=${metricDate}&endDate=${metricDate}&startRow=0&endRow=50`,
      )));
      assert.equal(warehouse.status, 200);
      const warehouseRows = warehouse.body.rows as Array<{ campaignName: string }>;
      assert.equal(warehouseRows.length, 1);
      assert.equal(warehouseRows[0]?.campaignName, "Aurora Campaign");

      const rivalWarehouse = await json(await getWarehouseQuery(new Request(
        `http://localhost/api/data-explorer/warehouse/query?workspaceId=${ids.workspaceA}&clientId=${ids.clientB}&startDate=${metricDate}&endDate=${metricDate}&startRow=0&endRow=50`,
      )));
      assert.equal(rivalWarehouse.status, 404);

      const exportOk = await json(await getExportRows(new Request(
        `http://localhost/api/export/rows?clientId=${ids.clientA}`,
        { headers: { Authorization: `Bearer ${testApiKeySecret}` } },
      )));
      assert.equal(exportOk.status, 200);
      const exportRows = exportOk.body.rows as Array<Array<string | number>>;
      assert.equal(exportRows.length, 2);
      assert.equal(exportRows[1]?.[1], "Aurora Campaign");

      const rivalExport = await json(await getExportRows(new Request(
        `http://localhost/api/export/rows?clientId=${ids.clientB}`,
        { headers: { Authorization: `Bearer ${testApiKeySecret}` } },
      )));
      assert.equal(rivalExport.status, 404);
      assert.equal("rows" in rivalExport.body, false);

      const emptyExport = await json(await getExportRows(new Request(
        `http://localhost/api/export/rows?clientId=${ids.clientAEmpty}`,
        { headers: { Authorization: `Bearer ${testApiKeySecret}` } },
      )));
      assert.equal(emptyExport.status, 200);
      assert.deepEqual(emptyExport.body.rows, []);

      const platforms = await json(await getPlatforms(new Request(
        `http://localhost/api/metrics/platforms?workspaceId=${ids.workspaceA}&clientId=${ids.clientA}`,
      )));
      assert.equal(platforms.status, 200);
      assert.deepEqual(platforms.body.platforms, ["google_ads"]);

      const accounts = await json(await getAccounts(new Request(
        `http://localhost/api/metrics/accounts?workspaceId=${ids.workspaceA}&clientId=${ids.clientA}`,
      )));
      assert.equal(accounts.status, 200);
      const accountRows = accounts.body.accounts as Array<{ accountId: string }>;
      assert.deepEqual(accountRows.map((row) => row.accountId), ["1110001111"]);
    } finally {
      setAuthSessionOverride(null);
    }
  });

  it("honors viewer/member/admin workspace access and never returns rival data to a viewer", async () => {
    await asUser(ids.viewer);
    try {
      const viewerOk = await json(await getMetrics(new Request(
        `http://localhost/api/metrics/query?workspaceId=${ids.workspaceA}&clientId=${ids.clientA}&startDate=${metricDate}&endDate=${metricDate}`,
      )));
      assert.equal(viewerOk.status, 200);
      const rows = viewerOk.body.metrics as Array<{ campaignName: string }>;
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.campaignName, "Aurora Campaign");

      const viewerRival = await json(await getMetrics(new Request(
        `http://localhost/api/metrics/query?workspaceId=${ids.workspaceA}&clientId=${ids.clientB}&startDate=${metricDate}&endDate=${metricDate}`,
      )));
      assert.equal(viewerRival.status, 404);

      const viewerOtherWorkspace = await json(await getMetrics(new Request(
        `http://localhost/api/metrics/query?workspaceId=${ids.workspaceB}&clientId=${ids.clientB}&startDate=${metricDate}&endDate=${metricDate}`,
      )));
      assert.equal(viewerOtherWorkspace.status, 403);
    } finally {
      setAuthSessionOverride(null);
    }

    await asUser(ids.member);
    try {
      const memberOk = await json(await getPerformance(new Request(
        `http://localhost/api/reports/performance?workspaceId=${ids.workspaceA}&clientId=${ids.clientA}&startDate=${metricDate}&endDate=${metricDate}`,
      )));
      assert.equal(memberOk.status, 200);
    } finally {
      setAuthSessionOverride(null);
    }
  });
});
