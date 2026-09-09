import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertAllowedTestDatabase } from "./pg-test-discipline";
import { setAuthSessionOverride } from "./auth-session";
import { GET as getAnomalies } from "@/app/api/anomalies/route";
import { GET as getSyncLogs } from "@/app/api/sync-logs/route";
import { GET as getShopeeCatalog } from "@/app/api/data-explorer/shopee-catalog/route";
import { GET as getConnections } from "@/app/api/workspaces/[id]/connections/route";
import { GET as getMetrics } from "@/app/api/metrics/query/route";

describe("PostgreSQL integration: auxiliary client surfaces", () => {
  let db: PrismaClient;
  const suffix = `ccx-aux-${Date.now()}-${process.pid}`;
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const dayBefore = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const ids = {
    user: `user-${suffix}`,
    workspace: `ws-${suffix}`,
    rivalWorkspace: `ws-rival-${suffix}`,
    legacy: `client-legacy-${suffix}`,
    clientA: `client-a-${suffix}`,
    clientB: `client-b-${suffix}`,
    empty: `client-empty-${suffix}`,
    rival: `client-rival-${suffix}`,
    shared: `conn-shared-${suffix}`,
    legacyConnection: `conn-legacy-${suffix}`,
    unassignedConnection: `conn-free-${suffix}`,
    destination: `conn-dest-${suffix}`,
    pipelineLegacy: `pipe-legacy-${suffix}`,
    pipelineShared: `pipe-shared-${suffix}`,
  };

  const json = async (response: Response) => ({ status: response.status, body: await response.json() as any });

  before(async () => {
    const url = assertAllowedTestDatabase(process.env.DATABASE_URL);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    await db.user.create({ data: { id: ids.user, email: `${ids.user}@example.test`, name: "Auxiliary Test" } });
    await db.workspace.createMany({ data: [
      { id: ids.workspace, ownerId: ids.user, name: "Auxiliary", slug: `aux-${suffix}`, plan: "professional" },
      { id: ids.rivalWorkspace, ownerId: ids.user, name: "Rival", slug: `rival-${suffix}`, plan: "professional" },
    ] });
    await db.workspaceMember.createMany({ data: [
      { workspaceId: ids.workspace, userId: ids.user, role: "owner" },
      { workspaceId: ids.rivalWorkspace, userId: ids.user, role: "owner" },
    ] });
    await db.client.createMany({ data: [
      { id: ids.legacy, workspaceId: ids.workspace, name: "Legacy Client" },
      { id: ids.clientA, workspaceId: ids.workspace, name: "Client A", accountAssignmentsConfiguredAt: new Date() },
      { id: ids.clientB, workspaceId: ids.workspace, name: "Client B", accountAssignmentsConfiguredAt: new Date() },
      { id: ids.empty, workspaceId: ids.workspace, name: "Empty Client", accountAssignmentsConfiguredAt: new Date() },
      { id: ids.rival, workspaceId: ids.rivalWorkspace, name: "Rival Client", accountAssignmentsConfiguredAt: new Date() },
    ] });
    await db.connection.createMany({ data: [
      {
        id: ids.shared, workspaceId: ids.workspace, clientId: ids.empty, name: "Shared Shopee root",
        provider: "shopee", type: "source", status: "connected", remoteAccountId: `shared-${suffix}`,
        credentials: JSON.stringify({ shopId: "shop-b", customerIds: ["shop-a", "shop-b"], accessToken: "secret" }),
      },
      {
        id: ids.legacyConnection, workspaceId: ids.workspace, clientId: ids.legacy, name: "Legacy source",
        provider: "google_ads", type: "source", status: "connected", remoteAccountId: `legacy-${suffix}`,
        credentials: JSON.stringify({ customerIds: ["legacy-account"] }),
      },
      {
        id: ids.unassignedConnection, workspaceId: ids.workspace, name: "Free Shopee root",
        provider: "shopee", type: "source", status: "connected", remoteAccountId: `free-${suffix}`,
        credentials: JSON.stringify({ shopId: "shop-free" }),
      },
      {
        id: ids.destination, workspaceId: ids.workspace, name: "Destination",
        provider: "google_sheets", type: "destination", status: "connected", remoteAccountId: `dest-${suffix}`,
        credentials: "{}",
      },
    ] });
    await db.clientProviderAccountAssignment.createMany({ data: [
      { workspaceId: ids.workspace, clientId: ids.clientA, provider: "shopee", accountId: "shop-a", connectionId: ids.shared },
      { workspaceId: ids.workspace, clientId: ids.clientB, provider: "shopee", accountId: "shop-b", connectionId: ids.shared },
    ] });
    await db.pipeline.createMany({ data: [
      { id: ids.pipelineLegacy, workspaceId: ids.workspace, clientId: ids.legacy, name: "Legacy pipeline", sourceConnectionId: ids.legacyConnection, destinationConnectionId: ids.destination },
      { id: ids.pipelineShared, workspaceId: ids.workspace, clientId: ids.empty, name: "Ambiguous shared pipeline", sourceConnectionId: ids.shared, destinationConnectionId: ids.destination },
    ] });
    await db.syncLog.createMany({ data: [
      { pipelineId: ids.pipelineLegacy, status: "success", rowsSynced: 1 },
      { pipelineId: ids.pipelineShared, status: "success", rowsSynced: 2 },
    ] });
    await db.syncJob.create({ data: {
      pipelineId: ids.pipelineShared, userId: ids.user, plan: "professional", status: "running",
      scheduledAt: new Date(), priority: 3,
    } });

    const metric = (accountId: string, clientName: string, date: string, spend: number, conversions: number) => ({
      workspaceId: ids.workspace,
      connectionId: ids.shared,
      platform: "shopee",
      accountId,
      accountName: clientName,
      campaignId: `campaign-${accountId}`,
      campaignName: `${clientName} anomaly campaign`,
      date: new Date(`${date}T00:00:00.000Z`),
      spend,
      conversions,
      impressions: 100,
      clicks: 10,
      currency: "USD",
    });
    await db.campaignMetric.createMany({ data: [
      metric("shop-a", "Client A", dayBefore, 10, 5),
      metric("shop-a", "Client A", yesterday, 1, 0),
      metric("shop-a", "Client A", today, 100, 0),
      metric("shop-b", "Client B", dayBefore, 12, 6),
      metric("shop-b", "Client B", yesterday, 1, 0),
      metric("shop-b", "Client B", today, 120, 0),
      {
        workspaceId: ids.workspace, connectionId: ids.unassignedConnection, platform: "shopee",
        accountId: "shop-free", accountName: "Free", campaignId: "free", campaignName: "Free row",
        date: new Date(`${yesterday}T00:00:00.000Z`), spend: 1, currency: "USD",
      },
    ] });
    await db.shopeeCampaign.createMany({ data: [
      { workspaceId: ids.workspace, connectionId: ids.shared, environment: "sandbox", shopId: "shop-a", region: "VN", externalCampaignId: "campaign-a", adType: "search", campaignName: "Catalog A" },
      { workspaceId: ids.workspace, connectionId: ids.shared, environment: "sandbox", shopId: "shop-b", region: "VN", externalCampaignId: "campaign-b", adType: "search", campaignName: "Catalog B" },
      { workspaceId: ids.workspace, connectionId: ids.unassignedConnection, environment: "sandbox", shopId: "shop-free", region: "VN", externalCampaignId: "campaign-free", adType: "search", campaignName: "Catalog Free" },
    ] });
    await db.shopeeProduct.createMany({ data: [
      { workspaceId: ids.workspace, connectionId: ids.shared, environment: "sandbox", shopId: "shop-a", region: "VN", externalItemId: "item-a", itemName: "Product A" },
      { workspaceId: ids.workspace, connectionId: ids.shared, environment: "sandbox", shopId: "shop-b", region: "VN", externalItemId: "item-b", itemName: "Product B" },
    ] });
    await db.providerSyncRun.createMany({ data: [
      { workspaceId: ids.workspace, connectionId: ids.shared, provider: "shopee", environment: "sandbox", shopId: "shop-a", endpoint: "catalog", status: "success" },
      { workspaceId: ids.workspace, connectionId: ids.shared, provider: "shopee", environment: "sandbox", shopId: "shop-b", endpoint: "catalog", status: "success" },
    ] });
    setAuthSessionOverride(async () => ({
      user: { id: ids.user, email: `${ids.user}@example.test` },
      expires: "2099-01-01T00:00:00.000Z",
    }));
  });

  after(async () => {
    setAuthSessionOverride(null);
    try {
      await db.providerSyncRun.deleteMany({ where: { workspaceId: ids.workspace } });
      await db.shopeeProduct.deleteMany({ where: { workspaceId: ids.workspace } });
      await db.shopeeCampaign.deleteMany({ where: { workspaceId: ids.workspace } });
      await db.syncJob.deleteMany({ where: { pipeline: { workspaceId: ids.workspace } } });
      await db.syncLog.deleteMany({ where: { pipeline: { workspaceId: ids.workspace } } });
      await db.pipeline.deleteMany({ where: { workspaceId: ids.workspace } });
      await db.campaignMetric.deleteMany({ where: { workspaceId: ids.workspace } });
      await db.clientProviderAccountAssignment.deleteMany({ where: { workspaceId: ids.workspace } });
      await db.connection.deleteMany({ where: { workspaceId: ids.workspace } });
      await db.client.deleteMany({ where: { workspaceId: { in: [ids.workspace, ids.rivalWorkspace] } } });
      await db.workspaceMember.deleteMany({ where: { workspaceId: { in: [ids.workspace, ids.rivalWorkspace] } } });
      await db.workspace.deleteMany({ where: { id: { in: [ids.workspace, ids.rivalWorkspace] } } });
      await db.user.delete({ where: { id: ids.user } });
    } finally {
      await db.$disconnect();
    }
  });

  it("uses legacy pointers only before cutover and omits ambiguous explicit sync logs", async () => {
    const legacy = await json(await getSyncLogs(new Request(`http://localhost/api/sync-logs?workspaceId=${ids.workspace}&clientId=${ids.legacy}`)));
    assert.equal(legacy.status, 200);
    assert.equal(legacy.body.attribution, "available");
    assert.deepEqual(legacy.body.logs.map((row: any) => row.pipeline.name), ["Legacy pipeline"]);

    for (const clientId of [ids.clientA, ids.clientB, ids.empty]) {
      const explicit = await json(await getSyncLogs(new Request(`http://localhost/api/sync-logs?workspaceId=${ids.workspace}&clientId=${clientId}`)));
      assert.equal(explicit.status, 200);
      assert.equal(explicit.body.attribution, "unavailable");
      assert.deepEqual(explicit.body.logs, []);
    }
    const all = await json(await getSyncLogs(new Request(`http://localhost/api/sync-logs?workspaceId=${ids.workspace}`)));
    assert.equal(all.body.logs.length, 2);
  });

  it("scopes anomalies by exact shared-root account tuples and sanitizes rival context", async () => {
    const anomalyNames = async (clientId?: string) => {
      const params = new URLSearchParams({ workspaceId: ids.workspace });
      if (clientId) params.set("clientId", clientId);
      const result = await json(await getAnomalies(new Request(`http://localhost/api/anomalies?${params}`)));
      return { result, names: (result.body.anomalies ?? []).map((row: any) => row.campaignName) };
    };
    const a = await anomalyNames(ids.clientA);
    assert.equal(a.result.status, 200);
    assert.ok(a.names.includes("Client A anomaly campaign"));
    assert.equal(a.names.includes("Client B anomaly campaign"), false);
    const b = await anomalyNames(ids.clientB);
    assert.ok(b.names.includes("Client B anomaly campaign"));
    assert.equal(b.names.includes("Client A anomaly campaign"), false);
    assert.deepEqual((await anomalyNames(ids.empty)).names, []);
    const all = await anomalyNames();
    assert.ok(all.names.includes("Client A anomaly campaign") && all.names.includes("Client B anomaly campaign"));
    const rival = await anomalyNames(ids.rival);
    assert.equal(rival.result.status, 404);
    assert.equal("anomalies" in rival.result.body, false);
  });

  it("scopes catalog rows and run metadata for explicit, empty, unassigned and all contexts", async () => {
    const catalog = async (clientId?: string) => {
      const params = new URLSearchParams({ workspaceId: ids.workspace });
      if (clientId) params.set("clientId", clientId);
      return json(await getShopeeCatalog(new Request(`http://localhost/api/data-explorer/shopee-catalog?${params}`)));
    };
    const a = await catalog(ids.clientA);
    assert.deepEqual(a.body.campaigns.map((row: any) => row.campaignName), ["Catalog A"]);
    assert.deepEqual(a.body.products.map((row: any) => row.itemName), ["Product A"]);
    assert.equal(a.body.lastRun.shopId, undefined, "selected projection does not expose run identity fields");
    const b = await catalog(ids.clientB);
    assert.deepEqual(b.body.campaigns.map((row: any) => row.campaignName), ["Catalog B"]);
    const empty = await catalog(ids.empty);
    assert.deepEqual(empty.body.campaigns, []);
    assert.deepEqual(empty.body.products, []);
    assert.equal(empty.body.lastRun, null);
    const unassigned = await catalog("unassigned");
    assert.deepEqual(unassigned.body.campaigns.map((row: any) => row.campaignName), ["Catalog Free"]);
    const all = await catalog();
    assert.equal(all.body.campaigns.length, 3);
    assert.equal((await catalog(ids.rival)).status, 404);
  });

  it("projects shared-root credentials and warehouse metadata to the selected account", async () => {
    const response = await getConnections(
      new Request(`http://localhost/api/workspaces/${ids.workspace}/connections?type=source&clientId=${ids.clientA}`),
      { params: Promise.resolve({ id: ids.workspace }) },
    );
    const connections = await response.json() as any[];
    assert.equal(connections.length, 1);
    assert.deepEqual(connections[0].assignedAccounts, [{ provider: "shopee", accountId: "shop-a" }]);
    const credentials = JSON.parse(connections[0].credentials);
    assert.equal(JSON.stringify(credentials).includes("shop-b"), false);
    assert.equal(JSON.stringify(credentials).includes("secret"), false);

    const metrics = await json(await getMetrics(new Request(
      `http://localhost/api/metrics/query?workspaceId=${ids.workspace}&clientId=${ids.clientA}&startDate=${yesterday}&endDate=${today}`,
    )));
    assert.equal(metrics.status, 200);
    assert.deepEqual(new Set(metrics.body.metrics.map((row: any) => row.accountId)), new Set(["shop-a"]));
    assert.deepEqual(metrics.body.summary.platforms, ["shopee"]);
    assert.equal(metrics.body.summary.dateRange.earliest.slice(0, 10), yesterday);
    assert.equal(metrics.body.summary.dateRange.latest.slice(0, 10), today);
    assert.equal(metrics.body.freshness.latestJobId, null);
    assert.equal(metrics.body.freshness.latestJobStatus, null);
    assert.equal(metrics.body.freshness.jobAttribution, "unavailable");

    const empty = await json(await getMetrics(new Request(
      `http://localhost/api/metrics/query?workspaceId=${ids.workspace}&clientId=${ids.empty}&startDate=${yesterday}&endDate=${today}`,
    )));
    assert.deepEqual(empty.body.metrics, []);
    assert.deepEqual(empty.body.summary.platforms, []);
    assert.equal(empty.body.summary.dateRange.earliest, null);
    assert.equal(empty.body.summary.dateRange.latest, null);
    assert.equal(empty.body.freshness.status, "unavailable");
    assert.equal(empty.body.freshness.latestJobId, null);

    const unassigned = await json(await getMetrics(new Request(
      `http://localhost/api/metrics/query?workspaceId=${ids.workspace}&clientId=unassigned&startDate=${yesterday}&endDate=${today}`,
    )));
    assert.deepEqual(unassigned.body.metrics.map((row: any) => row.accountId), ["shop-free"]);
    assert.deepEqual(unassigned.body.summary.platforms, ["shopee"]);
    assert.equal(unassigned.body.summary.dateRange.earliest.slice(0, 10), yesterday);
    assert.equal(unassigned.body.summary.dateRange.latest.slice(0, 10), yesterday);
    assert.equal(unassigned.body.freshness.jobAttribution, "unavailable");
    assert.equal(unassigned.body.freshness.latestJobId, null);

    const workspace = await json(await getMetrics(new Request(
      `http://localhost/api/metrics/query?workspaceId=${ids.workspace}&startDate=${yesterday}&endDate=${today}`,
    )));
    assert.equal(workspace.body.metrics.length, 5);
    assert.deepEqual(workspace.body.summary.platforms, ["shopee"]);
    assert.equal(workspace.body.freshness.jobAttribution, "available");
    assert.equal(workspace.body.freshness.latestJobStatus, "running");
    assert.equal(workspace.body.freshness.status, "refreshing");
  });
});
