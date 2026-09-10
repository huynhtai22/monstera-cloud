import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { queryWarehouse } from "@/lib/warehouse-query";
import {
  assertQueryableClientContext,
  resolveClientContext,
  toClientContextResponse,
  warehouseClientId,
} from "@/lib/client-context-server";

const WAREHOUSE_COLUMNS = ["date", "platform", "accountId", "accountName", "campaignId", "campaignName", "impressions", "clicks", "spend", "cpc", "ctr", "conversions", "roas", "currency"];

export async function GET(request: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const query = new URL(request.url).searchParams;
  const workspaceId = query.get("workspaceId") ?? "";
  const connectionId = query.get("connectionId") ?? "";
  const clientId = query.get("clientId") ?? "";
  const startDate = query.get("startDate") ?? "";
  const endDate = query.get("endDate") ?? "";
  const startRow = Number.parseInt(query.get("startRow") ?? "0", 10);
  const endRow = Number.parseInt(query.get("endRow") ?? "100", 10);
  if (!workspaceId || (!connectionId && !clientId) || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return NextResponse.json({ error: "workspaceId, connectionId or clientId, and valid dates are required" }, { status: 400 });
  }
  if (!Number.isFinite(startRow) || !Number.isFinite(endRow) || startRow < 0 || endRow <= startRow || endRow - startRow > 500) {
    return NextResponse.json({ error: "Invalid startRow/endRow (max 500 rows)" }, { status: 400 });
  }
  try {
    await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "viewer", operation: "query_warehouse" });
  } catch (error) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    throw error;
  }
  if (connectionId) {
    const connection = await prisma.connection.findFirst({ where: { id: connectionId, workspaceId }, select: { id: true } });
    if (!connection) return NextResponse.json({ error: "Connection not found in workspace" }, { status: 404 });
  }
  let scopedClientId: string | undefined;
  try {
    const resolution = await resolveClientContext({
      workspaceId,
      requestedClientId: clientId || null,
      surface: "warehouse",
    });
    assertQueryableClientContext(resolution);
    scopedClientId = warehouseClientId(resolution);
  } catch (error) {
    const clientCtx = toClientContextResponse(error);
    if (clientCtx) return clientCtx;
    throw error;
  }

  const result = await queryWarehouse({
    workspaceId,
    connectionId: connectionId || undefined,
    clientId: scopedClientId,
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
