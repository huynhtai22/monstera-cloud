import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/rbac";
import { queryWarehouse } from "@/lib/warehouse-query";

const WAREHOUSE_COLUMNS = ["date", "platform", "accountId", "accountName", "campaignId", "campaignName", "impressions", "clicks", "spend", "cpc", "ctr", "conversions", "roas", "currency"];

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const query = new URL(request.url).searchParams;
  const workspaceId = query.get("workspaceId") ?? "";
  const connectionId = query.get("connectionId") ?? "";
  const startDate = query.get("startDate") ?? "";
  const endDate = query.get("endDate") ?? "";
  const startRow = Number.parseInt(query.get("startRow") ?? "0", 10);
  const endRow = Number.parseInt(query.get("endRow") ?? "100", 10);
  if (!workspaceId || !connectionId || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return NextResponse.json({ error: "workspaceId, connectionId and valid dates are required" }, { status: 400 });
  }
  if (!Number.isFinite(startRow) || !Number.isFinite(endRow) || startRow < 0 || endRow <= startRow || endRow - startRow > 500) {
    return NextResponse.json({ error: "Invalid startRow/endRow (max 500 rows)" }, { status: 400 });
  }
  await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "viewer", operation: "query_warehouse" });
  const connection = await prisma.connection.findFirst({ where: { id: connectionId, workspaceId }, select: { id: true } });
  if (!connection) return NextResponse.json({ error: "Connection not found in workspace" }, { status: 404 });

  const result = await queryWarehouse({
    workspaceId,
    connectionId,
    startDate: new Date(`${startDate}T00:00:00.000Z`),
    endDate: new Date(`${endDate}T23:59:59.999Z`),
    offset: startRow,
    limit: endRow - startRow,
    includeTotalCount: true,
  });
  const rows = result.rows.map((row) => ({ ...row, date: row.date.toISOString().slice(0, 10) }));
  const total = result.totalCount ?? rows.length;
  const lastRow = total === 0 ? 0 : startRow + rows.length >= total ? total - 1 : -1;
  return NextResponse.json({ rows, columns: WAREHOUSE_COLUMNS, lastRow, total, asOf: result.asOf, freshness: result.freshness });
}
