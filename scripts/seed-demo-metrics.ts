/**
 * Seeds the smoke-test workspace with 31 days of realistic multi-platform
 * campaign metrics (TikTok Ads, Meta Ads, Google Ads) for the Looker Studio demo.
 *
 * Usage (requires DATABASE_URL):
 *   npm run seed-demo-metrics
 *
 * Safe to re-run — clears old demo rows first, then re-inserts.
 *
 * Optional env:
 *   SMOKE_TEST_EMAIL — default: smoke-test@monsteracloud.com
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_EMAIL = "smoke-test@monsteracloud.com";

// ── Platform connection names (used for upsert / cleanup) ────────────────────
const DEMO_CONNECTIONS = {
  tiktok:  "__demo_tiktok_ads__",
  meta:    "__demo_meta_ads__",
  google:  "__demo_google_ads__",
};

// ── Accounts ─────────────────────────────────────────────────────────────────
const TIKTOK_ACCOUNT  = { accountId: "7390152847361829", accountName: "Monstera Demo – TikTok VN",    currency: "USD" };
const META_ACCOUNT    = { accountId: "act_290847361820",  accountName: "Monstera Demo – Meta APAC",   currency: "USD" };
const GOOGLE_ACCOUNT  = { accountId: "120-847-3618",      accountName: "Monstera Demo – Google Ads",  currency: "USD" };

// ── TikTok campaigns ──────────────────────────────────────────────────────────
const TIKTOK_CAMPAIGNS = [
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

// ── Meta campaigns ────────────────────────────────────────────────────────────
const META_CAMPAIGNS = [
  {
    campaignId: "23856789012301",
    campaignName: "Conversion – Add to Cart",
    adsets: [
      { adsetId: "23856789012401", adsetName: "Custom Audience – Engaged Users" },
      { adsetId: "23856789012402", adsetName: "Lookalike 1% – Purchasers" },
      { adsetId: "23856789012403", adsetName: "Interest – Online Shopping" },
    ],
  },
  {
    campaignId: "23856789012302",
    campaignName: "Reach – Brand Building",
    adsets: [
      { adsetId: "23856789012404", adsetName: "Vietnam 18-45 Broad" },
      { adsetId: "23856789012405", adsetName: "Instagram Stories Placement" },
    ],
  },
  {
    campaignId: "23856789012303",
    campaignName: "Retargeting – Cart Abandoners",
    adsets: [
      { adsetId: "23856789012406", adsetName: "30-Day Website Visitors" },
      { adsetId: "23856789012407", adsetName: "Video Viewers 75%" },
    ],
  },
];

// ── Google Ads campaigns ──────────────────────────────────────────────────────
const GOOGLE_CAMPAIGNS = [
  {
    campaignId: "15234567890101",
    campaignName: "Search – Brand Keywords",
    adsets: [
      { adsetId: "15234567890201", adsetName: "Brand Exact Match" },
      { adsetId: "15234567890202", adsetName: "Competitor Keywords" },
    ],
  },
  {
    campaignId: "15234567890102",
    campaignName: "Performance Max – Shopping",
    adsets: [
      { adsetId: "15234567890203", adsetName: "All Products Asset Group" },
      { adsetId: "15234567890204", adsetName: "Best Sellers Asset Group" },
    ],
  },
  {
    campaignId: "15234567890103",
    campaignName: "Display – Remarketing",
    adsets: [
      { adsetId: "15234567890205", adsetName: "Site Visitors – 14 Days" },
    ],
  },
];

// ── Date helpers ──────────────────────────────────────────────────────────────
function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

function jitter(base: number, pct: number, seed: number): number {
  return Math.round(base * (1 + (seededRandom(seed) - 0.5) * 2 * pct));
}

function weekendFactor(date: Date): number {
  const dow = date.getUTCDay();
  return dow === 0 || dow === 6 ? 0.72 : 1.0;
}

function progressFactor(dayIdx: number, totalDays: number): number {
  return dayIdx / (totalDays - 1);
}

interface DayMetrics {
  impressions: number; clicks: number; spend: number;
  reach: number; conversions: number; revenue: number;
  cpc: number; ctr: number; roas: number;
}

// ── TikTok metric generators ──────────────────────────────────────────────────
function tiktokSpringSale(date: Date, dayIdx: number, adsetIdx: number): DayMetrics {
  const seed = dayIdx * 100 + adsetIdx * 10;
  const wf = weekendFactor(date);
  const w = [0.40, 0.35, 0.25][adsetIdx] ?? 0.33;
  const impressions = Math.round(jitter(120_000, 0.25, seed) * wf * w);
  const ctr = 0.018 + seededRandom(seed + 1) * 0.008;
  const clicks = Math.round(impressions * ctr);
  const cpc = 0.22 + seededRandom(seed + 2) * 0.12;
  const spend = parseFloat((clicks * cpc).toFixed(2));
  const conversions = Math.round(clicks * (0.028 + seededRandom(seed + 3) * 0.015));
  const revenue = parseFloat((conversions * (42 + seededRandom(seed + 4) * 18)).toFixed(2));
  const reach = Math.round(impressions * (0.78 + seededRandom(seed + 5) * 0.12));
  return { impressions, clicks, spend, reach, conversions, revenue,
    cpc: parseFloat(cpc.toFixed(4)), ctr: parseFloat(ctr.toFixed(6)),
    roas: spend > 0 ? parseFloat((revenue / spend).toFixed(4)) : 0 };
}

function tiktokBrandAwareness(date: Date, dayIdx: number, adsetIdx: number): DayMetrics {
  const seed = dayIdx * 200 + adsetIdx * 10 + 50;
  const wf = weekendFactor(date);
  const w = [0.60, 0.40][adsetIdx] ?? 0.50;
  const impressions = Math.round(jitter(220_000, 0.30, seed) * wf * w);
  const ctr = 0.007 + seededRandom(seed + 1) * 0.004;
  const clicks = Math.round(impressions * ctr);
  const cpc = 0.18 + seededRandom(seed + 2) * 0.10;
  const spend = parseFloat((clicks * cpc).toFixed(2));
  const conversions = Math.round(clicks * (0.012 + seededRandom(seed + 3) * 0.008));
  const revenue = parseFloat((conversions * (55 + seededRandom(seed + 4) * 20)).toFixed(2));
  const reach = Math.round(impressions * (0.85 + seededRandom(seed + 5) * 0.10));
  return { impressions, clicks, spend, reach, conversions, revenue,
    cpc: parseFloat(cpc.toFixed(4)), ctr: parseFloat(ctr.toFixed(6)),
    roas: spend > 0 ? parseFloat((revenue / spend).toFixed(4)) : 0 };
}

function tiktokFlashSale(date: Date, dayIdx: number, totalDays: number, adsetIdx: number): DayMetrics {
  const seed = dayIdx * 300 + adsetIdx * 10 + 100;
  const progress = progressFactor(dayIdx, totalDays);
  const ramp = progress < 0.77
    ? 0.05 + progress * 0.60
    : 0.50 + Math.pow((progress - 0.77) / 0.23, 2) * 14;
  const wf = weekendFactor(date);
  const w = [0.55, 0.45][adsetIdx] ?? 0.50;
  const impressions = Math.round(jitter(380_000, 0.20, seed) * ramp * wf * w);
  const ctr = 0.028 + seededRandom(seed + 1) * 0.012 + progress * 0.008;
  const clicks = Math.round(impressions * ctr);
  const cpc = 0.15 + seededRandom(seed + 2) * 0.08;
  const spend = parseFloat((clicks * cpc).toFixed(2));
  const conversions = Math.round(clicks * (0.045 + seededRandom(seed + 3) * 0.020 + progress * 0.015));
  const revenue = parseFloat((conversions * (68 + seededRandom(seed + 4) * 25)).toFixed(2));
  const reach = Math.round(impressions * (0.70 + seededRandom(seed + 5) * 0.15));
  return { impressions, clicks, spend, reach, conversions, revenue,
    cpc: parseFloat(cpc.toFixed(4)), ctr: parseFloat(ctr.toFixed(6)),
    roas: spend > 0 ? parseFloat((revenue / spend).toFixed(4)) : 0 };
}

// ── Meta metric generators ────────────────────────────────────────────────────
// Meta: steady conversion focus, higher CPCs, good ROAS, slight weekend dip
function metaConversion(date: Date, dayIdx: number, adsetIdx: number): DayMetrics {
  const seed = dayIdx * 400 + adsetIdx * 10 + 200;
  const wf = weekendFactor(date) * (0.9 + seededRandom(seed + 9) * 0.2);
  const w = [0.45, 0.35, 0.20][adsetIdx] ?? 0.33;
  // Slight upward trend over the month
  const trend = 1 + progressFactor(dayIdx, 31) * 0.3;
  const impressions = Math.round(jitter(85_000, 0.20, seed) * wf * w * trend);
  const ctr = 0.022 + seededRandom(seed + 1) * 0.010;
  const clicks = Math.round(impressions * ctr);
  const cpc = 0.45 + seededRandom(seed + 2) * 0.20; // Meta CPCs higher than TikTok
  const spend = parseFloat((clicks * cpc).toFixed(2));
  const conversions = Math.round(clicks * (0.038 + seededRandom(seed + 3) * 0.018));
  const revenue = parseFloat((conversions * (52 + seededRandom(seed + 4) * 22)).toFixed(2));
  const reach = Math.round(impressions * (0.80 + seededRandom(seed + 5) * 0.10));
  return { impressions, clicks, spend, reach, conversions, revenue,
    cpc: parseFloat(cpc.toFixed(4)), ctr: parseFloat(ctr.toFixed(6)),
    roas: spend > 0 ? parseFloat((revenue / spend).toFixed(4)) : 0 };
}

function metaReach(date: Date, dayIdx: number, adsetIdx: number): DayMetrics {
  const seed = dayIdx * 500 + adsetIdx * 10 + 250;
  const wf = weekendFactor(date);
  const w = [0.65, 0.35][adsetIdx] ?? 0.50;
  const impressions = Math.round(jitter(310_000, 0.25, seed) * wf * w);
  const ctr = 0.005 + seededRandom(seed + 1) * 0.003;
  const clicks = Math.round(impressions * ctr);
  const cpc = 0.30 + seededRandom(seed + 2) * 0.15;
  const spend = parseFloat((clicks * cpc).toFixed(2));
  const conversions = Math.round(clicks * (0.008 + seededRandom(seed + 3) * 0.005));
  const revenue = parseFloat((conversions * (60 + seededRandom(seed + 4) * 15)).toFixed(2));
  const reach = Math.round(impressions * (0.88 + seededRandom(seed + 5) * 0.08));
  return { impressions, clicks, spend, reach, conversions, revenue,
    cpc: parseFloat(cpc.toFixed(4)), ctr: parseFloat(ctr.toFixed(6)),
    roas: spend > 0 ? parseFloat((revenue / spend).toFixed(4)) : 0 };
}

function metaRetargeting(date: Date, dayIdx: number, adsetIdx: number): DayMetrics {
  const seed = dayIdx * 600 + adsetIdx * 10 + 300;
  const wf = weekendFactor(date);
  const w = [0.60, 0.40][adsetIdx] ?? 0.50;
  const impressions = Math.round(jitter(35_000, 0.20, seed) * wf * w);
  const ctr = 0.042 + seededRandom(seed + 1) * 0.015; // retargeting = high CTR
  const clicks = Math.round(impressions * ctr);
  const cpc = 0.55 + seededRandom(seed + 2) * 0.20;
  const spend = parseFloat((clicks * cpc).toFixed(2));
  const conversions = Math.round(clicks * (0.065 + seededRandom(seed + 3) * 0.025)); // high CVR
  const revenue = parseFloat((conversions * (75 + seededRandom(seed + 4) * 30)).toFixed(2));
  const reach = Math.round(impressions * (0.72 + seededRandom(seed + 5) * 0.15));
  return { impressions, clicks, spend, reach, conversions, revenue,
    cpc: parseFloat(cpc.toFixed(4)), ctr: parseFloat(ctr.toFixed(6)),
    roas: spend > 0 ? parseFloat((revenue / spend).toFixed(4)) : 0 };
}

// ── Google Ads metric generators ──────────────────────────────────────────────
// Google: intent-based, high CPC, strong conversion rate, stable spend
function googleSearch(date: Date, dayIdx: number, adsetIdx: number): DayMetrics {
  const seed = dayIdx * 700 + adsetIdx * 10 + 400;
  const wf = weekendFactor(date) * 0.85; // Search drops more on weekends
  const w = [0.70, 0.30][adsetIdx] ?? 0.50;
  const impressions = Math.round(jitter(28_000, 0.15, seed) * wf * w);
  const ctr = 0.055 + seededRandom(seed + 1) * 0.020; // Search has highest CTR
  const clicks = Math.round(impressions * ctr);
  const cpc = 1.20 + seededRandom(seed + 2) * 0.60; // Google Search = expensive
  const spend = parseFloat((clicks * cpc).toFixed(2));
  const conversions = Math.round(clicks * (0.055 + seededRandom(seed + 3) * 0.025));
  const revenue = parseFloat((conversions * (88 + seededRandom(seed + 4) * 35)).toFixed(2));
  const reach = Math.round(impressions * (0.95 + seededRandom(seed + 5) * 0.05)); // Search = near 1:1
  return { impressions, clicks, spend, reach, conversions, revenue,
    cpc: parseFloat(cpc.toFixed(4)), ctr: parseFloat(ctr.toFixed(6)),
    roas: spend > 0 ? parseFloat((revenue / spend).toFixed(4)) : 0 };
}

function googlePMax(date: Date, dayIdx: number, adsetIdx: number): DayMetrics {
  const seed = dayIdx * 800 + adsetIdx * 10 + 450;
  const wf = weekendFactor(date);
  const w = [0.60, 0.40][adsetIdx] ?? 0.50;
  // PMax budget ramps up as Google optimizes over the month
  const optimizationBoost = 1 + progressFactor(dayIdx, 31) * 0.5;
  const impressions = Math.round(jitter(95_000, 0.22, seed) * wf * w * optimizationBoost);
  const ctr = 0.018 + seededRandom(seed + 1) * 0.008;
  const clicks = Math.round(impressions * ctr);
  const cpc = 0.75 + seededRandom(seed + 2) * 0.35;
  const spend = parseFloat((clicks * cpc).toFixed(2));
  const conversions = Math.round(clicks * (0.042 + seededRandom(seed + 3) * 0.018));
  const revenue = parseFloat((conversions * (65 + seededRandom(seed + 4) * 28)).toFixed(2));
  const reach = Math.round(impressions * (0.82 + seededRandom(seed + 5) * 0.10));
  return { impressions, clicks, spend, reach, conversions, revenue,
    cpc: parseFloat(cpc.toFixed(4)), ctr: parseFloat(ctr.toFixed(6)),
    roas: spend > 0 ? parseFloat((revenue / spend).toFixed(4)) : 0 };
}

function googleDisplay(date: Date, dayIdx: number, adsetIdx: number): DayMetrics {
  const seed = dayIdx * 900 + adsetIdx * 10 + 500;
  const wf = weekendFactor(date);
  const impressions = Math.round(jitter(180_000, 0.25, seed) * wf * 0.8);
  const ctr = 0.004 + seededRandom(seed + 1) * 0.003; // Display low CTR
  const clicks = Math.round(impressions * ctr);
  const cpc = 0.35 + seededRandom(seed + 2) * 0.15;
  const spend = parseFloat((clicks * cpc).toFixed(2));
  const conversions = Math.round(clicks * (0.015 + seededRandom(seed + 3) * 0.010));
  const revenue = parseFloat((conversions * (55 + seededRandom(seed + 4) * 20)).toFixed(2));
  const reach = Math.round(impressions * (0.90 + seededRandom(seed + 5) * 0.08));
  return { impressions, clicks, spend, reach, conversions, revenue,
    cpc: parseFloat(cpc.toFixed(4)), ctr: parseFloat(ctr.toFixed(6)),
    roas: spend > 0 ? parseFloat((revenue / spend).toFixed(4)) : 0 };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const email = (process.env.SMOKE_TEST_EMAIL || DEFAULT_EMAIL).trim().toLowerCase();

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (!user) {
    console.error(`❌ User not found: ${email}. Run: npm run create-smoke-user:pro`);
    process.exit(1);
  }

  const ws = await prisma.workspace.findFirst({
    where: { ownerId: user.id, slug: "smoke-test-workspace" },
    select: { id: true },
  });
  if (!ws) {
    console.error("❌ Workspace not found. Run: npm run create-smoke-user:pro");
    process.exit(1);
  }

  const workspaceId = ws.id;
  console.log(`✅ Found workspace: ${workspaceId}`);

  // ── Upsert connections for each platform ────────────────────────────────────
  async function getOrCreateConnection(name: string, provider: string, accountId: string) {
    let conn = await prisma.connection.findFirst({
      where: { workspaceId, name },
      select: { id: true },
    });
    if (!conn) {
      conn = await prisma.connection.create({
        data: {
          workspaceId, name, type: "source", provider,
          status: "connected",
          credentials: JSON.stringify({ demo: true, accountId }),
          lastSyncAt: new Date(),
        },
        select: { id: true },
      });
      console.log(`✅ Created connection [${provider}]: ${conn.id}`);
    } else {
      console.log(`✅ Reusing connection [${provider}]: ${conn.id}`);
    }
    return conn.id;
  }

  const tiktokConnId = await getOrCreateConnection(DEMO_CONNECTIONS.tiktok, "tiktok_business", TIKTOK_ACCOUNT.accountId);
  const metaConnId   = await getOrCreateConnection(DEMO_CONNECTIONS.meta,   "meta_ads",        META_ACCOUNT.accountId);
  const googleConnId = await getOrCreateConnection(DEMO_CONNECTIONS.google,  "google_ads",      GOOGLE_ACCOUNT.accountId);

  // ── Clear old demo rows ──────────────────────────────────────────────────────
  const allConnIds = [tiktokConnId, metaConnId, googleConnId];
  const deleted = await prisma.campaignMetric.deleteMany({
    where: { connectionId: { in: allConnIds } },
  });
  if (deleted.count > 0) console.log(`🗑️  Cleared ${deleted.count} old demo rows`);

  // ── Build rows ───────────────────────────────────────────────────────────────
  const TOTAL_DAYS = 31;
  const rows: any[] = [];

  for (let dayIdx = 0; dayIdx < TOTAL_DAYS; dayIdx++) {
    const date = daysAgo(TOTAL_DAYS - 1 - dayIdx);

    // TikTok rows
    TIKTOK_CAMPAIGNS.forEach((campaign, ci) => {
      campaign.adsets.forEach((adset, ai) => {
        let m: DayMetrics;
        if (ci === 0) m = tiktokSpringSale(date, dayIdx, ai);
        else if (ci === 1) m = tiktokBrandAwareness(date, dayIdx, ai);
        else m = tiktokFlashSale(date, dayIdx, TOTAL_DAYS, ai);
        if (m.impressions < 1) return;
        rows.push({
          workspaceId, connectionId: tiktokConnId, platform: "tiktok_business",
          accountId: TIKTOK_ACCOUNT.accountId, accountName: TIKTOK_ACCOUNT.accountName,
          campaignId: campaign.campaignId, campaignName: campaign.campaignName,
          adsetId: adset.adsetId, adsetName: adset.adsetName,
          date, currency: TIKTOK_ACCOUNT.currency, ...m,
        });
      });
    });

    // Meta rows
    META_CAMPAIGNS.forEach((campaign, ci) => {
      campaign.adsets.forEach((adset, ai) => {
        let m: DayMetrics;
        if (ci === 0) m = metaConversion(date, dayIdx, ai);
        else if (ci === 1) m = metaReach(date, dayIdx, ai);
        else m = metaRetargeting(date, dayIdx, ai);
        if (m.impressions < 1) return;
        rows.push({
          workspaceId, connectionId: metaConnId, platform: "meta_ads",
          accountId: META_ACCOUNT.accountId, accountName: META_ACCOUNT.accountName,
          campaignId: campaign.campaignId, campaignName: campaign.campaignName,
          adsetId: adset.adsetId, adsetName: adset.adsetName,
          date, currency: META_ACCOUNT.currency, ...m,
        });
      });
    });

    // Google rows
    GOOGLE_CAMPAIGNS.forEach((campaign, ci) => {
      campaign.adsets.forEach((adset, ai) => {
        let m: DayMetrics;
        if (ci === 0) m = googleSearch(date, dayIdx, ai);
        else if (ci === 1) m = googlePMax(date, dayIdx, ai);
        else m = googleDisplay(date, dayIdx, ai);
        if (m.impressions < 1) return;
        rows.push({
          workspaceId, connectionId: googleConnId, platform: "google_ads",
          accountId: GOOGLE_ACCOUNT.accountId, accountName: GOOGLE_ACCOUNT.accountName,
          campaignId: campaign.campaignId, campaignName: campaign.campaignName,
          adsetId: adset.adsetId, adsetName: adset.adsetName,
          date, currency: GOOGLE_ACCOUNT.currency, ...m,
        });
      });
    });
  }

  // ── Batch insert ─────────────────────────────────────────────────────────────
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    await prisma.campaignMetric.createMany({
      data: rows.slice(i, i + BATCH),
      skipDuplicates: true,
    });
    inserted += Math.min(BATCH, rows.length - i);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const byPlatform = { tiktok_business: { impressions: 0, spend: 0, conversions: 0, revenue: 0 },
                       meta_ads:        { impressions: 0, spend: 0, conversions: 0, revenue: 0 },
                       google_ads:      { impressions: 0, spend: 0, conversions: 0, revenue: 0 } };
  rows.forEach((r: any) => {
    const p = byPlatform[r.platform as keyof typeof byPlatform];
    if (p) { p.impressions += r.impressions; p.spend += r.spend; p.conversions += r.conversions; p.revenue += r.revenue; }
  });

  console.log(`\n✅ Seeded ${inserted} rows across ${TOTAL_DAYS} days\n`);
  Object.entries(byPlatform).forEach(([platform, t]) => {
    console.log(`   [${platform}]`);
    console.log(`     Impressions: ${t.impressions.toLocaleString()}`);
    console.log(`     Spend:       $${t.spend.toFixed(2)}`);
    console.log(`     Conversions: ${Math.round(t.conversions).toLocaleString()}`);
    console.log(`     Revenue:     $${t.revenue.toFixed(2)}`);
    console.log(`     Avg ROAS:    ${(t.revenue / t.spend).toFixed(2)}x\n`);
  });
}

main()
  .catch((e) => { console.error("❌ Error:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
