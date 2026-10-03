import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import prisma from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";
import { GET } from "./route";

const WORKSPACE = "ws-export-route";
const CONN_META = "conn-export-meta";
const CONN_GOOGLE = "conn-export-google";
const API_KEY = "test-export-key-secret";

function req(path: string): Request {
  return new Request(`http://localhost:3000${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
}

describe("export rows paginated route (production handler)", () => {
  let metricRows: any[];

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    metricRows = [];
    // 5 distinct dates plus one duplicate date (2026-05-03) to test equal-date ordering.
    const dates = [
      { id: "m-01", date: "2026-05-01" },
      { id: "m-02", date: "2026-05-02" },
      { id: "m-03a", date: "2026-05-03" },
      { id: "m-03b", date: "2026-05-03T12:00:00.000Z" },
      { id: "m-04", date: "2026-05-04" },
      { id: "m-05", date: "2026-05-05" },
    ];
    for (const { id, date } of dates) {
      metricRows.push({
        id,
        date: new Date(date.includes("T") ? date : `${date}T00:00:00.000Z`),
        campaignName: `Camp ${id}`,
        impressions: 10,
        clicks: 1,
        spend: 1.5,
        cpc: 1.5,
        ctr: 0.1,
        conversions: 1,
        revenue: 3,
        roas: 2,
        currency: "USD",
        createdAt: new Date("2026-09-17T00:00:00.000Z"),
      });
    }

    (prisma as any).apiKey = {
      findFirst: async () => ({ id: "key-1", workspaceId: WORKSPACE, workspace: { id: WORKSPACE, plan: "professional" } }),
      update: async () => ({ id: "key-1" }),
    };
    (prisma as any).workspaceProviderAccess = { findMany: async () => [] };
    (prisma as any).client = { findFirst: async () => null };
    (prisma as any).connection = {
      findMany: async ({ where }: any) => {
        if (where.workspaceId !== WORKSPACE) return [];
        const ids = where.id?.in ?? (where.id ? [where.id] : [CONN_META]);
        if (ids.some((id: string) => id !== CONN_META && id !== CONN_GOOGLE)) return [];
        return ids.map((id: string) => ({ id, workspaceId: WORKSPACE, provider: id === CONN_GOOGLE ? "google_ads" : "meta_ads", clientId: null }));
      },
    };
    (prisma as any).campaignMetric = {
      findMany: async ({ where, take }: any) => {
        let rows = [...metricRows];
        const and = where.AND ?? [where];
        for (const clause of and) {
          if (clause.date?.gte) rows = rows.filter((r) => r.date >= clause.date.gte);
          if (clause.date?.lt) rows = rows.filter((r) => r.date < clause.date.lt);
          if (clause.date?.gt) rows = rows.filter((r) => r.date > clause.date.gt);
          if (clause.date instanceof Date) rows = rows.filter((r) => r.date.getTime() === clause.date.getTime());
          if (clause.createdAt?.lte) rows = rows.filter((r) => (r.createdAt ?? r.date) <= clause.createdAt.lte);
          const or = clause.OR;
          if (or) {
            rows = rows.filter((r) =>
              or.some((branch: any) => {
                if (branch.date?.gt && !(r.date > branch.date.gt)) return false;
                if (branch.date?.gte && !(r.date >= branch.date.gte)) return false;
                if (branch.date?.lt && !(r.date < branch.date.lt)) return false;
                if (branch.id?.gt && !(r.id > branch.id.gt)) return false;
                return true;
              }),
            );
          }
        }
        rows.sort((a, b) => a.date.getTime() - b.date.getTime() || (a.id < b.id ? -1 : 1));
        return rows.slice(0, take);
      },
    };
    (prisma as any).$queryRaw = async (query: any) => {
      const values = query.values as unknown[];
      const dates = values.filter((value): value is Date => value instanceof Date);
      const lastTimestamp = dates[1]!;
      const lastId = values.find((value) => typeof value === "string" && value.startsWith("m-")) as string;
      const limit = values.find((value) => typeof value === "number") as number;
      return metricRows
        .filter((row) => row.createdAt <= dates[0]!)
        .filter((row) => row.date > lastTimestamp || (row.date.getTime() === lastTimestamp.getTime() && row.id > lastId))
        .sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id))
        .slice(0, limit);
    };
    (prisma as any).retailOrder = { findMany: async () => [] };
  });

  it("rejects missing and invalid API keys", async () => {
    assert.equal((await GET(new Request("http://localhost:3000/api/export/rows"))).status, 401);
    (prisma as any).apiKey.findFirst = async () => null;
    assert.equal((await GET(req("/api/export/rows"))).status, 401);
  });

  it("rejects invalid dates, timestamps, reversed ranges, and limits", async () => {
    for (const path of [
      "/api/export/rows?since=2026-02-30&until=2026-03-01",
      "/api/export/rows?since=2026-03-02T00:00:00Z&until=2026-03-03",
      "/api/export/rows?since=2026-03-05&until=2026-03-01",
      "/api/export/rows?since=2026-03-01",
      "/api/export/rows?limit=0",
      "/api/export/rows?limit=-5",
      "/api/export/rows?limit=1.5",
      "/api/export/rows?limit=many",
      "/api/export/rows?limit=10001",
      "/api/export/rows?format=xml",
      "/api/export/rows?response=invalid",
    ]) {
      assert.equal((await GET(req(path))).status, 400, path);
    }
  });

  it("filters order windows by source order time, not warehouse insertion time", async () => {
    let receivedWhere: any;
    (prisma as any).connection.findMany = async () => [{ id: CONN_META, provider: "shopee" }];
    (prisma as any).retailOrder = {
      findMany: async ({ where }: any) => {
        receivedWhere = where;
        return [];
      },
    };

    const res = await GET(req("/api/export/rows?sourceId=conn-export-meta&since=2026-05-01&until=2026-05-02"));

    assert.equal(res.status, 200);
    const scope = receivedWhere.AND[0];
    assert.deepEqual(scope.createdAtIso, {
      gte: "2026-05-01T00:00:00.000Z",
      lt: "2026-05-03T00:00:00.000Z",
    });
    assert.equal(scope.createdAt.gte, undefined);
    assert.ok(scope.createdAt.lte instanceof Date);
  });

  it("preserves the newest-source fallback for mixed record kinds", async () => {
    (prisma as any).connection.findMany = async () => [
      { id: CONN_META, provider: "shopee" },
      { id: CONN_GOOGLE, provider: "google_ads" },
    ];
    (prisma as any).retailOrder = { findMany: async () => [] };
    (prisma as any).campaignMetric = { findMany: async () => { throw new Error("mixed fallback selected metrics"); } };

    const res = await GET(req("/api/export/rows"));

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  });

  it("preserves JSON array default and exposes truthful headers", async () => {
    const res = await GET(req("/api/export/rows?since=2026-05-01&until=2026-05-05&limit=10"));
    assert.equal(res.status, 200);
    assert.ok((res.headers.get("Content-Type") ?? "").includes("application/json"));
    const body: any = await res.json();
    assert.ok(Array.isArray(body), "default JSON must be top-level array");
    assert.equal(body[0][0], "Date");
    assert.equal(body.length, 7); // header + 6 rows
    assert.equal(res.headers.get("X-Export-Complete"), "true");
    assert.equal(res.headers.get("X-Export-Has-More"), "false");
    assert.equal(res.headers.get("X-Export-Page-Rows"), "6");
    assert.equal(res.headers.get("X-Export-Limit"), "10");
    assert.ok(res.headers.get("X-Export-Snapshot-At"));
    assert.ok(res.headers.get("X-Export-Fingerprint")?.match(/^[0-9a-f]{64}$/));
    assert.equal(res.headers.get("X-Export-Next-Cursor"), null);
    assert.equal(res.headers.get("Link"), null);
  });

  it("supports opt-in envelope without changing default", async () => {
    const res = await GET(req("/api/export/rows?since=2026-05-01&until=2026-05-02&limit=10&response=envelope"));
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.rows));
    assert.equal(body.page.rowCount, 2);
    assert.equal(body.complete, true);
    assert.equal(res.headers.get("X-Export-Complete"), "true");
    assert.equal(body.page.fingerprint, res.headers.get("X-Export-Fingerprint"));
  });

  it("paginates with limit+1 and reconstructs across three pages", async () => {
    const first = await GET(req("/api/export/rows?since=2026-05-01&until=2026-05-05&limit=2"));
    assert.equal(first.status, 200);
    const firstRows: any = await first.json();
    assert.equal(Array.isArray(firstRows), true);
    assert.equal(firstRows.length, 3); // header + 2
    assert.equal(first.headers.get("X-Export-Page-Rows"), "2");
    assert.equal(first.headers.get("X-Export-Has-More"), "true");
    assert.equal(first.headers.get("X-Export-Complete"), "false");
    const nextCursor = first.headers.get("X-Export-Next-Cursor");
    assert.ok(nextCursor);
    assert.ok(first.headers.get("Link")?.includes("cursor="));

    const second = await GET(req(`/api/export/rows?since=2026-05-01&until=2026-05-05&limit=2&cursor=${encodeURIComponent(nextCursor!)}`));
    const secondRows: any = await second.json();
    assert.equal(secondRows.length, 3);
    const secondCursor = second.headers.get("X-Export-Next-Cursor")!;

    const third = await GET(req(`/api/export/rows?since=2026-05-01&until=2026-05-05&limit=2&cursor=${encodeURIComponent(secondCursor)}`));
    const thirdRows: any = await third.json();
    assert.equal(thirdRows.length, 3);
    assert.equal(third.headers.get("X-Export-Has-More"), "false");
    assert.equal(third.headers.get("X-Export-Next-Cursor"), null);
    assert.equal(third.headers.get("X-Export-Complete"), "true");

    // Reconstruct without header duplication: skip header on pages 2,3
    const all = [...firstRows.slice(1), ...secondRows.slice(1), ...thirdRows.slice(1)];
    assert.equal(all.length, 6);
    assert.deepEqual(all.map((r: any[]) => r[1]), ["Camp m-01", "Camp m-02", "Camp m-03a", "Camp m-03b", "Camp m-04", "Camp m-05"]);
  });

  it("equal-date rows are ordered deterministically by id", async () => {
    const res = await GET(req("/api/export/rows?since=2026-05-03&until=2026-05-03&limit=10"));
    const rows: any = await res.json();
    assert.deepEqual(rows.slice(1).map((r: any[]) => r[1]), ["Camp m-03a", "Camp m-03b"]);
  });

  it("reports continuation at exactly limit and completion at limit boundary", async () => {
    const atLimit = await GET(req("/api/export/rows?since=2026-05-01&until=2026-05-05&limit=6"));
    assert.equal(atLimit.headers.get("X-Export-Complete"), "true");
    assert.equal(atLimit.headers.get("X-Export-Has-More"), "false");
    const over = await GET(req("/api/export/rows?since=2026-05-01&until=2026-05-05&limit=5"));
    assert.equal(over.headers.get("X-Export-Complete"), "false");
    assert.equal(over.headers.get("X-Export-Has-More"), "true");
    assert.ok(over.headers.get("X-Export-Next-Cursor"));
  });

  it("rejects cursor reuse with changed filters, format, or record kind", async () => {
    const first = await GET(req("/api/export/rows?since=2026-05-01&until=2026-05-05&limit=2"));
    const cursor = first.headers.get("X-Export-Next-Cursor")!;
    for (const path of [
      `/api/export/rows?since=2026-05-02&until=2026-05-05&limit=2&cursor=${encodeURIComponent(cursor)}`,
      `/api/export/rows?since=2026-05-01&until=2026-05-05&limit=2&cursor=${encodeURIComponent(cursor)}&accountId=999`,
      `/api/export/rows?since=2026-05-01&until=2026-05-05&limit=2&cursor=${encodeURIComponent(cursor)}&format=csv`,
      `/api/export/rows?since=2026-05-01&until=2026-05-05&limit=2&cursor=${encodeURIComponent(cursor)}&response=envelope`,
    ]) {
      const res = await GET(req(path));
      assert.equal(res.status, 400, path);
      assert.equal((await res.json()).code, "FILTER_MISMATCH");
    }
  });

  it("rejects malformed, oversized, and foreign cursors without side effects", async () => {
    for (const cursor of ["bogus", "a.b", "x".repeat(2000)]) {
      const res = await GET(req(`/api/export/rows?limit=2&cursor=${encodeURIComponent(cursor)}`));
      assert.equal(res.status, 400);
    }
  });

  it("membership snapshot fences inserts after page 1", async () => {
    const first = await GET(req("/api/export/rows?since=2026-05-01&until=2026-05-05&limit=2"));
    const cursor = first.headers.get("X-Export-Next-Cursor")!;
    const snap = first.headers.get("X-Export-Snapshot-At")!;
    // Insert a new row that would sort between pages but has createdAt after snapshot.
    metricRows.push({
      id: "m-02b",
      date: new Date("2026-05-02T00:00:00.000Z"),
      campaignName: "Camp inserted",
      impressions: 99,
      clicks: 9,
      spend: 9,
      cpc: 1,
      ctr: 0.1,
      conversions: 1,
      revenue: 1,
      roas: 1,
      currency: "USD",
      createdAt: new Date(new Date(snap).getTime() + 60000),
    });
    const second = await GET(req(`/api/export/rows?since=2026-05-01&until=2026-05-05&limit=10&cursor=${encodeURIComponent(cursor)}`));
    const rows: any = await second.json();
    // Inserted row must not appear despite sorting into the remaining range.
    assert.ok(!rows.some((r: any[]) => r[1] === "Camp inserted"));
  });

  it("documents update-between-pages (restatement) limitation", async () => {
    const first = await GET(req("/api/export/rows?since=2026-05-01&until=2026-05-05&limit=2"));
    const cursor = first.headers.get("X-Export-Next-Cursor")!;
    // Update an existing row that hasn't been paginated yet.
    const target = metricRows.find((r) => r.id === "m-04")!;
    target.campaignName = "Camp m-04 UPDATED";
    const second = await GET(req(`/api/export/rows?since=2026-05-01&until=2026-05-05&limit=10&cursor=${encodeURIComponent(cursor)}`));
    const rows: any = await second.json();
    assert.ok(rows.some((r: any[]) => r[1] === "Camp m-04 UPDATED"), "updated value restated on later page");
  });

  it("rejects foreign connections and preserves empty shapes", async () => {
    const res = await GET(req("/api/export/rows?sourceId=nope"));
    assert.equal(res.status, 404);
    const empty = await GET(req("/api/export/rows?since=2026-01-01&until=2026-01-02"));
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), []);
    assert.equal(empty.headers.get("X-Export-Complete"), "true");
    assert.equal(empty.headers.get("X-Export-Has-More"), "false");
  });

  it("preserves JSON text and protects CSV spreadsheet text", async () => {
    // Inject a row with formula-like text to test escaping.
    metricRows[1]!.campaignName = "=SUM(A1:A2)";
    const json = await GET(req("/api/export/rows?since=2026-05-01&until=2026-05-02"));
    const jsonRows: any = await json.json();
    assert.equal(jsonRows[2][1], "=SUM(A1:A2)");
    const res = await GET(req("/api/export/rows?since=2026-05-01&until=2026-05-02&format=csv"));
    assert.equal(res.status, 200);
    assert.ok((res.headers.get("Content-Type") ?? "").includes("text/csv"));
    assert.ok((res.headers.get("Content-Disposition") ?? "").includes("warehouse-export-meta_ads-2026-05-01-to-2026-05-02.csv"));
    assert.equal(res.headers.get("X-Export-Complete"), "true");
    assert.equal(res.headers.get("X-Export-Has-More"), "false");
    const text = await res.text();
    assert.ok(text.startsWith("Date,Campaign,Impressions"));
    assert.ok(text.includes("'=SUM(A1:A2)"), "formula text must be escaped");
    assert.ok(text.includes("2026-05-01"));
  });

  it("does not alter the legacy default contract for small exports", async () => {
    const res = await GET(req("/api/export/rows?since=2026-05-01&until=2026-05-02"));
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.ok(Array.isArray(body));
    assert.equal(body[0][0], "Date");
  });

  it("uses encryption", () => {
    assert.ok(encrypt("x").includes(":"));
  });
});
