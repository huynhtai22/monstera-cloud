import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getGoogleIdTokenAudienceAllowlist, verifyGoogleIdToken } from "@/lib/google-id-token";

const REPORT_TYPES = new Set(["shopee_products", "shopee_campaigns", "shopee_ads_performance"]);

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const verified = token
    ? await verifyGoogleIdToken(token, { audiences: getGoogleIdTokenAudienceAllowlist() })
    : null;
  if (!verified?.email) return NextResponse.json({ error: "Invalid or expired Google token" }, { status: 401 });

  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
  const reportType = request.nextUrl.searchParams.get("reportType")?.trim() ?? "";
  if (!workspaceId || !REPORT_TYPES.has(reportType)) {
    return NextResponse.json({ error: "workspaceId and a supported reportType are required" }, { status: 400 });
  }
  const user = await prisma.user.findUnique({ where: { email: verified.email }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "No Monstera account found", code: "NO_ACCOUNT" }, { status: 404 });
  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
  if (!member) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });

  const connectionId = request.nextUrl.searchParams.get("connectionId")?.trim() || undefined;
  const commonWhere = { workspaceId, ...(connectionId ? { connectionId } : {}) };
  if (reportType === "shopee_products") {
    const products = await (prisma as any).shopeeProduct.findMany({
      where: commonWhere,
      orderBy: [{ syncedAt: "desc" }, { externalItemId: "asc" }],
      take: 10_000,
    });
    return NextResponse.json({ data: products.map((row: any) => ({
      source: `Shopee ${row.environment === "sandbox" ? "Sandbox" : "Production"}`,
      shopId: row.shopId, region: row.region, lastSynchronizedAt: row.syncedAt.toISOString(),
      itemId: row.externalItemId, itemName: row.itemName ?? "", itemStatus: row.itemStatus ?? "",
      sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? "",
    })) });
  }
  if (reportType === "shopee_campaigns") {
    const campaigns = await (prisma as any).shopeeCampaign.findMany({
      where: commonWhere,
      orderBy: [{ syncedAt: "desc" }, { externalCampaignId: "asc" }],
      take: 10_000,
    });
    return NextResponse.json({ data: campaigns.map((row: any) => ({
      source: `Shopee ${row.environment === "sandbox" ? "Sandbox" : "Production"}`,
      shopId: row.shopId, region: row.region, lastSynchronizedAt: row.syncedAt.toISOString(),
      campaignId: row.externalCampaignId, adType: row.adType, biddingStrategy: row.biddingStrategy ?? "",
      campaignName: row.campaignName ?? "", campaignStatus: row.campaignStatus ?? "",
    })) });
  }
  const startDate = request.nextUrl.searchParams.get("startDate");
  const endDate = request.nextUrl.searchParams.get("endDate");
  const performance = await prisma.campaignMetric.findMany({
    where: {
      ...commonWhere, platform: "shopee",
      ...(startDate && endDate ? { date: { gte: new Date(`${startDate}T00:00:00.000Z`), lte: new Date(`${endDate}T23:59:59.999Z`) } } : {}),
    },
    orderBy: [{ date: "desc" }, { campaignId: "asc" }], take: 10_000,
  });
  const sourceByConnection = new Map<string, string>();
  const sourceRows = await (prisma as any).shopeeCampaign.findMany({ where: commonWhere, select: { connectionId: true, environment: true, shopId: true, region: true, syncedAt: true }, distinct: ["connectionId"] });
  for (const row of sourceRows) sourceByConnection.set(row.connectionId, `${row.environment}|${row.shopId}|${row.region}|${row.syncedAt.toISOString()}`);
  return NextResponse.json({ data: performance.map((row) => {
    const [environment, shopId, region, lastSynchronizedAt] = (sourceByConnection.get(row.connectionId) ?? "unknown||| ").split("|");
    return {
      source: `Shopee ${environment === "sandbox" ? "Sandbox" : environment === "production" ? "Production" : "Unknown"}`,
      shopId, region, lastSynchronizedAt: lastSynchronizedAt?.trim() ?? "", date: row.date.toISOString().slice(0, 10),
      campaignId: row.campaignId, campaignName: row.campaignName, impressions: row.impressions,
      clicks: row.clicks, spend: row.spend, conversions: row.conversions, revenue: row.revenue,
      roas: row.roas, currency: row.currency ?? "", performanceState: "reported",
    };
  }), emptyState: performance.length === 0 ? "No performance data was returned by Shopee for the selected range." : null });
}
