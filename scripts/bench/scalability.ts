/**
 * Scalability benchmark — generates a production-like CampaignMetric volume in
 * the database pointed at by DATABASE_URL and runs EXPLAIN ANALYZE on the real
 * hot-path query shapes (warehouse page/count/aggregate, dashboard groupBy,
 * explorer groupBy, deterministic upsert).
 *
 * DANGER: writes rows. Run ONLY against an isolated/benchmark database.
 * Usage:  DATABASE_URL=... npx tsx scripts/bench/scalability.ts [--skip-seed]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const WORKSPACES = 25;
const CONNECTIONS_PER_WS = 4;
const DAYS = 180;
const ENTITIES = 55; // ad-grain entities per connection
const SKEW_BIG = 3; // first N workspaces get double entities

async function timed(label: string, sql: string, params: any[] = [], runs = 1) {
  const t0 = Date.now();
  let last: any = null;
  for (let i = 0; i < runs; i++) {
    last = await prisma.$queryRawUnsafe(sql, ...params);
  }
  const ms = Date.now() - t0;
  console.log(`\n=== ${label} (${ms}ms total for ${runs} run${runs > 1 ? "s" : ""}, ${Math.round(ms / runs)}ms avg) ===`);
  if (runs === 1 && Array.isArray(last)) {
    for (const line of last as any[]) console.log(line?.["QUERY PLAN"] ?? JSON.stringify(line));
  }
  return last;
}

async function main() {
  const skipSeed = process.argv.includes("--skip-seed");
  const suffix = `bench-${Date.now()}`;

  if (!skipSeed) {
    console.log("Seeding users/workspaces/connections…");
    await prisma.$executeRawUnsafe(
      `INSERT INTO "User" (id, name, email, "emailVerified") VALUES ('bench-owner', 'Bench Owner', $1, now())
       ON CONFLICT (id) DO NOTHING`,
      `bench-${suffix}@example.test`,
    );
    for (let w = 1; w <= WORKSPACES; w++) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Workspace" (id, name, slug, "ownerId", "updatedAt", plan, status)
         VALUES ($1, $2, $3, 'bench-owner', now(), 'pilot', 'PILOT') ON CONFLICT (id) DO NOTHING`,
        `bw_${w}`, `Bench WS ${w}`, `bench-ws-${w}-${suffix}`,
      );
      for (let c = 1; c <= CONNECTIONS_PER_WS; c++) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "Connection" (id, "workspaceId", name, type, provider, credentials, "remoteAccountId", "updatedAt")
           VALUES ($1, $2, $3, 'source', 'meta_ads', 'enc:v1:t', $4, now()) ON CONFLICT (id) DO NOTHING`,
          `bc_${w}_${c}`, `bw_${w}`, `Bench Conn ${w}/${c}`, `act_${c}`,
        );
      }
    }

    const bigExtra = `, generate_series(1, ${ENTITIES}) e2`;
    console.log("Generating CampaignMetric volume (~1M rows, skewed)…");
    const t0 = Date.now();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CampaignMetric"
         (id,"workspaceId","connectionId",platform,"accountId","accountName",level,"entityId","campaignId","campaignName",
          date,"breakdownHash",impressions,clicks,spend,reach,cpc,ctr,conversions,revenue,roas,currency,"pulledAt")
       SELECT 'b_'||w||'_'||c||'_'||e||'_'||d,
              'bw_'||w, 'bc_'||w||'_'||c,
              (ARRAY['meta_ads','google_ads','tiktok_business'])[1 + ((w+c+e) % 3)],
              'act_'||c,
              'Account '||c, 'ad',
              'ent_'||e, 'camp_'||(1 + (e % 15)), 'Campaign '||(1 + (e % 15)),
              (CURRENT_DATE - d),
              'none',
              (e*d) % 5000, (e*d) % 300, ((e*d) % 900)::float / 10, (e*d) % 4000,
              CASE WHEN (e*d)%300 > 0 THEN ((e*d)%900)::float / ((e*d)%300) ELSE 0 END,
              CASE WHEN (e*d)%5000 > 0 THEN ((e*d)%300)::float*100 / ((e*d)%5000) ELSE 0 END,
              (e % 7)::float, ((e*d)%50)::float, CASE WHEN (e*d)%300 > 0 THEN ((e*d)%50)::float/((e*d)%300) ELSE 0 END,
              (ARRAY['USD','EUR',NULL])[1 + ((w+e) % 3)],
              now() - (d || ' hours')::interval
       FROM generate_series(1, ${WORKSPACES}) w,
            generate_series(1, ${CONNECTIONS_PER_WS}) c,
            generate_series(1, ${DAYS}) d,
            generate_series(1, ${ENTITIES} + CASE WHEN w <= ${SKEW_BIG} THEN ${ENTITIES} ELSE 0 END) e`,
    );
    console.log(`seed done in ${Date.now() - t0}ms`);
    const total = await prisma.campaignMetric.count();
    console.log("rows:", total);
  }

  const MID = "bw_12";
  const BIG = "bw_1";
  const NO_WS = "bw_missing";

  await timed(
    "Q1 warehouse page (big ws, newest-first, LIMIT 1001)",
    `EXPLAIN ANALYZE SELECT * FROM "CampaignMetric" WHERE "workspaceId" = $1 ORDER BY date DESC, id DESC LIMIT 1001`,
    [BIG],
  );
  await timed(
    "Q1b warehouse page ranged + platform filter (mid ws)",
    `EXPLAIN ANALYZE SELECT * FROM "CampaignMetric" WHERE "workspaceId" = $1 AND date >= CURRENT_DATE - INTERVAL '30 days' AND platform IN ('meta_ads','google_ads') ORDER BY date DESC, id DESC LIMIT 1001`,
    [MID],
  );
  await timed(
    "Q2 count with filters (big ws)",
    `EXPLAIN ANALYZE SELECT COUNT(*) FROM "CampaignMetric" WHERE "workspaceId" = $1 AND date <= CURRENT_DATE`,
    [BIG],
  );
  await timed(
    "Q3 asOf aggregate MAX(pulledAt) (big ws)",
    `EXPLAIN ANALYZE SELECT MAX("pulledAt") FROM "CampaignMetric" WHERE "workspaceId" = $1`,
    [BIG],
  );
  await timed(
    "Q4 dashboard 7d currency groupBy (mid ws)",
    `EXPLAIN ANALYZE SELECT currency, SUM(spend), SUM(impressions), SUM(clicks), SUM(conversions), SUM(revenue), COUNT(*)
     FROM "CampaignMetric" WHERE "workspaceId" = $1 AND date >= CURRENT_DATE - INTERVAL '7 days' GROUP BY currency`,
    [MID],
  );
  await timed(
    "Q5 explorer campaign groupBy ordered (big ws)",
    `EXPLAIN ANALYZE SELECT "campaignId", date, SUM(spend), SUM(impressions)
     FROM "CampaignMetric" WHERE "workspaceId" = $1 GROUP BY "campaignId", date ORDER BY date DESC LIMIT 1000`,
    [BIG],
  );

  // Q6 deterministic upsert at volume — 200 iterations, averaged.
  const upsertSql = `INSERT INTO "CampaignMetric"
    (id,"workspaceId","connectionId",platform,"accountId",level,"entityId","campaignId",date,"breakdownHash",impressions,spend,"pulledAt")
    VALUES ('upsert_bench_'||$1::int, 'bw_1','bc_1_1','meta_ads','act_1','ad','ent_upsert',$2,CURRENT_DATE,'none',$3,$3::float/10,now())
    ON CONFLICT ("connectionId","accountId",level,"entityId",date,"breakdownHash")
    DO UPDATE SET impressions = EXCLUDED.impressions, spend = EXCLUDED.spend, "pulledAt" = now()`;
  const t0 = Date.now();
  for (let i = 0; i < 200; i++) {
    await prisma.$executeRawUnsafe(upsertSql, i, "camp_upsert", i % 100);
  }
  console.log(`\n=== Q6 upsert x200 (hot conflict row): ${Date.now() - t0}ms total, ${((Date.now() - t0) / 200).toFixed(2)}ms avg ===`);

  await timed(
    "Q7 cross-tenant isolation under load (nonexistent workspace)",
    `EXPLAIN ANALYZE SELECT * FROM "CampaignMetric" WHERE "workspaceId" = $1 ORDER BY date DESC LIMIT 1001`,
    [NO_WS],
  );

  const perWs = await prisma.$queryRawUnsafe<any[]>(
    `SELECT w.id, COUNT(m.id)::int AS rows FROM "Workspace" w LEFT JOIN "CampaignMetric" m ON m."workspaceId" = w.id
     WHERE w.slug LIKE 'bench-%' GROUP BY w.id ORDER BY rows DESC LIMIT 3`,
  );
  for (const r of perWs) console.log(`distribution: ${r.id} -> ${r.rows} rows`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
