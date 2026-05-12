import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

const WAREHOUSE_COLUMNS = [
  "date",
  "platform",
  "accountId",
  "accountName",
  "campaignId",
  "campaignName",
  "impressions",
  "clicks",
  "spend",
  "cpc",
  "ctr",
  "conversions",
  "roas",
  "currency",
];

/**
 * GET /api/data-explorer/warehouse/query
 * Paginated read from CampaignMetric (warehouse) for the Data Explorer grid.
 *
 * Query: workspaceId, connectionId, startDate, endDate, startRow, endRow
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  const connectionId = searchParams.get("connectionId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const startRow = parseInt(searchParams.get("startRow") ?? "0", 10);
  const endRow = parseInt(searchParams.get("endRow") ?? "100", 10);

  if (!workspaceId || !connectionId || !startDate || !endDate) {
    return NextResponse.json(
      { error: "workspaceId, connectionId, startDate, endDate are required" },
      { status: 400 },
    );
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(startDate) || !dateRe.test(endDate)) {
    return NextResponse.json(
      { error: "startDate and endDate must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  if (
    !Number.isFinite(startRow) ||
    !Number.isFinite(endRow) ||
    endRow <= startRow ||
    endRow - startRow > 500
  ) {
    return NextResponse.json(
      { error: "Invalid startRow/endRow (max 500 rows per request)" },
      { status: 400 },
    );
  }

  const member = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId, userId: session.user.id },
    },
  });
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const conn = await prisma.connection.findFirst({
    where: { id: connectionId, workspaceId },
  });
  if (!conn) {
    return NextResponse.json({ error: "Connection not found in workspace" }, { status: 404 });
  }

  const dayStart = new Date(`${startDate}T00:00:00.000Z`);
  const dayEnd = new Date(`${endDate}T23:59:59.999Z`);

  const take = endRow - startRow;

  const [rows, total] = await Promise.all([
    prisma.campaignMetric.findMany({
      where: {
        workspaceId,
        connectionId,
        date: { gte: dayStart, lte: dayEnd },
      },
      orderBy: [{ date: "asc" }, { campaignName: "asc" }],
      skip: startRow,
      take,
    }),
    prisma.campaignMetric.count({
      where: {
        workspaceId,
        connectionId,
        date: { gte: dayStart, lte: dayEnd },
      },
    }),
  ]);

  const out = rows.map((m) => ({
    date: m.date.toISOString().slice(0, 10),
    platform: m.platform,
    accountId: m.accountId,
    accountName: m.accountName ?? "",
    campaignId: m.campaignId,
    campaignName: m.campaignName,
    impressions: m.impressions,
    clicks: m.clicks,
    spend: m.spend,
    cpc: m.cpc ?? "",
    ctr: m.ctr ?? "",
    conversions: m.conversions ?? "",
    roas: m.roas ?? "",
    currency: m.currency,
  }));

  const lastRow =
    total === 0
      ? 0
      : startRow + out.length >= total
        ? total - 1
        : -1;

  return NextResponse.json({
    rows: out,
    columns: WAREHOUSE_COLUMNS,
    lastRow,
    total,
  });
}
