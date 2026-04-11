import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import crypto from "crypto";

function randBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * POST /api/settings/demo-metrics
 * Seeds demo CampaignMetric rows for a workspace so Looker Studio can be tested.
 *
 * Body: { workspaceId: string, days?: number }
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const workspaceId = String(body.workspaceId || "");
  const days = Math.max(7, Math.min(60, Number(body.days ?? 30)));

  if (!workspaceId) return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: session.user.id } },
    select: { role: true },
  });
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true } });
  if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  const platforms = [
    { platform: "meta_ads", accountId: "act_1234567890", accountName: "Demo Meta Account" },
    { platform: "google_ads", accountId: "123-456-7890", accountName: "Demo Google Ads Account" },
    { platform: "tiktok_business", accountId: "adv_1234567890", accountName: "Demo TikTok Advertiser" },
  ] as const;

  // Ensure 1 source Connection per platform exists
  const connectionsByPlatform: Record<string, { id: string }> = {};
  for (const p of platforms) {
    const existing = await prisma.connection.findFirst({
      where: { workspaceId, type: "source", provider: p.platform },
      select: { id: true },
    });
    const conn =
      existing ??
      (await prisma.connection.create({
        data: {
          workspaceId,
          name: `${p.accountName}`,
          type: "source",
          provider: p.platform,
          credentials: "{}", // demo
          status: "connected",
        },
        select: { id: true },
      }));
    connectionsByPlatform[p.platform] = { id: conn.id };
  }

  // Ensure an API key exists (for Looker Studio connector)
  const existingKey = await prisma.apiKey.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
  });
  const apiKey =
    existingKey ??
    (await prisma.apiKey.create({
      data: {
        key: `mc_${crypto.randomBytes(32).toString("hex")}`,
        name: "Demo Looker Studio Key",
        workspaceId,
      },
    }));

  const today = new Date();
  const rows: any[] = [];

  for (let i = 0; i < days; i++) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));

    for (const p of platforms) {
      for (let c = 1; c <= 5; c++) {
        const impressions = Math.floor(randBetween(2000, 50000));
        const clicks = Math.floor(impressions * randBetween(0.008, 0.03));
        const spend = Number(randBetween(20, 800).toFixed(2));
        const conversions = Number(Math.max(0, Math.floor(clicks * randBetween(0.01, 0.05))));
        const revenue = Number((spend * randBetween(0.6, 2.5)).toFixed(2));
        const cpc = clicks > 0 ? Number((spend / clicks).toFixed(4)) : 0;
        const ctr = impressions > 0 ? Number((clicks / impressions).toFixed(6)) : 0;
        const roas = spend > 0 ? Number((revenue / spend).toFixed(4)) : 0;

        rows.push({
          workspaceId,
          connectionId: connectionsByPlatform[p.platform].id,
          platform: p.platform,
          accountId: p.accountId,
          accountName: p.accountName,
          campaignId: `${p.platform}_cmp_${c}`,
          campaignName: `Demo Campaign ${c} (${p.platform})`,
          adsetId: `${p.platform}_adset_${c}`,
          adsetName: `Demo Adset ${c}`,
          date,
          impressions,
          clicks,
          spend,
          reach: Math.floor(impressions * randBetween(0.4, 0.9)),
          cpc,
          ctr,
          conversions,
          revenue,
          roas,
          currency: "USD",
          rawData: JSON.stringify({ demo: true, date: ymd(date) }),
        });
      }
    }
  }

  // Insert demo rows (skip duplicates based on @@unique(connectionId,campaignId,date))
  const created = await prisma.campaignMetric.createMany({
    data: rows,
    skipDuplicates: true,
  });

  return NextResponse.json({
    ok: true,
    workspaceId,
    workspaceName: workspace.name,
    days,
    rowsAttempted: rows.length,
    rowsInserted: created.count,
    apiKey: apiKey.key,
    next: {
      lookerStudio: "Paste apiKey into connector Key field",
      endpointExample: `https://monsteracloud.com/api/looker-studio?apiKey=${encodeURIComponent(apiKey.key)}&platform=meta_ads&startDate=20260101&endDate=20261231`,
    },
  });
}

