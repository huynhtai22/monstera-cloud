/**
 * Restore a clearly labelled Google Ads sample dataset for one workspace.
 *
 * This is an operator-only, explicit recovery tool. It never touches real
 * Google Ads connections or their warehouse rows. The target workspace name
 * must resolve to exactly one row, otherwise the command refuses to run.
 *
 * Usage:
 *   npm run restore-personal-google-demo -- --workspace-name "Personal Workspace" --confirm RESTORE_GOOGLE_DEMO
 */

import { PrismaClient } from "@prisma/client";
import { encrypt } from "../src/lib/encryption";

const prisma = new PrismaClient();

const DEMO_CONNECTION_NAME = "Demo Google Ads Account";
const DEMO_ACCOUNT = {
  accountId: "120-847-3618",
  accountName: "Monstera Demo — Google Ads",
  currency: "USD",
};

const CAMPAIGNS = [
  {
    id: "15234567890101",
    name: "Search — Brand Keywords",
    adsets: [
      { id: "15234567890201", name: "Brand Exact Match" },
      { id: "15234567890202", name: "Competitor Keywords" },
    ],
  },
  {
    id: "15234567890102",
    name: "Performance Max — Shopping",
    adsets: [
      { id: "15234567890203", name: "All Products Asset Group" },
      { id: "15234567890204", name: "Best Sellers Asset Group" },
    ],
  },
  {
    id: "15234567890103",
    name: "Display — Remarketing",
    adsets: [{ id: "15234567890205", name: "Site Visitors — 14 Days" }],
  },
] as const;

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function deterministicUnit(seed: number): number {
  const raw = Math.sin(seed + 1) * 10_000;
  return raw - Math.floor(raw);
}

function dateDaysAgo(daysAgo: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date;
}

function dailyMetrics(dayIndex: number, campaignIndex: number, adsetIndex: number) {
  const seed = dayIndex * 100 + campaignIndex * 10 + adsetIndex;
  const isWeekend = [0, 6].includes(dateDaysAgo(30 - dayIndex).getUTCDay());
  const campaignMultiplier = campaignIndex === 0 ? 0.28 : campaignIndex === 1 ? 1 : 0.72;
  const baseImpressions = campaignIndex === 0 ? 42_000 : campaignIndex === 1 ? 125_000 : 76_000;
  const impressions = Math.round(baseImpressions * campaignMultiplier * (isWeekend ? 0.8 : 1) * (0.86 + deterministicUnit(seed) * 0.28));
  const ctr = campaignIndex === 0 ? 0.055 + deterministicUnit(seed + 1) * 0.018 : campaignIndex === 1 ? 0.018 + deterministicUnit(seed + 1) * 0.009 : 0.004 + deterministicUnit(seed + 1) * 0.004;
  const clicks = Math.round(impressions * ctr);
  const cpc = campaignIndex === 0 ? 1.2 + deterministicUnit(seed + 2) * 0.6 : campaignIndex === 1 ? 0.75 + deterministicUnit(seed + 2) * 0.35 : 0.35 + deterministicUnit(seed + 2) * 0.15;
  const spend = Number((clicks * cpc).toFixed(2));
  const conversions = Math.round(clicks * (campaignIndex === 0 ? 0.062 : campaignIndex === 1 ? 0.047 : 0.018));
  const revenue = Number((conversions * (campaignIndex === 0 ? 102 : campaignIndex === 1 ? 83 : 61)).toFixed(2));

  return {
    impressions,
    clicks,
    spend,
    reach: Math.round(impressions * (0.78 + deterministicUnit(seed + 3) * 0.16)),
    cpc: Number(cpc.toFixed(4)),
    ctr: Number(ctr.toFixed(6)),
    conversions,
    revenue,
    roas: spend > 0 ? Number((revenue / spend).toFixed(4)) : 0,
  };
}

async function main() {
  const workspaceName = readArg("--workspace-name")?.trim();
  const confirmation = readArg("--confirm");
  if (!workspaceName || confirmation !== "RESTORE_GOOGLE_DEMO") {
    throw new Error('Usage: --workspace-name "Personal Workspace" --confirm RESTORE_GOOGLE_DEMO');
  }

  const workspaces = await prisma.workspace.findMany({
    where: { name: workspaceName },
    select: { id: true, name: true },
    take: 2,
  });
  if (workspaces.length !== 1) {
    throw new Error(`Expected exactly one workspace named "${workspaceName}"; found ${workspaces.length}. No rows were changed.`);
  }
  const workspace = workspaces[0];

  const existing = await prisma.connection.findFirst({
    where: { workspaceId: workspace.id, name: DEMO_CONNECTION_NAME },
    select: { id: true, type: true, provider: true },
  });
  if (existing && (existing.type !== "source" || existing.provider !== "google_ads")) {
    throw new Error(`A non-demo connection already uses "${DEMO_CONNECTION_NAME}". No rows were changed.`);
  }

  const credentials = encrypt(JSON.stringify({
    __monsteraDemoConnection: true,
    customerIds: [DEMO_ACCOUNT.accountId],
  }));
  const connection = existing
    ? await prisma.connection.update({
        where: { id: existing.id },
        data: { credentials, status: "connected", remoteAccountId: DEMO_ACCOUNT.accountId, lastSyncAt: new Date() },
        select: { id: true },
      })
    : await prisma.connection.create({
        data: {
          workspaceId: workspace.id,
          name: DEMO_CONNECTION_NAME,
          type: "source",
          provider: "google_ads",
          status: "connected",
          credentials,
          remoteAccountId: DEMO_ACCOUNT.accountId,
          lastSyncAt: new Date(),
        },
        select: { id: true },
      });

  const rows = [] as Array<{
    workspaceId: string;
    connectionId: string;
    platform: string;
    accountId: string;
    accountName: string;
    campaignId: string;
    campaignName: string;
    adsetId: string;
    adsetName: string;
    level: string;
    entityId: string;
    breakdownHash: string;
    date: Date;
    impressions: number;
    clicks: number;
    spend: number;
    reach: number;
    cpc: number;
    ctr: number;
    conversions: number;
    revenue: number;
    roas: number;
    currency: string;
    rawData: string;
  }>;

  for (let dayIndex = 0; dayIndex < 31; dayIndex += 1) {
    const date = dateDaysAgo(30 - dayIndex);
    CAMPAIGNS.forEach((campaign, campaignIndex) => {
      campaign.adsets.forEach((adset, adsetIndex) => {
        rows.push({
          workspaceId: workspace.id,
          connectionId: connection.id,
          platform: "google_ads",
          accountId: DEMO_ACCOUNT.accountId,
          accountName: DEMO_ACCOUNT.accountName,
          campaignId: campaign.id,
          campaignName: campaign.name,
          adsetId: adset.id,
          adsetName: adset.name,
          level: "adset",
          entityId: adset.id,
          breakdownHash: "none",
          date,
          currency: DEMO_ACCOUNT.currency,
          rawData: JSON.stringify({ demo: true, source: "personal-google-demo-restore" }),
          ...dailyMetrics(dayIndex, campaignIndex, adsetIndex),
        });
      });
    });
  }

  // Replace only this demo connection's rows atomically. If insertion fails,
  // the previous demo data remains intact and real account history is never touched.
  await prisma.$transaction([
    prisma.campaignMetric.deleteMany({ where: { connectionId: connection.id } }),
    prisma.campaignMetric.createMany({ data: rows }),
  ]);
  console.log(JSON.stringify({
    restored: true,
    workspaceName: workspace.name,
    connection: DEMO_CONNECTION_NAME,
    account: DEMO_ACCOUNT.accountName,
    rowsInserted: rows.length,
    earliestDate: rows[0]?.date.toISOString().slice(0, 10),
    latestDate: rows.at(-1)?.date.toISOString().slice(0, 10),
  }));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Google demo restore failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
