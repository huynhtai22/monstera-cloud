/**
 * Seeds the smoke-test workspace with 31 days of realistic TikTok Ads campaign
 * metrics so the Looker Studio connector demo looks convincing.
 *
 * Usage (requires DATABASE_URL):
 *   npm run seed-demo-metrics
 *
 * Safe to re-run — uses upsert on (connectionId, campaignId, date).
 * Clears old demo rows first so re-running is idempotent.
 *
 * Optional env:
 *   SMOKE_TEST_EMAIL — default: smoke-test@monsteracloud.com
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_EMAIL = "smoke-test@monsteracloud.com";
const DEMO_CONNECTION_NAME = "__demo_tiktok_ads__";

// ── Demo account ─────────────────────────────────────────────────────────────

const ACCOUNT = {
  accountId: "7390152847361829",
  accountName: "Monstera Demo – Vietnam Store",
  currency: "USD",
};

// ── Demo campaigns & ad-sets ──────────────────────────────────────────────────

const CAMPAIGNS = [
  {
    campaignId: "17912345678901",
    campaignName: "Spring Sale 2026",
    adsets: [
      { adsetId: "89001234567890", adsetName: "Lookalike – Female 18-35 VN" },
      { adsetId: "89001234567891", adsetName: "Interest – Fashion & Lifestyle" },
      { adsetId: "89001234567892", adsetName: "Retargeting – Website Visitors" },
    ],
  },
  {
    campaignId: "17912345678902",
    campaignName: "Brand Awareness Q2",
    adsets: [
      { adsetId: "89001234567893", adsetName: "Broad Audience VN" },
      { adsetId: "89001234567894", adsetName: "High-Intent Shoppers" },
    ],
  },
  {
    campaignId: "17912345678903",
    campaignName: "Flash Sale – April 15",
    adsets: [
      { adsetId: "89001234567895", adsetName: "Flash Sale Interest Targeting" },
      { adsetId: "89001234567896", adsetName: "Past Purchasers – VIP" },
    ],
  },
];

// ── Date range: 31 days ending today ─────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

// ── Deterministic pseudo-random (seeded by date + campaign) ──────────────────

function seededRandom(seed: number): number {
  // Simple xorshift-based pseudo-RNG for reproducible data
  let x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

function jitter(base: number, pct: number, seed: number): number {
  // ±pct% variation around base, deterministic
  return Math.round(base * (1 + (seededRandom(seed) - 0.5) * 2 * pct));
}

function weekendFactor(date: Date): number {
  const dow = date.getUTCDay(); // 0=Sun, 6=Sat
  return dow === 0 || dow === 6 ? 0.72 : 1.0;
}

/** How far through the 31-day window (0→1) — used for Flash Sale ramp */
function progressFactor(dayIndex: number, totalDays: number): number {
  return dayIndex / (totalDays - 1);
}

// ── Metric generators per campaign ───────────────────────────────────────────

interface DayMetrics {
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;
  conversions: number;
  revenue: number;
  cpc: number;
  ctr: number;
  roas: number;
}

function springSaleMetrics(date: Date, dayIdx: number, adsetIdx: number): DayMetrics {
  const seed = dayIdx * 100 + adsetIdx * 10;
  const wf = weekendFactor(date);
  // Adsets have different spend shares: 40% / 35% / 25%
  const adsetWeight = [0.40, 0.35, 0.25][adsetIdx] ?? 0.33;

  const impressions = Math.round(jitter(120_000, 0.25, seed) * wf * adsetWeight);
  const ctr = 0.018 + seededRandom(seed + 1) * 0.008; // 1.8–2.6%
  const clicks = Math.round(impressions * ctr);
  const cpc = 0.22 + seededRandom(seed + 2) * 0.12; // $0.22–$0.34
  const spend = parseFloat((clicks * cpc).toFixed(2));
  const cvr = 0.028 + seededRandom(seed + 3) * 0.015; // 2.8–4.3%
  const conversions = Math.round(clicks * cvr);
  const aov = 42 + seededRandom(seed + 4) * 18; // $42–$60 AOV
  const revenue = parseFloat((conversions * aov).toFixed(2));
  const reach = Math.round(impressions * (0.78 + seededRandom(seed + 5) * 0.12));

  return {
    impressions, clicks, spend, reach, conversions, revenue,
    cpc: parseFloat(cpc.toFixed(4)),
    ctr: parseFloat(ctr.toFixed(6)),
    roas: spend > 0 ? parseFloat((revenue / spend).toFixed(4)) : 0,
  };
}

function brandAwarenessMetrics(date: Date, dayIdx: number, adsetIdx: number): DayMetrics {
  const seed = dayIdx * 200 + adsetIdx * 10 + 50;
  const wf = weekendFactor(date);
  const adsetWeight = [0.60, 0.40][adsetIdx] ?? 0.50;

  const impressions = Math.round(jitter(220_000, 0.30, seed) * wf * adsetWeight);
  const ctr = 0.007 + seededRandom(seed + 1) * 0.004; // 0.7–1.1% (awareness = lower CTR)
  const clicks = Math.round(impressions * ctr);
  const cpc = 0.18 + seededRandom(seed + 2) * 0.10;
  const spend = parseFloat((clicks * cpc).toFixed(2));
  const cvr = 0.012 + seededRandom(seed + 3) * 0.008;
  const conversions = Math.round(clicks * cvr);
  const aov = 55 + seededRandom(seed + 4) * 20;
  const revenue = parseFloat((conversions * aov).toFixed(2));
  const reach = Math.round(impressions * (0.85 + seededRandom(seed + 5) * 0.10));

  return {
    impressions, clicks, spend, reach, conversions, revenue,
    cpc: parseFloat(cpc.toFixed(4)),
    ctr: parseFloat(ctr.toFixed(6)),
    roas: spend > 0 ? parseFloat((revenue / spend).toFixed(4)) : 0,
  };
}

function flashSaleMetrics(date: Date, dayIdx: number, totalDays: number, adsetIdx: number): DayMetrics {
  const seed = dayIdx * 300 + adsetIdx * 10 + 100;
  const progress = progressFactor(dayIdx, totalDays); // 0→1 ramp
  // Starts quiet, then exponential ramp the last 7 days → peak on day 30
  const rampMultiplier = progress < 0.77
    ? 0.05 + progress * 0.60  // slow build
    : 0.50 + Math.pow((progress - 0.77) / 0.23, 2) * 14; // exponential spike

  const wf = weekendFactor(date);
  const adsetWeight = [0.55, 0.45][adsetIdx] ?? 0.50;

  const impressions = Math.round(
    jitter(380_000, 0.20, seed) * rampMultiplier * wf * adsetWeight
  );
  const ctr = 0.028 + seededRandom(seed + 1) * 0.012 + progress * 0.008; // ramp CTR too
  const clicks = Math.round(impressions * ctr);
  const cpc = 0.15 + seededRandom(seed + 2) * 0.08;
  const spend = parseFloat((clicks * cpc).toFixed(2));
  const cvr = 0.045 + seededRandom(seed + 3) * 0.020 + progress * 0.015; // flash sale urgency
  const conversions = Math.round(clicks * cvr);
  const aov = 68 + seededRandom(seed + 4) * 25; // higher basket on flash sale
  const revenue = parseFloat((conversions * aov).toFixed(2));
  const reach = Math.round(impressions * (0.70 + seededRandom(seed + 5) * 0.15));

  return {
    impressions, clicks, spend, reach, conversions, revenue,
    cpc: parseFloat(cpc.toFixed(4)),
    ctr: parseFloat(ctr.toFixed(6)),
    roas: spend > 0 ? parseFloat((revenue / spend).toFixed(4)) : 0,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const email = (process.env.SMOKE_TEST_EMAIL || DEFAULT_EMAIL).trim().toLowerCase();

  // 1. Find smoke test user
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (!user) {
    console.error(`❌ User not found: ${email}. Run: npm run create-smoke-user:pro`);
    process.exit(1);
  }

  // 2. Find smoke test workspace
  const ws = await prisma.workspace.findFirst({
    where: { ownerId: user.id, slug: "smoke-test-workspace" },
    select: { id: true },
  });
  if (!ws) {
    console.error("❌ Workspace 'smoke-test-workspace' not found. Run: npm run create-smoke-user:pro");
    process.exit(1);
  }

  const workspaceId = ws.id;
  console.log(`✅ Found workspace: ${workspaceId}`);

  // 3. Upsert demo Connection record (we need a real FK for CampaignMetric)
  // Look for existing demo connection first
  let connection = await prisma.connection.findFirst({
    where: { workspaceId, name: DEMO_CONNECTION_NAME },
    select: { id: true },
  });

  if (!connection) {
    connection = await prisma.connection.create({
      data: {
        workspaceId,
        name: DEMO_CONNECTION_NAME,
        type: "source",
        provider: "tiktok_business",
        status: "connected",
        credentials: JSON.stringify({
          demo: true,
          accountId: ACCOUNT.accountId,
          note: "Seed data — not a real TikTok credential",
        }),
        lastSyncAt: new Date(),
      },
      select: { id: true },
    });
    console.log(`✅ Created demo connection: ${connection.id}`);
  } else {
    console.log(`✅ Reusing demo connection: ${connection.id}`);
  }

  const connectionId = connection.id;

  // 4. Clear old demo rows (idempotent re-seed)
  const deleted = await prisma.campaignMetric.deleteMany({
    where: { connectionId },
  });
  if (deleted.count > 0) {
    console.log(`🗑️  Cleared ${deleted.count} old demo metric rows`);
  }

  // 5. Build 31 days × campaigns × ad-sets rows
  const TOTAL_DAYS = 31;
  const rows: Parameters<typeof prisma.campaignMetric.create>[0]["data"][] = [];

  for (let dayIdx = 0; dayIdx < TOTAL_DAYS; dayIdx++) {
    // dayIdx 0 = 30 days ago, dayIdx 30 = today
    const date = daysAgo(TOTAL_DAYS - 1 - dayIdx);

    CAMPAIGNS.forEach((campaign, campaignIdx) => {
      campaign.adsets.forEach((adset, adsetIdx) => {
        let m: DayMetrics;

        if (campaignIdx === 0) {
          m = springSaleMetrics(date, dayIdx, adsetIdx);
        } else if (campaignIdx === 1) {
          m = brandAwarenessMetrics(date, dayIdx, adsetIdx);
        } else {
          m = flashSaleMetrics(date, dayIdx, TOTAL_DAYS, adsetIdx);
        }

        // Skip rows with 0 impressions (early Flash Sale days before ramp)
        if (m.impressions < 1) return;

        rows.push({
          workspaceId,
          connectionId,
          platform: "tiktok_business",
          accountId: ACCOUNT.accountId,
          accountName: ACCOUNT.accountName,
          campaignId: campaign.campaignId,
          campaignName: campaign.campaignName,
          adsetId: adset.adsetId,
          adsetName: adset.adsetName,
          date,
          impressions: m.impressions,
          clicks: m.clicks,
          spend: m.spend,
          reach: m.reach,
          conversions: m.conversions,
          revenue: m.revenue,
          cpc: m.cpc,
          ctr: m.ctr,
          roas: m.roas,
          currency: ACCOUNT.currency,
        });
      });
    });
  }

  // 6. Batch insert
  const BATCH_SIZE = 100;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await prisma.campaignMetric.createMany({
      data: batch as any,
      skipDuplicates: true,
    });
    inserted += batch.length;
  }

  // 7. Summary
  const totals = rows.reduce(
    (acc, r: any) => ({
      impressions: acc.impressions + r.impressions,
      spend: acc.spend + r.spend,
      conversions: acc.conversions + r.conversions,
      revenue: acc.revenue + r.revenue,
    }),
    { impressions: 0, spend: 0, conversions: 0, revenue: 0 }
  );

  console.log(`\n✅ Seeded ${inserted} rows across ${TOTAL_DAYS} days`);
  console.log(`   Campaigns : ${CAMPAIGNS.length}`);
  console.log(`   Ad Sets   : ${CAMPAIGNS.reduce((a, c) => a + c.adsets.length, 0)}`);
  console.log(`   Impressions: ${totals.impressions.toLocaleString()}`);
  console.log(`   Spend      : $${totals.spend.toFixed(2)}`);
  console.log(`   Conversions: ${Math.round(totals.conversions).toLocaleString()}`);
  console.log(`   Revenue    : $${totals.revenue.toFixed(2)}`);
  console.log(`   Avg ROAS   : ${(totals.revenue / totals.spend).toFixed(2)}x`);
  console.log(`\n   Account    : ${ACCOUNT.accountName} (${ACCOUNT.accountId})`);
  console.log(`   Platform   : TikTok Ads (tiktok_business)\n`);
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
