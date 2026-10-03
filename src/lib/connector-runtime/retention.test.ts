import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_CLEANUP_BATCH_LIMIT,
  MAX_CLEANUP_BATCH_LIMIT,
  cleanupExpiredArtifacts,
  normalizeCleanupInput,
} from "./retention";
import prisma from "@/lib/prisma";

describe("cleanup input normalization", () => {
  it("defaults to now with the default batch limit", () => {
    const before = Date.now();
    const { cutoff, batchLimit } = normalizeCleanupInput({});
    assert.ok(cutoff.getTime() >= before);
    assert.equal(batchLimit, DEFAULT_CLEANUP_BATCH_LIMIT);
  });

  it("clamps the batch limit to a safe range", () => {
    assert.equal(normalizeCleanupInput({ limit: 0 }).batchLimit, 1);
    assert.equal(normalizeCleanupInput({ limit: -5 }).batchLimit, 1);
    assert.equal(
      normalizeCleanupInput({ limit: MAX_CLEANUP_BATCH_LIMIT + 100 }).batchLimit,
      MAX_CLEANUP_BATCH_LIMIT,
    );
    assert.equal(normalizeCleanupInput({ limit: NaN }).batchLimit, DEFAULT_CLEANUP_BATCH_LIMIT);
    assert.equal(normalizeCleanupInput({ limit: "many" }).batchLimit, DEFAULT_CLEANUP_BATCH_LIMIT);
  });

  it("falls back to now for an invalid cutoff", () => {
    const before = Date.now();
    const { cutoff } = normalizeCleanupInput({ before: new Date("not-a-date") });
    assert.ok(cutoff.getTime() >= before);
  });
});

describe("cleanupExpiredArtifacts with mocked storage", () => {
  const originalArtifact = (prisma as any).connectorRunArtifact;
  const originalAudit = (prisma as any).auditEvent;

  function mockDb(rows: Array<{ id: string; workspaceId: string }>) {
    let deleted: string[] = [];
    const audits: unknown[] = [];
    (prisma as any).connectorRunArtifact = {
      findMany: async (args: any) =>
        rows.map((row) => ({ ...row })).slice(0, (args?.take ?? rows.length) + 0 || rows.length),
      deleteMany: async ({ where }: any) => {
        const matching = rows.filter((row) => where.id.in.includes(row.id) && (!where.workspaceId || where.workspaceId === row.workspaceId));
        deleted.push(...matching.map((r) => r.id));
        return { count: matching.length };
      },
    };
    (prisma as any).auditEvent = {
      create: async ({ data }: any) => {
        audits.push(data);
        return data;
      },
    };
    return { audits, deletedIds: () => deleted };
  }

  function restore() {
    (prisma as any).connectorRunArtifact = originalArtifact;
    (prisma as any).auditEvent = originalAudit;
  }

  it("deletes only the listed expired rows and audits the run", async () => {
    const { audits } = mockDb([
      { id: "old-1", workspaceId: "ws-1" },
      { id: "old-2", workspaceId: "ws-1" },
    ]);
    try {
      const summary = await cleanupExpiredArtifacts({ limit: 500 });
      assert.equal(summary.deleted, 2);
      assert.equal(summary.hasMore, false);
      assert.equal(audits.length, 1);
    } finally {
      restore();
    }
  });

  it("records no audit event when nothing expired", async () => {
    const { audits } = mockDb([]);
    try {
      const summary = await cleanupExpiredArtifacts({});
      assert.equal(summary.deleted, 0);
      assert.equal(audits.length, 0);
    } finally {
      restore();
    }
  });

  it("reports hasMore when the batch cap is reached", async () => {
    mockDb([
      { id: "a", workspaceId: "ws-1" },
      { id: "b", workspaceId: "ws-1" },
    ]);
    try {
      const summary = await cleanupExpiredArtifacts({ limit: 1 });
      assert.equal(summary.hasMore, true);
      const drained = await cleanupExpiredArtifacts({ limit: 10 });
      assert.equal(drained.hasMore, false);
    } finally {
      restore();
    }
  });

  it("groups audit events strictly per workspace for mixed-tenant batches", async () => {
    const { audits } = mockDb([
      { id: "old-ws1-1", workspaceId: "ws-1" },
      { id: "old-ws1-2", workspaceId: "ws-1" },
      { id: "old-ws2-1", workspaceId: "ws-2" },
      { id: "old-ws3-1", workspaceId: "ws-3" },
    ]);
    try {
      const summary = await cleanupExpiredArtifacts({ limit: 500 });
      assert.equal(summary.deleted, 4);
      assert.equal(audits.length, 3);
      const auditWs1 = audits.find((a: any) => a.workspaceId === "ws-1") as any;
      const auditWs2 = audits.find((a: any) => a.workspaceId === "ws-2") as any;
      const auditWs3 = audits.find((a: any) => a.workspaceId === "ws-3") as any;
      assert.ok(auditWs1);
      assert.equal(auditWs1.metadata.deleted, 2);
      assert.ok(auditWs2);
      assert.equal(auditWs2.metadata.deleted, 1);
      assert.ok(auditWs3);
      assert.equal(auditWs3.metadata.deleted, 1);
    } finally {
      restore();
    }
  });
});
