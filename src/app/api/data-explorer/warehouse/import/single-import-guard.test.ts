import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { setAuthSessionOverride } from "@/lib/auth-session";
import { encrypt } from "@/lib/encryption";
import { POST } from "./route";

const USER = "user-single-guard";
const WORKSPACE = "ws-single-guard";
const OTHER_WORKSPACE = "ws-single-guard-other";
const META_CONN = "conn-single-meta";
const GOOGLE_CONN = "conn-single-google";
const TIKTOK_CONN = "conn-single-tiktok";

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/data-explorer/warehouse/import", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("single-import route shared execution guard (production route)", () => {
  let providerCalls = 0;
  let jobCreates = 0;
  let metricWrites = 0;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    providerCalls = 0;
    jobCreates = 0;
    metricWrites = 0;

    setAuthSessionOverride(async () => ({
      user: { id: USER, email: "guard@example.test" },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    }));

    // Any provider contact must go through fetch. Fail loudly so a 422 proves
    // rejection happened before provider contact, while a non-422 proves the
    // guard passed and execution was attempted.
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
      // Free plan would clamp a 90-day request to 14 days if clamping ran
      // first; the guard must reject the raw 90-day request before any clamp.
      findUnique: async ({ where }: any) => {
        if (where.id === WORKSPACE) return { id: WORKSPACE, ownerId: USER, plan: "free" };
        return null;
      },
    };
    (prisma as any).connection = {
      findFirst: async ({ where }: any) => {
        if (where.workspaceId !== WORKSPACE) return null;
        if (where.id === META_CONN) return { provider: "meta_ads", credentials: creds };
        if (where.id === GOOGLE_CONN) return { provider: "google_ads", credentials: creds };
        if (where.id === TIKTOK_CONN) return { provider: "tiktok_business", credentials: creds };
        return null;
      },
    };
    (prisma as any).warehouseImportJob = {
      create: async () => {
        jobCreates += 1;
        throw new Error("job creation forbidden for single-import guard tests");
      },
      count: async () => 0,
    };
    (prisma as any).campaignMetric = {
      create: async () => {
        metricWrites += 1;
        throw new Error("metric write forbidden");
      },
      upsert: async () => {
        metricWrites += 1;
        throw new Error("metric write forbidden");
      },
    };
  });

  async function postMeta(since: string, until: string) {
    const res = await POST(req({ workspaceId: WORKSPACE, connectionId: META_CONN, since, until }));
    const body = await res.json();
    return { res, body };
  }

  async function postGoogle(since: string, until: string) {
    const res = await POST(req({ workspaceId: WORKSPACE, connectionId: GOOGLE_CONN, since, until }));
    const body = await res.json();
    return { res, body };
  }

  it("rejects Meta 31-day raw requests with 422 before any side effect", async () => {
    const { res, body } = await postMeta("2026-07-01", "2026-07-31");
    assert.equal(res.status, 422);
    assert.equal(body.code, "REQUEST_CHUNKING_NOT_IMPLEMENTED");
    assert.equal(body.provider, "meta_ads");
    assert.equal(body.maxExecutableDays, 30);
    assert.equal(body.requestedRange.since, "2026-07-01");
    assert.equal(body.requestedRange.until, "2026-07-31");
    assert.equal(body.requestedRange.days, 31);
    assert.match(String(body.error), /OAuth chunk dispatcher/);
    assert.match(String(body.hint ?? body.error), /Extended checkpointed backfill is not yet enabled|OAuth chunk dispatcher/);
    assert.equal(providerCalls, 0);
    assert.equal(jobCreates, 0);
    assert.equal(metricWrites, 0);
  });

  it("rejects Google 31-day raw requests with 422 before any side effect", async () => {
    const { res, body } = await postGoogle("2026-07-01", "2026-07-31");
    assert.equal(res.status, 422);
    assert.equal(body.code, "REQUEST_CHUNKING_NOT_IMPLEMENTED");
    assert.equal(body.provider, "google_ads");
    assert.equal(body.maxExecutableDays, 30);
    assert.equal(body.requestedRange.days, 31);
    assert.equal(providerCalls, 0);
    assert.equal(jobCreates, 0);
    assert.equal(metricWrites, 0);
  });

  it("rejects Meta/Google 90-day raw requests with 422 even when plan clamping could hide them", async () => {
    for (const post of [postMeta, postGoogle] as const) {
      const { res, body } = await post("2026-06-01", "2026-08-29");
      assert.equal(res.status, 422);
      assert.equal(body.code, "REQUEST_CHUNKING_NOT_IMPLEMENTED");
      assert.equal(body.requestedRange.days, 90);
      assert.equal(body.maxExecutableDays, 30);
    }
    assert.equal(providerCalls, 0);
    assert.equal(jobCreates, 0);
    assert.equal(metricWrites, 0);
  });

  it("rejects Meta/Google 731-day raw requests with 422 without enabling extended execution", async () => {
    for (const post of [postMeta, postGoogle] as const) {
      const { res, body } = await post("2022-03-01", "2024-02-29");
      assert.equal(res.status, 422);
      assert.equal(body.code, "REQUEST_CHUNKING_NOT_IMPLEMENTED");
      assert.equal(body.requestedRange.days, 731);
    }
    assert.equal(providerCalls, 0);
    assert.equal(jobCreates, 0);
  });

  it("rejects Meta/Google 365-day raw requests with 422 before provider contact", async () => {
    for (const post of [postMeta, postGoogle] as const) {
      const { res, body } = await post("2025-09-17", "2026-09-16");
      assert.equal(res.status, 422);
      assert.equal(body.code, "REQUEST_CHUNKING_NOT_IMPLEMENTED");
      assert.equal(body.requestedRange.days, 365);
      assert.equal(body.maxExecutableDays, 30);
    }
    assert.equal(providerCalls, 0);
    assert.equal(jobCreates, 0);
    assert.equal(metricWrites, 0);
  });

  it("proves inclusive semantics: 30 days passes the guard, 31 days fails", async () => {
    // 30 inclusive days must not be rejected as oversized. It proceeds to
    // execution (which hits the forbidden-fetch stub and surfaces as 500),
    // proving the guard passed. 31 days must return 422 without provider contact.
    const ok = await POST(req({ workspaceId: WORKSPACE, connectionId: META_CONN, since: "2026-07-02", until: "2026-07-31" }));
    assert.notEqual(ok.status, 422);
    const okGoogle = await POST(
      req({ workspaceId: WORKSPACE, connectionId: GOOGLE_CONN, since: "2026-07-02", until: "2026-07-31" }),
    );
    assert.notEqual(okGoogle.status, 422);

    providerCalls = 0;
    const blocked = await POST(req({ workspaceId: WORKSPACE, connectionId: META_CONN, since: "2026-07-01", until: "2026-07-31" }));
    assert.equal(blocked.status, 422);
    assert.equal(providerCalls, 0);
  });

  it("preserves existing behavior for valid 30-day Meta/Google (no 422)", async () => {
    const meta = await POST(req({ workspaceId: WORKSPACE, connectionId: META_CONN, since: "2026-07-02", until: "2026-07-31" }));
    assert.notEqual(meta.status, 422);
    const google = await POST(
      req({ workspaceId: WORKSPACE, connectionId: GOOGLE_CONN, since: "2026-07-02", until: "2026-07-31" }),
    );
    assert.notEqual(google.status, 422);
  });

  it("leaves non-Meta/Google behavior unchanged", async () => {
    const res = await POST(
      req({ workspaceId: WORKSPACE, connectionId: TIKTOK_CONN, since: "2026-06-01", until: "2026-08-29" }),
    );
    // TikTok 90-day must not hit the Meta/Google chunk guard.
    assert.notEqual(res.status, 422);
    const body = await res.json().catch(() => ({}));
    assert.notEqual((body as { code?: string }).code, "REQUEST_CHUNKING_NOT_IMPLEMENTED");
  });

  it("uses the canonical date validation response for invalid and reversed dates", async () => {
    const badFormat = await POST(req({ workspaceId: WORKSPACE, connectionId: META_CONN, since: "2024-02-01T00:00:00Z", until: "2024-02-02" }));
    assert.equal(badFormat.status, 400);

    const reversed = await POST(req({ workspaceId: WORKSPACE, connectionId: META_CONN, since: "2026-08-02", until: "2026-08-01" }));
    assert.equal(reversed.status, 400);
    const reversedBody = await reversed.json();
    assert.ok(!("code" in reversedBody) || reversedBody.code !== "REQUEST_CHUNKING_NOT_IMPLEMENTED");

    const impossible = await POST(req({ workspaceId: WORKSPACE, connectionId: META_CONN, since: "2024-02-30", until: "2024-03-01" }));
    assert.equal(impossible.status, 400);
    assert.equal(providerCalls, 0);
    assert.equal(jobCreates, 0);
  });

  it("enforces tenant isolation: foreign workspace connections are not executed", async () => {
    const res = await POST(req({ workspaceId: OTHER_WORKSPACE, connectionId: META_CONN, since: "2026-07-01", until: "2026-07-31" }));
    // RBAC denies foreign workspace before any provider contact.
    assert.ok([403, 404].includes(res.status));
    assert.equal(providerCalls, 0);
    assert.equal(jobCreates, 0);
  });

  it("restores fetch after guard tests", async () => {
    globalThis.fetch = originalFetch;
    assert.equal(typeof globalThis.fetch, "function");
  });
});
