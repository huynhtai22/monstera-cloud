import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { setAuthSessionOverride } from "@/lib/auth-session";
import { encrypt } from "@/lib/encryption";
import { POST } from "./route";

const USER = "user-batch-guard";
const WORKSPACE = "ws-batch-guard";
const META_CONN = "conn-batch-meta";
const GOOGLE_CONN = "conn-batch-google";

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/data-explorer/warehouse/import-batch", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("import-batch route raw-range guard (production route)", () => {
  let providerCalls = 0;
  let jobCreates = 0;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    providerCalls = 0;
    jobCreates = 0;

    setAuthSessionOverride(async () => ({
      user: { id: USER, email: "batch-guard@example.test" },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    }));

    globalThis.fetch = (async () => {
      providerCalls += 1;
      throw new Error("provider contact forbidden in guard tests");
    }) as unknown as typeof fetch;

    const creds = encrypt(JSON.stringify({ accessToken: "test-token", extraFields: {} }));

    (prisma as any).workspaceMember = {
      findFirst: async ({ where }: any) => {
        if (where.userId === USER && where.workspaceId === WORKSPACE) {
          return { userId: USER, workspaceId: WORKSPACE, role: "member" };
        }
        return null;
      },
    };
    (prisma as any).workspace = {
      // Free plan clamps to 14 days; the guard must reject raw oversized
      // ranges before that clamp can hide them.
      findUnique: async ({ where }: any) => {
        if (where.id === WORKSPACE) return { id: WORKSPACE, ownerId: USER, plan: "free" };
        return null;
      },
    };
    (prisma as any).connection = {
      findMany: async ({ where }: any) => {
        const ids: string[] = where.id?.in ?? [];
        const rows: any[] = [];
        if (ids.includes(META_CONN)) {
          rows.push({ id: META_CONN, workspaceId: WORKSPACE, provider: "meta_ads", credentials: creds, status: "connected" });
        }
        if (ids.includes(GOOGLE_CONN)) {
          rows.push({ id: GOOGLE_CONN, workspaceId: WORKSPACE, provider: "google_ads", credentials: creds, status: "connected" });
        }
        return rows;
      },
    };
    (prisma as any).workspaceProviderAccess = {
      findMany: async () => [
        { provider: "meta_ads", enabled: true },
        { provider: "google_ads", enabled: true },
      ],
    };
    (prisma as any).warehouseImportJob = {
      count: async () => 0,
      create: async () => {
        jobCreates += 1;
        throw new Error("job creation must not happen for rejected ranges");
      },
    };
  });

  async function postBatch(connectionId: string, since: string, until: string, asyncMode = true) {
    const res = await POST(
      req({ workspaceId: WORKSPACE, since, until, items: [{ connectionId }], ...(asyncMode ? { async: true } : {}) }),
    );
    return { res, body: await res.json() };
  }

  const RANGES = [
    ["31-day", "2026-07-01", "2026-07-31", 31],
    ["90-day", "2026-06-01", "2026-08-29", 90],
    ["365-day", "2025-09-17", "2026-09-16", 365],
    ["731-day", "2022-03-01", "2024-02-29", 731],
  ] as const;

  it("rejects Meta 31/90/365/731-day unchunked raw requests with 422 before side effects", async () => {
    for (const [, since, until, expectedDays] of RANGES) {
      const { res, body } = await postBatch(META_CONN, since, until);
      assert.equal(res.status, 422, `${since}..${until} must be rejected`);
      assert.equal(body.code, "REQUEST_CHUNKING_NOT_IMPLEMENTED");
      assert.equal(body.provider, "meta_ads");
      assert.equal(body.maxExecutableDays, 30);
      assert.equal(body.requestedRange.days, expectedDays);
    }
    assert.equal(jobCreates, 0);
    assert.equal(providerCalls, 0);
  });

  it("rejects Google 31/90/365/731-day unchunked raw requests with 422 before side effects", async () => {
    for (const [, since, until, expectedDays] of RANGES) {
      const { res, body } = await postBatch(GOOGLE_CONN, since, until);
      assert.equal(res.status, 422, `${since}..${until} must be rejected`);
      assert.equal(body.code, "REQUEST_CHUNKING_NOT_IMPLEMENTED");
      assert.equal(body.provider, "google_ads");
      assert.equal(body.requestedRange.days, expectedDays);
    }
    assert.equal(jobCreates, 0);
    assert.equal(providerCalls, 0);
  });

  it("preserves valid 30-day behavior (no 422)", async () => {
    const { res } = await postBatch(META_CONN, "2026-07-02", "2026-07-31", false);
    assert.notEqual(res.status, 422);
    const google = await postBatch(GOOGLE_CONN, "2026-07-02", "2026-07-31", false);
    assert.notEqual(google.res.status, 422);
  });
});
