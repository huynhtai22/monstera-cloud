import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { assertAllowedTestDatabase } from "../src/lib/pg-test-discipline";
import { queryWarehouse } from "../src/lib/warehouse-query";

async function main() {
assertAllowedTestDatabase(process.env.DATABASE_URL);
const db = new PrismaClient();
const suffix = Date.now().toString();
const owner = `perf-owner-${suffix}`;
const workspaces = [`perf-a-${suffix}`, `perf-b-${suffix}`];
const connections = [`perf-conn-a-${suffix}`, `perf-conn-b-${suffix}`];
try {
  await db.user.create({ data: { id: owner, email: `${owner}@example.test` } });
  for (const [index, workspaceId] of workspaces.entries()) {
    await db.workspace.create({ data: { id: workspaceId, name: "Synthetic performance fixture", slug: workspaceId, ownerId: owner } });
    await db.connection.create({ data: { id: connections[index], workspaceId, remoteAccountId: connections[index], provider: "meta_ads", name: "Synthetic source", type: "source", credentials: "{}" } });
    await db.$executeRaw`
      INSERT INTO "CampaignMetric" (id, "workspaceId", "connectionId", platform, "accountId", "entityId", "campaignId", date, currency, spend)
      SELECT ${workspaceId} || '-' || n, ${workspaceId}, ${connections[index]}, 'meta_ads',
             'account-' || (n % 20), 'entity-' || n, 'campaign-' || n,
             TIMESTAMP '2026-09-01' + (n % 30) * INTERVAL '1 day', 'USD', n % 100
      FROM generate_series(1, 50000) AS n`;
  }
  await db.$executeRawUnsafe('ANALYZE "CampaignMetric"');
  const timings: number[] = [];
  let firstPage: Awaited<ReturnType<typeof queryWarehouse>> | undefined;
  for (let run = 0; run < 6; run++) {
    const start = performance.now();
    const result = await queryWarehouse({ workspaceId: workspaces[0], startDate: new Date("2026-09-01"), endDate: new Date("2026-09-30T23:59:59.999Z"), limit: 1000, includeTotalCount: true });
    timings.push(performance.now() - start);
    assert.equal(result.rows.length, 1000);
    assert.equal(result.totalCount, 50000);
    assert.ok(result.rows.every(row => row.workspaceId === workspaces[0]));
    firstPage = result;
  }
  const next = await queryWarehouse({ workspaceId: workspaces[0], limit: 1000, cursor: firstPage!.pagination.nextCursor });
  const firstIds = new Set(firstPage!.rows.map(row => row.id));
  assert.ok(next.rows.every(row => !firstIds.has(row.id) && row.workspaceId === workspaces[0]));
  const groupedTimings: Record<string, number> = {};
  for (const level of ["campaign", "account"] as const) {
    const start = performance.now();
    const grouped = await queryWarehouse({ workspaceId: workspaces[0], level, limit: 1000, includeTotalCount: true });
    groupedTimings[level] = Math.round(performance.now() - start);
    assert.ok(grouped.rows.length > 0 && grouped.rows.length <= 1000);
    assert.ok(grouped.rows.every(row => row.workspaceId === workspaces[0]));
  }
  const concurrentStart = performance.now();
  const concurrent = await Promise.all(Array.from({ length: 5 }, (_, index) => queryWarehouse({ workspaceId: workspaces[index % 2], limit: 1000, includeTotalCount: true })));
  const concurrentFiveMs = Math.round(performance.now() - concurrentStart);
  concurrent.forEach((result, index) => {
    assert.equal(result.rows.length, 1000);
    assert.equal(result.totalCount, 50000);
    assert.ok(result.rows.every(row => row.workspaceId === workspaces[index % 2]));
  });
  const explain = await db.$queryRaw<Array<Record<string, unknown>>>`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT id, date FROM "CampaignMetric"
    WHERE "workspaceId" = ${workspaces[0]} AND date >= TIMESTAMP '2026-09-01' AND date < TIMESTAMP '2026-10-01'
    ORDER BY date DESC, id DESC LIMIT 1000`;
  console.log(JSON.stringify({ synthetic: true, rows: 100000, tenants: 2, snapshotQueryMs: timings.map(n => Math.round(n)), groupedTimings, concurrentFiveMs, tenantRows: 50000, pageRows: 1000, cursorOverlap: 0, explain }, null, 2));
} finally {
  await db.campaignMetric.deleteMany({ where: { workspaceId: { in: workspaces } } });
  await db.connection.deleteMany({ where: { workspaceId: { in: workspaces } } });
  await db.workspace.deleteMany({ where: { id: { in: workspaces } } });
  await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
}

}
main().catch(error => { console.error(error); process.exitCode = 1; });
