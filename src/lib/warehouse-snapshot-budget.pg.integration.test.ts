import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertAllowedTestDatabase } from "./pg-test-discipline";
import { queryWarehouse } from "./warehouse-query";

/**
 * Bounded-volume regression for the warehouse snapshot transaction: several
 * thousand rows plus count, date-range, platform and freshness metadata must
 * round-trip consistently through the real Repeatable Read path — well above
 * the single-digit volumes elsewhere, far below production ceilings, and
 * with no timing assertions that could flake.
 */
describe("PostgreSQL integration: warehouse snapshot budget", () => {
  let db: PrismaClient;
  const suffix = `wsb-${Date.now()}-${process.pid}`;
  const ROWS = 3_000;
  const ids = {
    owner: `user-${suffix}`,
    workspace: `ws-${suffix}`,
    connection: `conn-${suffix}`,
  };
  const dates = ["2026-09-02", "2026-09-03", "2026-09-04"];

  before(async () => {
    const url = process.env.DATABASE_URL;
    assertAllowedTestDatabase(url);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    await db.user.create({
      data: { id: ids.owner, email: `${ids.owner}@example.test`, name: "Budget Owner" },
    });
    await db.workspace.create({
      data: { id: ids.workspace, ownerId: ids.owner, name: "Budget WS", slug: `wsb-${suffix}`, plan: "professional" },
    });
    await db.workspaceMember.create({
      data: { workspaceId: ids.workspace, userId: ids.owner, role: "owner" },
    });
    await db.connection.create({
      data: {
        id: ids.connection,
        workspaceId: ids.workspace,
        name: "Budget src",
        provider: "google_ads",
        type: "source",
        status: "connected",
        remoteAccountId: `budget-${suffix}`,
        credentials: "{}",
      },
    });
    const rows = Array.from({ length: ROWS }, (_, index) => ({
      workspaceId: ids.workspace,
      connectionId: ids.connection,
      platform: "google_ads",
      accountId: "WSBUDGET",
      accountName: "Budget Account",
      campaignId: `camp-${index % 50}`,
      campaignName: `Budget Campaign ${index % 50}`,
      entityId: `entity-${index}`,
      date: new Date(`${dates[index % dates.length]}T00:00:00.000Z`),
      spend: 1,
      impressions: 100,
      clicks: 10,
      currency: "USD",
    }));
    await db.campaignMetric.createMany({ data: rows });
  });

  after(async () => {
    try {
      await db.campaignMetric.deleteMany({ where: { workspaceId: ids.workspace } });
      await db.connection.deleteMany({ where: { workspaceId: ids.workspace } });
      await db.workspaceMember.deleteMany({ where: { workspaceId: ids.workspace } });
      await db.workspace.delete({ where: { id: ids.workspace } });
      await db.user.delete({ where: { id: ids.owner } });
    } finally {
      await db.$disconnect();
    }
  });

  it("returns thousands of rows with matching count and metadata in one snapshot", async () => {
    const result = await queryWarehouse({
      workspaceId: ids.workspace,
      limit: 5_000,
      includeTotalCount: true,
    });
    assert.equal(result.rows.length, ROWS);
    assert.equal(result.totalCount, ROWS);
    assert.equal(result.pagination.hasMore, false);
    assert.equal(result.pagination.returned, ROWS);
    assert.deepEqual(result.platforms, ["google_ads"]);
    assert.equal(result.dateRange.earliest?.toISOString().slice(0, 10), "2026-09-02");
    assert.equal(result.dateRange.latest?.toISOString().slice(0, 10), "2026-09-04");
    assert.ok(result.asOf instanceof Date);
    assert.equal(result.freshness.jobAttribution, "available");
    const campaigns = new Set(result.rows.map((row) => row.campaignId));
    assert.equal(campaigns.size, 50);
  });
});
