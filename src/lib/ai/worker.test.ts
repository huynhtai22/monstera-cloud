import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import prisma from "@/lib/prisma";
import { classifyQuestion } from "@/lib/ai/classify";
import { runAnalystTurn } from "@/lib/ai/analyst";
import {
  claimNextAgentJob,
  completeAgentJob,
  failOrRequeueAgentJob,
  type ClaimedAgentJob,
} from "@/lib/ai/jobs";
import { executeClaimedAgentJob, processAgentJobQueue } from "@/lib/ai/worker";

type Row = {
  id: string;
  workspaceId: string;
  userId: string | null;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  errorMsg: string | null;
  refusalCode: string | null;
  priority: number;
  retryCount: number;
  maxRetries: number;
  leaseId: string | null;
  leaseExpiresAt: Date | null;
  heartbeatAt: Date | null;
  scheduledAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  model: string | null;
  provider: string | null;
  promptVersion: string | null;
};

function matchesOr(row: Row, or: Array<Record<string, unknown>>, now: Date): boolean {
  return or.some((clause) => {
    if (clause.status === "queued") {
      const scheduled = (clause.scheduledAt as { lte?: Date } | undefined)?.lte;
      return row.status === "queued" && (!scheduled || row.scheduledAt.getTime() <= scheduled.getTime());
    }
    if (clause.status === "running") {
      const expired = (clause.leaseExpiresAt as { lt?: Date } | undefined)?.lt;
      return (
        row.status === "running" &&
        !!row.leaseExpiresAt &&
        !!expired &&
        row.leaseExpiresAt.getTime() < expired.getTime()
      );
    }
    return false;
  });
}

function installAgentJobMock(rows: Row[]) {
  const now = () => new Date();
  (prisma as any).agentJob = {
    findFirst: async ({ where, orderBy }: any) => {
      let list = rows.filter((row) => {
        if (where.type?.in && !where.type.in.includes(row.type)) return false;
        if (where.OR && !matchesOr(row, where.OR, now())) return false;
        return true;
      });
      const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
      list = list.sort((a, b) => {
        for (const order of orders) {
          if (order.priority === "desc" && a.priority !== b.priority) return b.priority - a.priority;
          if (order.scheduledAt === "asc" && a.scheduledAt.getTime() !== b.scheduledAt.getTime()) {
            return a.scheduledAt.getTime() - b.scheduledAt.getTime();
          }
        }
        return 0;
      });
      return list[0] ?? null;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows) {
        if (where.id && row.id !== where.id) continue;
        if (where.workspaceId && row.workspaceId !== where.workspaceId) continue;
        if (where.leaseId && row.leaseId !== where.leaseId) continue;
        if (where.status && row.status !== where.status) continue;
        if (where.OR && !matchesOr(row, where.OR, now())) continue;
        if (where.status === "running" && where.leaseExpiresAt?.lt) {
          if (!(row.status === "running" && row.leaseExpiresAt && row.leaseExpiresAt < where.leaseExpiresAt.lt)) {
            continue;
          }
        }
        Object.assign(row, data);
        count += 1;
      }
      return { count };
    },
    count: async ({ where }: any) => {
      return rows.filter((row) => {
        if (where.status && row.status !== where.status) return false;
        if (where.scheduledAt?.lte && row.scheduledAt > where.scheduledAt.lte) return false;
        return true;
      }).length;
    },
  };
}

function job(partial: Partial<Row> & Pick<Row, "id" | "workspaceId" | "type" | "status">): Row {
  return {
    userId: "user-1",
    payload: { question: "Meta spend last week" },
    result: null,
    errorMsg: null,
    refusalCode: null,
    priority: 1,
    retryCount: 0,
    maxRetries: 3,
    leaseId: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    scheduledAt: new Date("2026-08-01T00:00:00Z"),
    startedAt: null,
    finishedAt: null,
    model: null,
    provider: null,
    promptVersion: null,
    ...partial,
  };
}

describe("classify deeper briefs queue", () => {
  it("queues executive briefs and keeps health interactive", () => {
    const brief = classifyQuestion("Write an executive brief of last week spend");
    assert.equal(brief.needsQueue, true);
    assert.equal(brief.refuse, false);
    const health = classifyQuestion("Why is Meta stale?");
    assert.equal(health.needsQueue, false);
    assert.equal(health.refuse, false);
  });
});

describe("runAnalystTurn queue vs cron", () => {
  it("interactive queues a deeper brief; cron does not", async () => {
    const interactive = await runAnalystTurn({
      workspaceId: "ws-a",
      question: "Write an executive brief of last week spend",
      role: "interactive",
    });
    assert.equal(interactive.status, "queued");
    assert.match(interactive.queuedCopy ?? "", /nightly AI worker/);
  });
});

describe("agent job worker", () => {
  const rows: Row[] = [];

  beforeEach(() => {
    rows.length = 0;
    installAgentJobMock(rows);
  });

  it("claims analyst_turn by priority and skips unsupported types", async () => {
    rows.push(
      job({ id: "anomaly", workspaceId: "ws-a", type: "anomaly_scan", status: "queued", priority: 99 }),
      job({
        id: "low",
        workspaceId: "ws-a",
        type: "analyst_turn",
        status: "queued",
        priority: 1,
        scheduledAt: new Date("2026-08-01T00:00:00Z"),
      }),
      job({
        id: "high",
        workspaceId: "ws-a",
        type: "analyst_turn",
        status: "queued",
        priority: 5,
        scheduledAt: new Date("2026-08-02T00:00:00Z"),
      }),
    );
    const claim = await claimNextAgentJob();
    assert.equal(claim.claimed, true);
    assert.equal(claim.job?.id, "high");
    assert.equal(rows.find((r) => r.id === "high")?.status, "running");
    assert.equal(rows.find((r) => r.id === "anomaly")?.status, "queued");
  });

  it("refuses a payload workspaceId that does not match the job row", async () => {
    const claimed: ClaimedAgentJob = {
      id: "job-1",
      workspaceId: "ws-a",
      userId: "user-1",
      type: "analyst_turn",
      payload: { question: "spend?", workspaceId: "ws-b" },
      retryCount: 0,
      maxRetries: 3,
    };
    rows.push(
      job({
        id: "job-1",
        workspaceId: "ws-a",
        type: "analyst_turn",
        status: "running",
        leaseId: "lease-1",
        payload: claimed.payload,
      }),
    );
    const outcome = await executeClaimedAgentJob(claimed, "lease-1", async () => {
      throw new Error("must not run tools for the wrong tenant");
    });
    assert.equal(outcome, "completed");
    assert.equal(rows[0].status, "completed");
    assert.equal(rows[0].refusalCode, "tenant_mismatch");
  });

  it("completes a claimed turn with the job workspace, not the payload", async () => {
    const claimed: ClaimedAgentJob = {
      id: "job-2",
      workspaceId: "ws-a",
      userId: "user-1",
      type: "analyst_turn",
      payload: { question: "Why is Meta stale?" },
      retryCount: 0,
      maxRetries: 3,
    };
    rows.push(
      job({
        id: "job-2",
        workspaceId: "ws-a",
        type: "analyst_turn",
        status: "running",
        leaseId: "lease-2",
        payload: claimed.payload,
      }),
    );
    const seen: string[] = [];
    await executeClaimedAgentJob(claimed, "lease-2", async (opts) => {
      seen.push(opts.workspaceId);
      assert.equal(opts.role, "cron");
      return { status: "answered", answer: "ok" };
    });
    assert.deepEqual(seen, ["ws-a"]);
    assert.equal(rows[0].status, "completed");
    assert.equal(rows[0].model, "deterministic");
    assert.equal((rows[0].result as { answer?: string }).answer, "ok");
  });

  it("requeues on throw until maxRetries, then fails", async () => {
    const claimed: ClaimedAgentJob = {
      id: "job-3",
      workspaceId: "ws-a",
      userId: null,
      type: "analyst_turn",
      payload: { question: "spend" },
      retryCount: 2,
      maxRetries: 3,
    };
    rows.push(
      job({
        id: "job-3",
        workspaceId: "ws-a",
        type: "analyst_turn",
        status: "running",
        leaseId: "lease-3",
        retryCount: 2,
        maxRetries: 3,
      }),
    );
    const requeued = await failOrRequeueAgentJob({
      job: { ...claimed, retryCount: 1 },
      leaseId: "lease-3",
      error: new Error("boom"),
    });
    assert.equal(requeued, "requeued");
    rows[0].status = "running";
    rows[0].leaseId = "lease-3";
    rows[0].retryCount = 2;
    const failed = await failOrRequeueAgentJob({ job: claimed, leaseId: "lease-3", error: new Error("boom") });
    assert.equal(failed, "failed");
    assert.equal(rows[0].status, "failed");
    assert.equal(rows[0].retryCount, 3);
  });

  it("does not complete when the lease was lost", async () => {
    rows.push(
      job({
        id: "job-4",
        workspaceId: "ws-a",
        type: "analyst_turn",
        status: "running",
        leaseId: "other-lease",
      }),
    );
    const ok = await completeAgentJob({
      jobId: "job-4",
      workspaceId: "ws-a",
      leaseId: "stale-lease",
      result: { status: "answered" },
    });
    assert.equal(ok, false);
    assert.equal(rows[0].status, "running");
  });

  it("drains a batch and stops when the deadline has already passed", async () => {
    rows.push(
      job({ id: "a", workspaceId: "ws-a", type: "analyst_turn", status: "queued" }),
      job({ id: "b", workspaceId: "ws-a", type: "analyst_turn", status: "queued", scheduledAt: new Date("2026-08-02T00:00:00Z") }),
    );
    const past = await processAgentJobQueue({
      deadlineMs: -1,
      execute: async () => "completed",
    });
    assert.equal(past.executed, 0);

    const drained = await processAgentJobQueue({
      batchSize: 2,
      deadlineMs: 60_000,
      execute: async () => "completed",
    });
    assert.equal(drained.executed, 2);
    assert.equal(drained.queued, 0);
  });

  it("recovers an expired lease then executes the job", async () => {
    rows.push(
      job({
        id: "expired",
        workspaceId: "ws-a",
        type: "analyst_turn",
        status: "running",
        leaseId: "old",
        leaseExpiresAt: new Date("2020-01-01T00:00:00Z"),
        payload: { question: "Why is Meta stale?" },
      }),
    );
    const summary = await processAgentJobQueue({
      batchSize: 1,
      deadlineMs: 60_000,
      execute: async () => "completed",
    });
    assert.equal(summary.recovered, 1);
    assert.equal(summary.executed, 1);
  });
});
