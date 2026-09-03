import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import prisma from "@/lib/prisma";
import { GET } from "./route";

describe("CRON /api/cron/warehouse-refresh", () => {
  const originalCronSecret = process.env.CRON_SECRET;
  let originalWorkspaceFindMany: any;
  let originalConnectionFindMany: any;
  let originalWarehouseImportJob: any;

  beforeEach(() => {
    process.env.CRON_SECRET = "a".repeat(32);
    originalWorkspaceFindMany = prisma.workspace.findMany;
    originalConnectionFindMany = prisma.connection.findMany;
    originalWarehouseImportJob = (prisma as any).warehouseImportJob;

    (prisma.workspace.findMany as any) = async () => [];
    (prisma.connection.findMany as any) = async () => [];
    (prisma as any).warehouseImportJob = {
      findFirst: async () => null,
    };
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalCronSecret;
    prisma.workspace.findMany = originalWorkspaceFindMany;
    prisma.connection.findMany = originalConnectionFindMany;
    (prisma as any).warehouseImportJob = originalWarehouseImportJob;
  });

  it("denies access without valid CRON_SECRET", async () => {
    const req = new Request("http://localhost:3000/api/cron/warehouse-refresh");
    const res = await GET(req);
    assert.equal(res.status, 401);
  });

  it("runs scheduled refresh with 30-day default window and computes stale canary", async () => {
    (prisma.connection.findMany as any) = async () => [
      { id: "conn-stale-1", provider: "meta_ads", lastSyncAt: null },
    ];

    const req = new Request("http://localhost:3000/api/cron/warehouse-refresh", {
      headers: { Authorization: `Bearer ${"a".repeat(32)}` },
    });

    const res = await GET(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.window.lookbackDays, 30);
    assert.equal(body.staleConnectionsCount, 1);
  });
});
