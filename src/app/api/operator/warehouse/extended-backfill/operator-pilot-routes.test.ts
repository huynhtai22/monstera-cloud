import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { setAuthSessionOverride } from "@/lib/auth-session";
import { POST as planPost } from "./plan/route";
import { POST as jobsPost } from "./jobs/route";
import { GET as jobGet } from "./jobs/[id]/route";
import { POST as pausePost } from "./jobs/[id]/pause/route";
import { POST as resumePost } from "./jobs/[id]/resume/route";
import { POST as cancelPost } from "./jobs/[id]/cancel/route";
import { POST as executePost } from "./jobs/[id]/execute/route";

const OPERATOR = "user-pilot-operator";
const OWNER = "user-pilot-owner";
const WS = "ws-pilot-allowed";
const OTHER_WS = "ws-pilot-other";
const CONN = "conn-pilot-meta";

function post(handler: (req: any, ctx?: any) => Promise<Response | null>, body: unknown, jobId?: string) {
  const req = new NextRequest("http://localhost:3000/api/operator/warehouse/extended-backfill/x", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  const ctx = jobId ? { params: Promise.resolve({ id: jobId }) } : undefined;
  return handler(req, ctx as any).then(async (res) => {
    assert.ok(res, "handler must return a response");
    return { res, body: await res.json().catch(() => ({})) };
  });
}

describe("operator pilot routes (production handlers)", () => {
  const jobs = new Map<string, any>();
  const chunks: any[] = [];
  const audits: any[] = [];
  const writes = { jobs: 0, chunks: 0, audits: 0 };

  function asUser(id: string | null, platformRole = "USER") {
    setAuthSessionOverride(async () =>
      id ? { user: { id, email: `${id}@example.test` }, expires: new Date(Date.now() + 86_400_000).toISOString() } : null,
    );
    (prisma as any).user = {
      findFirst: async ({ where }: any) =>
        where.id === id && platformRole === "OPERATOR" ? { id } : null,
    };
  }

  beforeEach(() => {
    jobs.clear();
    chunks.length = 0;
    audits.length = 0;
    writes.jobs = 0;
    writes.chunks = 0;
    writes.audits = 0;
    process.env.EXTENDED_BACKFILL_STAGE = "staging";
    process.env.EXTENDED_BACKFILL_ALLOWED_WORKSPACE_IDS = WS;
    for (const key of [
      "EXTENDED_BACKFILL_MAX_ACTIVE_JOBS_PER_WORKSPACE",
      "EXTENDED_BACKFILL_MAX_CHUNKS_PER_JOB",
      "EXTENDED_BACKFILL_MAX_PROVIDER_CALLS_PER_DAY",
      "EXTENDED_BACKFILL_MAX_CONCURRENT_CHUNKS_PER_WORKSPACE",
      "EXTENDED_BACKFILL_MAX_CONCURRENT_CHUNKS_PER_ACCOUNT",
    ]) {
      delete process.env[key];
    }
    asUser(OPERATOR, "OPERATOR");

    (prisma as any).workspace = {
      findUnique: async ({ where }: any) =>
        where.id === WS || where.id === OTHER_WS ? { id: where.id } : null,
    };
    (prisma as any).connection = {
      findFirst: async ({ where }: any) => {
        if (where.id === CONN && where.workspaceId === WS) return { id: CONN };
        if (where.id === "conn-meta" && where.workspaceId === WS) return { id: "conn-meta" };
        if (where.id === "conn-other" && where.workspaceId === OTHER_WS) return { id: "conn-other" };
        return null;
      },
    };
    (prisma as any).warehouseImportJob = {
      findUnique: async ({ where }: any) => {
        if (where.workspaceId_idempotencyKey) {
          const { workspaceId, idempotencyKey } = where.workspaceId_idempotencyKey;
          for (const job of jobs.values()) {
            if (job.workspaceId === workspaceId && job.idempotencyKey === idempotencyKey) return job;
          }
        }
        if (where.id) return jobs.get(where.id) ?? null;
        return null;
      },
      findFirst: async ({ where }: any) => {
        if (where.id) {
          const job = jobs.get(where.id) ?? null;
          if (job && where.workspaceId && job.workspaceId !== where.workspaceId) return null;
          return job;
        }
        return null;
      },
      findMany: async ({ where }: any) => {
        let rows = [...jobs.values()];
        if (where.workspaceId) rows = rows.filter((job) => job.workspaceId === where.workspaceId);
        if (where.status?.in) rows = rows.filter((job) => where.status.in.includes(job.status));
        return rows;
      },
      count: async ({ where }: any) => {
        let rows = [...jobs.values()];
        if (where.workspaceId) rows = rows.filter((job) => job.workspaceId === where.workspaceId);
        if (where.status?.in) rows = rows.filter((job) => where.status.in.includes(job.status));
        if (where.idempotencyKey?.startsWith) {
          rows = rows.filter((job) => String(job.idempotencyKey ?? "").startsWith(where.idempotencyKey.startsWith));
        }
        return rows.length;
      },
      create: async ({ data }: any) => {
        writes.jobs += 1;
        const record = { ...data, createdAt: new Date(), updatedAt: new Date(), retryCount: 0, maxRetries: 3, completedItems: 0, approximateRows: 0, startedAt: null, finishedAt: null, heartbeatAt: null, leaseId: null, leaseExpiresAt: null, errorMsg: null, results: [] };
        jobs.set(record.id, record);
        return record;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const [id, job] of jobs.entries()) {
          if (where.id && job.id !== where.id) continue;
          if (where.workspaceId && job.workspaceId !== where.workspaceId) continue;
          if (where.status && typeof where.status === "string" && job.status !== where.status) continue;
          if (where.status?.in && !where.status.in.includes(job.status)) continue;
          jobs.set(id, { ...job, ...data, updatedAt: new Date() });
          count += 1;
        }
        return { count };
      },
    };
    (prisma as any).warehouseBackfillChunk = {
      findMany: async ({ where }: any) => {
        let rows = [...chunks];
        if (where.workspaceId) rows = rows.filter((c) => c.workspaceId === where.workspaceId);
        if (where.jobId) rows = rows.filter((c) => c.jobId === where.jobId);
        if (where.status && typeof where.status === "string") rows = rows.filter((c) => c.status === where.status);
        if (where.status?.in) rows = rows.filter((c) => where.status.in.includes(c.status));
        if (where.completedAt?.gte) rows = rows.filter((c) => c.completedAt && c.completedAt >= where.completedAt.gte);
        if (where.leaseExpiresAt?.lt) rows = rows.filter((c) => c.leaseExpiresAt && c.leaseExpiresAt < where.leaseExpiresAt.lt);
        return [...rows].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
      },
      findFirst: async ({ where }: any) => {
        const rows = await (prisma as any).warehouseBackfillChunk.findMany({ where });
        if (where.id) return rows.find((c: any) => c.id === where.id) ?? null;
        return rows[0] ?? null;
      },
      count: async ({ where }: any) => (await (prisma as any).warehouseBackfillChunk.findMany({ where })).length,
      createMany: async ({ data }: any) => {
        writes.chunks += (Array.isArray(data) ? data : [data]).length;
        chunks.push(...(Array.isArray(data) ? data : [data]).map((row: any) => ({
          ...row, attempts: 0, maxAttempts: 3, persistedRows: 0, leaseId: null, leaseExpiresAt: null,
          fencingToken: BigInt(0), lastErrorCode: null, lastError: null, heartbeatAt: null,
          startedAt: null, completedAt: null,
        })));
        return { count: Array.isArray(data) ? data.length : 1 };
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const chunk of chunks) {
          if (where.id && chunk.id !== where.id) continue;
          if (where.workspaceId && chunk.workspaceId !== where.workspaceId) continue;
          if (where.jobId && chunk.jobId !== where.jobId) continue;
          if (where.status && typeof where.status === "string" && chunk.status !== where.status) continue;
          if (where.status?.in && !where.status.in.includes(chunk.status)) continue;
          if (where.leaseId && chunk.leaseId !== where.leaseId) continue;
          Object.assign(chunk, data);
          count += 1;
        }
        return { count };
      },
    };
    (prisma as any).campaignMetric = { count: async () => 0 };
    (prisma as any).auditEvent = {
      create: async ({ data }: any) => {
        writes.audits += 1;
        assert.ok(!JSON.stringify(data).toLowerCase().includes("token"));
        audits.push(data);
        return data;
      },
    };
    (prisma as any).$transaction = async (fn: any) => (typeof fn === "function" ? fn(prisma) : fn);
    (prisma as any).$executeRaw = async () => [{ pg_advisory_xact_lock: true }];
  });

  const range90 = { workspaceId: WS, provider: "google_ads", connectionId: CONN, since: "2026-06-01", until: "2026-08-29" };

  it("rejects anonymous (401), member, owner, and admin without OPERATOR (403)", async () => {
    asUser(null);
    assert.equal((await post(planPost, range90)).res.status, 401);
    for (const id of ["member-x", OWNER, "admin-x"]) {
      asUser(id, "USER");
      const { res, body } = await post(planPost, range90);
      assert.equal(res.status, 403);
      assert.ok(!body.code || body.code !== "OK");
    }
    assert.equal(writes.jobs, 0);
    assert.equal(writes.chunks, 0);
  });

  it("rejects wrong-workspace operator job access", async () => {
    const created = await post(jobsPost, { ...range90, observedRowsPerDay: 10, bytesPerRow: 100 });
    assert.equal(created.res.status, 201);
    const jobId = created.body.job.id as string;
    const req = new NextRequest(
      `http://localhost:3000/api/operator/warehouse/extended-backfill/jobs/${jobId}?workspaceId=${OTHER_WS}`,
    );
    const res = await jobGet(req, { params: Promise.resolve({ id: jobId }) } as any);
    assert.equal(res.status, 404);
    const crossPause = await post(pausePost, { workspaceId: OTHER_WS }, jobId);
    assert.equal(crossPause.res.status, 404);
  });

  it("refuses request-smuggled stage and unknown keys", async () => {
    for (const body of [
      { ...range90, stage: "production_pilot" },
      { ...range90, EXTENDED_BACKFILL_STAGE: "production_pilot" },
      { ...range90, allowlist: [WS] },
    ]) {
      const { res } = await post(planPost, body);
      assert.equal(res.status, 400);
    }
    assert.equal(writes.jobs, 0);
    assert.equal(writes.chunks, 0);
  });

  it("plan has zero persistent side effects and needs no writes", async () => {
    const { res, body } = await post(planPost, range90);
    assert.equal(res.status, 200);
    assert.equal(body.decision.provider, "google_ads");
    assert.equal(body.plan.chunkCount, 3);
    assert.equal(writes.jobs, 0);
    assert.equal(writes.chunks, 0);
    assert.equal(writes.audits, 0);
  });

  it("plan rejects over-maximum and unknown providers without writes", async () => {
    const over = await post(planPost, { ...range90, since: "2022-02-28", until: "2024-02-29" });
    assert.equal(over.res.status, 200);
    assert.equal(over.body.decision.reasonCode, "RANGE_EXCEEDS_PILOT_MAXIMUM");
    const unknown = await post(planPost, { ...range90, provider: "tiktok_business" });
    assert.equal(unknown.body.decision.reasonCode, "PROVIDER_INELIGIBLE");
    assert.equal(writes.jobs, 0);
    assert.equal(writes.chunks, 0);
    assert.equal(writes.audits, 0);
  });

  it("creates admitted jobs idempotently and audits once per creation", async () => {
    const first = await post(jobsPost, { ...range90, observedRowsPerDay: 10, bytesPerRow: 100 });
    assert.equal(first.res.status, 201);
    assert.equal(first.body.reused, false);
    assert.equal(first.body.chunks.length, 3);
    const second = await post(jobsPost, { ...range90, observedRowsPerDay: 10, bytesPerRow: 100 });
    assert.equal(second.res.status, 200);
    assert.equal(second.body.reused, true);
    assert.equal(second.body.job.id, first.body.job.id);
    assert.equal(writes.jobs, 1);
    assert.equal(writes.chunks, 3);
    assert.equal(audits.filter((a) => a.action === "pilot.extended_backfill.job_created").length, 1);
  });

  it("rejects non-allowlisted workspaces with zero side effects", async () => {
    const { res, body } = await post(jobsPost, { ...range90, workspaceId: OTHER_WS, connectionId: "conn-other", observedRowsPerDay: 10, bytesPerRow: 100 });
    assert.equal(res.status, 422);
    assert.equal(body.code, "WORKSPACE_NOT_ALLOWLISTED");
    assert.equal(writes.jobs, 0);
    assert.equal(writes.chunks, 0);
  });

  it("rejects unavailable and unknown providers with zero side effects", async () => {
    for (const provider of ["amazon", "shopify", "unknown_xyz", "tiktok_business"]) {
      const { res } = await post(jobsPost, { ...range90, provider, observedRowsPerDay: 10, bytesPerRow: 100 });
      assert.ok([400, 422].includes(res.status), provider);
    }
    assert.equal(writes.jobs, 0);
    assert.equal(writes.chunks, 0);
    assert.equal(jobs.size, 0);
  });

  it("pauses, resumes, and cancels idempotently with audits", async () => {
    const created = await post(jobsPost, { ...range90, observedRowsPerDay: 10, bytesPerRow: 100 });
    const jobId = created.body.job.id;
    const pause1 = await post(pausePost, { workspaceId: WS }, jobId);
    assert.equal(pause1.res.status, 200);
    assert.equal(pause1.body.status, "paused");
    const pause2 = await post(pausePost, { workspaceId: WS }, jobId);
    assert.equal(pause2.body.changed, false);
    const resume = await post(resumePost, { workspaceId: WS, observedRowsPerDay: 10, bytesPerRow: 100 }, jobId);
    assert.equal(resume.body.status, "queued");
    const cancel = await post(cancelPost, { workspaceId: WS }, jobId);
    assert.equal(cancel.body.status, "cancelled");
    const cancel2 = await post(cancelPost, { workspaceId: WS }, jobId);
    assert.equal(cancel2.body.changed, false);
    const actions = audits.map((a) => a.action);
    assert.ok(actions.includes("pilot.extended_backfill.job_paused"));
    assert.ok(actions.includes("pilot.extended_backfill.job_resumed"));
    assert.ok(actions.includes("pilot.extended_backfill.job_cancelled"));
    assert.ok(!JSON.stringify(audits).includes("token"));
  });

  it("refuses live execution for synthetic jobs and Meta staging", async () => {
    process.env.EXTENDED_BACKFILL_STAGE = "synthetic";
    const created = await post(jobsPost, { ...range90, provider: "meta_ads", connectionId: "conn-meta", observedRowsPerDay: 10, bytesPerRow: 100 });
    assert.equal(created.res.status, 201);
    const exec = await post(executePost, { workspaceId: WS }, created.body.job.id);
    assert.equal(exec.res.status, 409);
    assert.equal(exec.body.code, "SYNTHETIC_EXECUTION_ONLY");
  });

  it("rejects non-operator mutations and smuggled fields on jobs", async () => {
    asUser(OWNER, "USER");
    const denied = await post(jobsPost, { ...range90, observedRowsPerDay: 10, bytesPerRow: 100 });
    assert.equal(denied.res.status, 403);
    asUser(OPERATOR, "OPERATOR");
    const smuggled = await post(jobsPost, { ...range90, stage: "production_pilot", observedRowsPerDay: 10, bytesPerRow: 100 });
    assert.equal(smuggled.res.status, 400);
    const badDates = await post(jobsPost, { ...range90, since: "2026-09-01", until: "2026-08-01", observedRowsPerDay: 10 });
    assert.equal(badDates.res.status, 400);
    assert.equal(writes.jobs, 0);
    assert.equal(writes.chunks, 0);
  });

  it("inspects pilot jobs with bounded telemetry", async () => {
    const created = await post(jobsPost, { ...range90, observedRowsPerDay: 10, bytesPerRow: 100 });
    assert.equal(created.res.status, 201);
    const jobId = created.body.job.id as string;
    const req = new NextRequest(
      `http://localhost:3000/api/operator/warehouse/extended-backfill/jobs/${jobId}?workspaceId=${WS}`,
    );
    const res = await jobGet(req, { params: Promise.resolve({ id: jobId }) } as any);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.job.id, jobId);
    assert.equal(body.chunks.length, 3);
    assert.equal(body.telemetry.provider, "google_ads");
    assert.equal(body.telemetry.plannedChunks, 3);
    assert.ok(!JSON.stringify(body).includes("synthetic-route-token"));
    asUser(null);
    const anon = await jobGet(req, { params: Promise.resolve({ id: jobId }) } as any);
    assert.equal(anon.status, 401);
  });

  it("reports misconfiguration as 500 with zero side effects", async () => {
    process.env.EXTENDED_BACKFILL_STAGE = "bogus-stage";
    const { res, body } = await post(planPost, range90);
    assert.equal(res.status, 500);
    assert.equal(body.code, "PILOT_MISCONFIGURED");
    assert.equal(writes.jobs, 0);
    assert.equal(writes.chunks, 0);
  });
});
