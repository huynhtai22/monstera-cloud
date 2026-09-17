import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { resolveApiKey } from "@/lib/api-key-security";
import {
  warehouseAdsCsvRows,
  warehouseRetailOrdersCsvRows,
  toCsvText,
} from "@/lib/warehouse-csv-export";
import {
  decodeExportCursor,
  encodeExportCursor,
  fingerprintExportQuery,
  ExportCursorError,
  EXPORT_CURSOR_ORDERING,
  EXPORT_ORDERS_CURSOR_ORDERING,
} from "@/lib/warehouse-export-cursor";
import { getCanonicalDateRange } from "@/lib/warehouse-date-range";
import { buildAccountFilterPredicate } from "@/lib/warehouse-account-filter";
import { assertCsvExportAllowed, toPlanLimitResponse } from "@/lib/plan-entitlements";
import {
  assertQueryableClientContext,
  resolveClientContext,
  toClientContextResponse,
  warehouseClientId,
} from "@/lib/client-context-server";

const DEFAULT_PAGE_LIMIT = 1000;
const MAX_PAGE_LIMIT = 10000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function badRequest(message: string, code = "INVALID_REQUEST"): Response {
  return NextResponse.json({ error: message, code }, { status: 400 });
}

function parseLimit(raw: string | null): number {
  if (raw === null || raw === "") return DEFAULT_PAGE_LIMIT;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error("limit must be a bounded positive integer.");
  }
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_LIMIT) {
    throw new Error(`limit must be between 1 and ${MAX_PAGE_LIMIT}.`);
  }
  return value;
}

function sanitizeFilename(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9-_.]+/g, "-").replace(/-+/g, "-").slice(0, 80);
  return cleaned || "export";
}

/**
 * GET /api/export/rows
 *
 * Headers:
 *   Authorization: Bearer mc_xxxxx
 *
 * Query Params:
 *   sourceId (optional): Connection ID to pull from
 *   clientId (optional): Client ID to scope warehouse metrics
 *   since, until (optional pair): strict YYYY-MM-DD export window
 *   accountId, accountIds (optional): provider account filter
 *   limit (optional): bounded page size, default 1000, max 10000
 *   cursor (optional): opaque continuation token from a previous page
 *   format (optional): json (default) or csv
 *   response (optional): array (default, backward compatible) or envelope
 *
 * Purpose: Flattened warehouse data for the Google Sheets Add-on and other
 * API-key integrations. Pagination is globally bounded (limit rows per
 * response, never per connection) and stable (date ASC, id ASC for metrics;
 * createdAt ASC, id ASC for orders) over a membership snapshot. The
 * membership snapshot (createdAt <= snapshotAt) provides a stable membership
 * boundary for newly inserted rows — rows inserted after page 1 do not appear
 * on later pages — but it does NOT provide transaction-consistent historical
 * snapshot of values updated between requests: an existing row may be updated
 * between pages and its restated values will appear on the page where its
 * ordering key falls. No database transaction is held open across requests.
 */
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing or invalid Authorization header" }, { status: 401 });
    }

    const apiKeyString = authHeader.split(" ")[1];

    // 1. Authenticate API Key
    const apiKey = await resolveApiKey(apiKeyString);

    if (!apiKey) {
      return NextResponse.json({ error: "Invalid API Key" }, { status: 401 });
    }

    const workspaceId = apiKey.workspaceId;
    try {
      await assertCsvExportAllowed(apiKey.workspace.plan);
    } catch (error) {
      const planLimit = toPlanLimitResponse(error);
      if (planLimit) return planLimit;
      throw error;
    }

    // 2. Find a Source Connection to pull from (with optional clientId scoping)
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get("sourceId");
    const clientId = searchParams.get("clientId");
    let limit: number;
    try {
      limit = parseLimit(searchParams.get("limit"));
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : "Invalid limit.");
    }
    const formatParam = (searchParams.get("format") ?? "json").toLowerCase();
    if (formatParam !== "json" && formatParam !== "csv") return badRequest("format must be json or csv.");
    const responseParam = (searchParams.get("response") ?? "array").toLowerCase();
    if (responseParam !== "array" && responseParam !== "envelope") return badRequest("response must be array or envelope.");
    const sinceParam = searchParams.get("since");
    const untilParam = searchParams.get("until");
    if ((sinceParam === null) !== (untilParam === null)) return badRequest("since and until must be provided together as YYYY-MM-DD.");
    if (sinceParam !== null && (!DATE_RE.test(sinceParam) || !DATE_RE.test(untilParam!))) return badRequest("since and until must be YYYY-MM-DD.");
    let windowRange: { since: string; until: string } | null = null;
    if (sinceParam && untilParam) {
      try {
        const canonical = getCanonicalDateRange(sinceParam, untilParam);
        windowRange = { since: canonical.since, until: canonical.until };
      } catch (error) {
        return badRequest(error instanceof Error ? error.message : "Invalid date range.");
      }
    }
    const accountIdParam = searchParams.get("accountId");
    const accountIdsParam = searchParams.get("accountIds");
    const requestedAccountIds = [
      ...(accountIdParam ? [accountIdParam] : []),
      ...(accountIdsParam ? accountIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : []),
    ];
    if (requestedAccountIds.some((accountId) => accountId.length > 128)) {
      return badRequest("accountId values must be at most 128 characters.");
    }
    let resolution;
    try {
      resolution = await resolveClientContext({
        workspaceId,
        requestedClientId: clientId,
        surface: "exports",
      });
      assertQueryableClientContext(resolution);
    } catch (error) {
      const clientCtx = toClientContextResponse(error);
      if (clientCtx) return clientCtx;
      throw error;
    }
    const scopedClientId = warehouseClientId(resolution);

    let client = null;
    let isExplicit = false;
    let clientAssignments: Array<{ connectionId: string; provider: string; accountId: string }> = [];

    if (scopedClientId) {
      client = await prisma.client.findFirst({
        where: { id: scopedClientId, workspaceId },
        select: { id: true, accountAssignmentsConfiguredAt: true },
      });
      if (!client) {
        return NextResponse.json({ error: "Client not found or access denied." }, { status: 404 });
      }
      isExplicit = client.accountAssignmentsConfiguredAt !== null;
      if (isExplicit) {
        clientAssignments = await prisma.clientProviderAccountAssignment.findMany({
          where: {
            workspaceId,
            clientId: scopedClientId,
            ...(sourceId ? { connectionId: sourceId } : {}),
          },
          select: { connectionId: true, provider: true, accountId: true },
        });
        if (clientAssignments.length === 0) {
          if (searchParams.get("cursor") !== null) {
            return badRequest("Cursor was issued for a different filter set and cannot be reused.", "FILTER_MISMATCH");
          }
          // Empty assignment scope -> bounded empty result with truthful headers.
          const headers: Record<string, string> = {
            "X-Export-Complete": "true",
            "X-Export-Has-More": "false",
            "X-Export-Page-Rows": "0",
            "X-Export-Limit": String(limit),
            "X-Export-Snapshot-At": new Date().toISOString(),
            "X-Export-Fingerprint": "none",
          };
          const emptyRows: never[] = [];
          if (formatParam === "csv") {
            return new Response(toCsvText(emptyRows as any), {
              status: 200,
              headers: { "Content-Type": "text/csv; charset=utf-8", ...headers },
            });
          }
          const res = NextResponse.json(responseParam === "envelope"
            ? { success: true, rows: emptyRows, page: { rowCount: 0, limit, hasMore: false, nextCursor: null, snapshotAt: headers["X-Export-Snapshot-At"], fingerprint: "none" }, complete: true }
            : emptyRows, { status: 200 });
          for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
          return res;
        }
      }
    }

    // Build connection query that ALWAYS enforces workspace ownership
    const connectionQuery: any = { workspaceId, type: "source" };
    if (sourceId) {
      connectionQuery.id = sourceId;
    }

    if (scopedClientId) {
      if (isExplicit) {
        const assignedConnIds = [...new Set(clientAssignments.map((a) => a.connectionId))];
        connectionQuery.id = sourceId ? sourceId : { in: assignedConnIds };
      } else {
        connectionQuery.clientId = client!.id;
      }
    }

    const sourceConnections = await prisma.connection.findMany({
      where: connectionQuery,
      orderBy: { createdAt: "desc" },
      select: { id: true, provider: true },
    });

    // If sourceId was specified but not found in this workspace, reject
    if (sourceConnections.length === 0 && sourceId) {
      return NextResponse.json({ error: "Connection not found or access denied." }, { status: 404 });
    }

    if (sourceConnections.length === 0) {
      if (scopedClientId) {
        const emptyRows: never[] = [];
        const headers: Record<string, string> = {
          "X-Export-Complete": "true",
          "X-Export-Has-More": "false",
          "X-Export-Page-Rows": "0",
            "X-Export-Limit": String(limit),
          "X-Export-Snapshot-At": new Date().toISOString(),
          "X-Export-Fingerprint": "none",
        };
        if (formatParam === "csv") {
          return new Response(toCsvText(emptyRows as any), {
            status: 200,
            headers: { "Content-Type": "text/csv; charset=utf-8", ...headers },
          });
        }
        const res = NextResponse.json(responseParam === "envelope"
          ? { success: true, rows: emptyRows, page: { rowCount: 0, limit, hasMore: false, nextCursor: null, snapshotAt: headers["X-Export-Snapshot-At"], fingerprint: "none" }, complete: true }
          : emptyRows, { status: 200 });
        for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
        return res;
      }
      return NextResponse.json({ error: "No active source connections found in this workspace." }, { status: 404 });
    }

    const supportedKinds = sourceConnections.map((connection) =>
      connection.provider === "shopee"
        ? "orders"
        : connection.provider === "meta_ads" || connection.provider === "google_ads" || connection.provider === "tiktok_business"
          ? "metrics"
          : null,
    );
    if (supportedKinds.some((kind) => kind === null)) {
      return NextResponse.json(
        { error: "One or more selected source providers are unsupported." },
        { status: 400 },
      );
    }
    const kinds = new Set(supportedKinds);
    if (kinds.size !== 1) {
      return badRequest("A multi-connection export must contain one record kind; select a sourceId.");
    }
    const kind = supportedKinds[0]!;
    const providers = [...new Set(sourceConnections.map((connection) => connection.provider))].sort();
    const sourceConnectionIds = sourceConnections.map((connection) => connection.id);
    const assignmentFingerprintScope = isExplicit
      ? clientAssignments
          .filter((assignment) => sourceConnectionIds.includes(assignment.connectionId))
          .map((assignment) => `assignment:${assignment.connectionId}:${assignment.provider}:${assignment.accountId}`)
      : [];

    // Membership snapshot: rows created after this instant are excluded from
    // the entire traversal. This is a membership boundary only — values of
    // existing rows may be restated between pages.
    const snapshotAt = new Date().toISOString();
    const clientScope = scopedClientId
      ? `${isExplicit ? "explicit" : "legacy"}:${scopedClientId}`
      : "workspace";
    // Record kind and ordering are bound into the fingerprint so a cursor
    // issued for metrics cannot be reused for orders and vice versa.
    const orderingForKind = kind === "orders" ? EXPORT_ORDERS_CURSOR_ORDERING : EXPORT_CURSOR_ORDERING;
    const fingerprintInputBase = {
      workspaceId,
      apiKeyId: apiKey.id,
      since: windowRange?.since ?? null,
      until: windowRange?.until ?? null,
      providers,
      connectionIds: sourceConnectionIds,
      accountIds: [
        ...requestedAccountIds.map((accountId) => `requested:${accountId}`),
        ...assignmentFingerprintScope,
      ].sort(),
      levels: [] as string[],
      ordering: orderingForKind,
      snapshotAt,
      clientScope,
      recordKind: kind,
      format: formatParam,
      responseMode: responseParam,
    };
    const fingerprintInput = fingerprintInputBase;

    // 4. Continuation cursor: verified before any data access.
    // HMAC is tamper-evidence only; workspace/API-key/client predicates are
    // re-derived from server context and re-applied independently.
    let keyset: { lastDate: string; lastId: string; lastTs?: string } | null = null;
    let effectiveSnapshotAt = snapshotAt;
    let fingerprint = fingerprintExportQuery(fingerprintInput);
    const cursorParam = searchParams.get("cursor");
    if (cursorParam !== null) {
      let payload;
      try {
        payload = decodeExportCursor(cursorParam);
      } catch (error) {
        if (error instanceof ExportCursorError) return badRequest(error.message);
        throw error;
      }
      // Ordering version mismatch fails closed even before fingerprint check.
      if (payload.ord !== orderingForKind) {
        return NextResponse.json(
          { error: "Cursor ordering does not match this export kind.", code: "FILTER_MISMATCH" },
          { status: 400 },
        );
      }
      const boundFingerprint = fingerprintExportQuery({ ...fingerprintInput, snapshotAt: payload.snap });
      if (payload.fp !== boundFingerprint) {
        return NextResponse.json(
          { error: "Cursor was issued for a different filter set and cannot be reused.", code: "FILTER_MISMATCH" },
          { status: 400 },
        );
      }
      keyset = { lastDate: payload.lastDate, lastId: payload.lastId };
      if (payload.lastTs !== undefined) {
        (keyset as { lastTs?: string }).lastTs = payload.lastTs;
      }
      effectiveSnapshotAt = payload.snap;
      fingerprint = payload.fp;
    }

    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    // 5. Build predicates. Tenant/client predicates are re-applied on every
    // page and composed with cursor/date predicates through AND; cursor
    // predicates never replace them. Pagination is globally bounded: a single
    // query fetches at most limit+1 rows total, never limit per connection.
    let rows: Array<Array<string | number>>;
    let pageRowCount = 0;
    let hasMore = false;
    let nextCursor: string | null = null;

    if (kind === "orders") {
      const where: Prisma.RetailOrderWhereInput = {
        AND: [
          {
            workspaceId,
            connectionId: { in: sourceConnectionIds },
            createdAt: windowRange
              ? {
                  gte: new Date(`${windowRange.since}T00:00:00.000Z`),
                  lt: new Date(new Date(`${windowRange.until}T00:00:00.000Z`).getTime() + 86_400_000),
                  lte: new Date(effectiveSnapshotAt),
                }
              : { lte: new Date(effectiveSnapshotAt) },
          },
          // Exact (createdAt, id) keyset: the cursor carries the full last-row
          // timestamp so same-millisecond ties still paginate without gaps.
          ...(keyset?.lastTs
            ? [{ OR: [{ createdAt: { gt: new Date(keyset.lastTs) } }, { createdAt: new Date(keyset.lastTs), id: { gt: keyset.lastId } }] }]
            : []),
        ],
      };
      const orders = await prisma.retailOrder.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit + 1,
        select: { id: true, orderId: true, platform: true, grossRevenue: true, netRevenue: true, currency: true, createdAtIso: true, createdAt: true },
      });
      hasMore = orders.length > limit;
      const page = orders.slice(0, limit);
      // Empty export remains [] (no header) for backward compatibility.
      rows = page.length > 0
        ? warehouseRetailOrdersCsvRows(page.map((order) => ({
            orderId: order.orderId,
            platform: order.platform,
            grossRevenue: order.grossRevenue,
            netRevenue: order.netRevenue,
            currency: order.currency,
            createdAtIso: order.createdAtIso,
          })))
        : [];
      if (hasMore) {
        const last = page[page.length - 1]!;
        nextCursor = encodeExportCursor({
          ord: orderingForKind,
          lastDate: last.createdAt.toISOString().slice(0, 10),
          lastId: last.id,
          lastTs: last.createdAt.toISOString(),
          fp: fingerprint,
          snap: effectiveSnapshotAt,
        });
      }
      pageRowCount = page.length;
    } else {
      let metricWhere: Prisma.CampaignMetricWhereInput;
      let matchingAssignments: Array<{ connectionId: string; provider: string; accountId: string }> = [];
      if (scopedClientId && isExplicit) {
        matchingAssignments = clientAssignments.filter((a) => sourceConnectionIds.includes(a.connectionId));
        if (matchingAssignments.length === 0) {
          const empty: never[] = [];
          const headers: Record<string, string> = {
            "X-Export-Complete": "true",
            "X-Export-Has-More": "false",
            "X-Export-Page-Rows": "0",
            "X-Export-Limit": String(limit),
            "X-Export-Snapshot-At": effectiveSnapshotAt,
            "X-Export-Fingerprint": fingerprint,
          };
          if (formatParam === "csv") {
            return new Response(toCsvText(empty as any), {
              status: 200,
              headers: { "Content-Type": "text/csv; charset=utf-8", ...headers },
            });
          }
          if (responseParam === "envelope") {
            const body = { success: true, rows: empty, page: { rowCount: 0, limit, hasMore: false, nextCursor: null, snapshotAt: effectiveSnapshotAt, fingerprint }, complete: true };
            const res = NextResponse.json(body, { status: 200 });
            for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
            return res;
          }
          const res = NextResponse.json(empty, { status: 200 });
          for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
          return res;
        }
        metricWhere = {
          workspaceId,
          connectionId: { in: sourceConnectionIds },
          OR: matchingAssignments.map((a) => ({
            connectionId: a.connectionId,
            platform: a.provider,
            accountId: a.accountId,
          })),
        };
      } else if (scopedClientId && !isExplicit) {
        metricWhere = {
          workspaceId,
          connectionId: { in: sourceConnectionIds },
          connection: { clientId: client!.id },
        };
      } else {
        metricWhere = {
          workspaceId,
          connectionId: { in: sourceConnectionIds },
        };
      }

      // Requested account filter uses the Meta-aware canonical predicate and
      // is ANDed with (never replaces) the assignment scope above.
      if (requestedAccountIds.length > 0) {
        const accountPredicate = buildAccountFilterPredicate({ accountIds: requestedAccountIds, platforms: providers });
        if (accountPredicate) {
          const existing = metricWhere;
          metricWhere = { AND: [existing, accountPredicate as Prisma.CampaignMetricWhereInput] };
        }
      }

      const dateRange = windowRange
        ? (() => {
            const canonical = getCanonicalDateRange(windowRange.since, windowRange.until);
            return canonical.dbWhereDate;
          })()
        : null;
      const where: Prisma.CampaignMetricWhereInput = {
        AND: [
          metricWhere,
          { createdAt: { lte: new Date(effectiveSnapshotAt) } },
          ...(dateRange ? [{ date: dateRange }] : []),
          // Stable ordering for metrics: exact timestamp ASC, id ASC. The
          // cursor retains the timestamp so intraday rows cannot be skipped
          // or duplicated when the display date is the same.
          ...(keyset?.lastTs
            ? [
                {
                  OR: [
                    { date: { gt: new Date(keyset.lastTs) } },
                    { date: new Date(keyset.lastTs), id: { gt: keyset.lastId } },
                  ],
                },
              ]
            : []),
        ],
      };
      type ExportMetric = {
        id: string; date: Date; campaignName: string; impressions: number; clicks: number;
        spend: number; cpc: number; ctr: number; conversions: number; revenue: number;
        roas: number; currency: string | null;
      };
      let metrics: ExportMetric[];
      if (keyset?.lastTs && requestedAccountIds.length === 0) {
        const predicates: Prisma.Sql[] = [
          Prisma.sql`"workspaceId" = ${workspaceId}`,
          Prisma.sql`"connectionId" IN (${Prisma.join(sourceConnectionIds)})`,
          Prisma.sql`"createdAt" <= ${new Date(effectiveSnapshotAt)}`,
          Prisma.sql`("date", id) > (${new Date(keyset.lastTs)}, ${keyset.lastId})`,
        ];
        if (dateRange) {
          if (dateRange.gte) predicates.push(Prisma.sql`date >= ${dateRange.gte}`);
          if (dateRange.lt) predicates.push(Prisma.sql`date < ${dateRange.lt}`);
        }
        if (scopedClientId && isExplicit) {
          predicates.push(Prisma.sql`("connectionId", platform, "accountId") IN (${Prisma.join(
            matchingAssignments.map((assignment) => Prisma.sql`(${assignment.connectionId}, ${assignment.provider}, ${assignment.accountId})`),
          )})`);
        } else if (scopedClientId) {
          predicates.push(Prisma.sql`EXISTS (SELECT 1 FROM "Connection" AS connection_scope WHERE connection_scope.id = "CampaignMetric"."connectionId" AND connection_scope."workspaceId" = ${workspaceId} AND connection_scope."clientId" = ${client!.id})`);
        }
        metrics = await prisma.$queryRaw<ExportMetric[]>(Prisma.sql`
          SELECT id, date, "campaignName", impressions, clicks, spend, cpc, ctr,
                 conversions, revenue, roas, currency
          FROM "CampaignMetric"
          WHERE ${Prisma.join(predicates, " AND ")}
          ORDER BY date ASC, id ASC
          LIMIT ${limit + 1}
        `);
      } else {
        metrics = await prisma.campaignMetric.findMany({
          where,
          orderBy: [{ date: "asc" }, { id: "asc" }],
          take: limit + 1,
          select: { id: true, date: true, campaignName: true, impressions: true, clicks: true, spend: true, cpc: true, ctr: true, conversions: true, revenue: true, roas: true, currency: true },
        });
      }
      hasMore = metrics.length > limit;
      const page = metrics.slice(0, limit);
      // Empty export remains [] (no header) for backward compatibility.
      rows = page.length > 0
        ? warehouseAdsCsvRows(page.map((metric) => ({
            date: metric.date,
            campaignName: metric.campaignName,
            impressions: metric.impressions,
            clicks: metric.clicks,
            spend: metric.spend,
            cpc: metric.cpc,
            ctr: metric.ctr,
            conversions: metric.conversions,
            revenue: metric.revenue,
            roas: metric.roas,
            currency: metric.currency,
          })))
        : [];
      if (hasMore) {
        const last = page[page.length - 1]!;
        nextCursor = encodeExportCursor({
          lastDate: last.date.toISOString().slice(0, 10),
          lastId: last.id,
          lastTs: last.date.toISOString(),
          fp: fingerprint,
          snap: effectiveSnapshotAt,
        });
      }
      pageRowCount = page.length;
    }

    const complete = !hasMore;
    const filename = sanitizeFilename(
      `warehouse-export-${providers.length === 1 ? providers[0] : "multiple"}-${windowRange ? `${windowRange.since}-to-${windowRange.until}` : "all-dates"}.csv`,
    );
    const baseHeaders: Record<string, string> = {
      "X-Export-Complete": String(complete),
      "X-Export-Has-More": String(hasMore),
      "X-Export-Page-Rows": String(pageRowCount),
      "X-Export-Limit": String(limit),
      "X-Export-Snapshot-At": effectiveSnapshotAt,
      "X-Export-Fingerprint": fingerprint,
      ...(nextCursor ? { "X-Export-Next-Cursor": nextCursor } : {}),
    };
    let response: Response;
    if (formatParam === "csv") {
      response = new Response(toCsvText(rows), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          ...baseHeaders,
        },
      });
    } else if (responseParam === "envelope") {
      response = NextResponse.json(
        {
          success: true,
          rows,
          page: {
            rowCount: pageRowCount,
            limit,
            hasMore,
            nextCursor,
            snapshotAt: effectiveSnapshotAt,
            fingerprint,
          },
          complete,
        },
        { status: 200 },
      );
      for (const [key, value] of Object.entries(baseHeaders)) {
        response.headers.set(key, value);
      }
    } else {
      // Default: preserve top-level array for backward compatibility.
      // Pagination truth is exposed exclusively through headers + Link.
      response = NextResponse.json(rows, { status: 200 });
      for (const [key, value] of Object.entries(baseHeaders)) {
        response.headers.set(key, value);
      }
    }
    if (nextCursor) {
      const nextUrl = new URL(request.url);
      nextUrl.searchParams.set("cursor", nextCursor);
      // Cursor already signed; URL encoding is handled by URL serialization.
      response.headers.set("Link", `<${nextUrl.toString()}>; rel="next"`);
    }
    return response;
  } catch (error) {
    if (error instanceof ExportCursorError) {
      return badRequest(error.message);
    }
    const clientCtx = toClientContextResponse(error);
    if (clientCtx) return clientCtx;
    logger.error("Error in /api/export/rows:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
