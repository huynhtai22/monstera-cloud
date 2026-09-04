import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import prisma from "@/lib/prisma";
import { setAuthSessionOverride } from "@/lib/auth-session";
import { POST } from "./[id]/activation/route";

const originalWorkspace = (prisma as any).workspace;
const originalWorkspaceMember = (prisma as any).workspaceMember;

function request(body: unknown) {
  return new Request("https://monstera.test/api/workspaces/workspace-a/activation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/workspaces/[id]/activation", () => {
  beforeEach(() => {
    setAuthSessionOverride(async () => ({
      user: { id: "user-a" },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    }));
    (prisma as any).workspace = {
      findUnique: async ({ where }: any) => where.id === "workspace-a"
        ? { id: "workspace-a", ownerId: "owner-a" }
        : { id: "workspace-b", ownerId: "owner-b" },
    };
    (prisma as any).workspaceMember = {
      findFirst: async ({ where }: any) => where.userId === "user-a" && where.workspaceId === "workspace-a"
        ? { userId: "user-a", workspaceId: "workspace-a", role: "viewer" }
        : null,
    };
  });

  afterEach(() => {
    setAuthSessionOverride(null);
    (prisma as any).workspace = originalWorkspace;
    (prisma as any).workspaceMember = originalWorkspaceMember;
  });

  it("requires authentication", async () => {
    setAuthSessionOverride(async () => null);
    const response = await POST(request({ action: "dashboard_reviewed" }), {
      params: Promise.resolve({ id: "workspace-a" }),
    });
    assert.equal(response.status, 401);
  });

  it("rejects a cross-workspace review attempt", async () => {
    const response = await POST(request({ action: "dashboard_reviewed" }), {
      params: Promise.resolve({ id: "workspace-b" }),
    });
    assert.equal(response.status, 403);
  });

  it("accepts only the dashboard_reviewed action with no browser-controlled fields", async () => {
    const response = await POST(request({ action: "dashboard_reviewed", duration: 365 }), {
      params: Promise.resolve({ id: "workspace-a" }),
    });
    assert.equal(response.status, 400);
  });

  it("rejects review when no recent KPI rows exist (409)", async () => {
    const originalCampaignMetric = (prisma as any).campaignMetric;
    const originalAuditEvent = (prisma as any).auditEvent;
    (prisma as any).campaignMetric = { count: async () => 0, aggregate: async () => ({ _max: { date: null } }) };
    (prisma as any).auditEvent = { findFirst: async () => null, upsert: async () => ({ createdAt: new Date() }) };
    try {
      const response = await POST(request({ action: "dashboard_reviewed" }), {
        params: Promise.resolve({ id: "workspace-a" }),
      });
      assert.equal(response.status, 409);
      const body = await response.json();
      assert.match(body.error, /Recent KPI rows are required/);
    } finally {
      (prisma as any).campaignMetric = originalCampaignMetric;
      (prisma as any).auditEvent = originalAuditEvent;
    }
  });

  it("is idempotent: second identical review reuses the existing audit event", async () => {
    const originalCampaignMetric = (prisma as any).campaignMetric;
    const originalAuditEvent = (prisma as any).auditEvent;
    const originalWorkspaceFind = (prisma as any).workspace.findUnique;
    const originalConnectionFind = (prisma as any).connection?.findMany;
    const fixedDate = new Date("2026-09-03T01:00:00.000Z");
    let upsertCalls = 0;
    (prisma as any).campaignMetric = {
      count: async () => 5,
      aggregate: async () => ({ _max: { date: new Date("2026-09-03T00:00:00.000Z") } }),
    };
    (prisma as any).auditEvent = {
      findFirst: async () => null,
      upsert: async () => {
        upsertCalls += 1;
        return { createdAt: fixedDate };
      },
    };
    // Mock the dashboard overview dependencies so the final refresh succeeds
    const mockWorkspace = {
      id: "workspace-a",
      name: "Test Workspace",
      slug: "test-workspace",
      plan: "pilot",
      status: "PILOT",
      subscriptionEndsAt: new Date(Date.now() + 7 * 86400000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (prisma as any).workspace.findUnique = async () => mockWorkspace;
    (prisma as any).connection = { findMany: async () => [] };
    (prisma as any).pipeline = { findMany: async () => [] };
    (prisma as any).campaignMetric = {
      count: async (args: any) => {
        if (args.where?.date?.gte) return 5;
        return 5;
      },
      aggregate: async () => ({ _max: { date: new Date("2026-09-03T00:00:00.000Z"), pulledAt: new Date() }, _count: { id: 5 } }),
      groupBy: async () => [],
    };
    (prisma as any).retailOrder = { aggregate: async () => ({ _count: { _all: 0 }, _max: { pulledAt: null, createdAtIso: null } }) };
    (prisma as any).syncJob = { findFirst: async () => null, groupBy: async () => [] };
    (prisma as any).warehouseImportJob = { findFirst: async () => null };
    (prisma as any).syncLog = { findMany: async () => [], groupBy: async () => [] };
    (prisma as any).apiKey = { count: async () => 0 };
    (prisma as any).lookerJob = { findMany: async () => [] };
    (prisma as any).auditEvent = {
      findFirst: async (args: any) => {
        if (args.where?.action === "onboarding.dashboard_reviewed") return null;
        return null;
      },
      upsert: async () => {
        upsertCalls += 1;
        return { createdAt: fixedDate };
      },
    };
    try {
      const first = await POST(request({ action: "dashboard_reviewed" }), {
        params: Promise.resolve({ id: "workspace-a" }),
      });
      assert.equal(first.status, 200);
      const beforeCalls = upsertCalls;
      (prisma as any).auditEvent.findFirst = async () => ({ createdAt: fixedDate });
      const second = await POST(request({ action: "dashboard_reviewed" }), {
        params: Promise.resolve({ id: "workspace-a" }),
      });
      assert.equal(second.status, 200);
      assert.equal(upsertCalls, beforeCalls, "second call should not create a new audit event");
    } finally {
      (prisma as any).campaignMetric = originalCampaignMetric;
      (prisma as any).auditEvent = originalAuditEvent;
      (prisma as any).workspace.findUnique = originalWorkspaceFind;
      if (originalConnectionFind) (prisma as any).connection.findMany = originalConnectionFind;
    }
  });

  it("denies a non-member even for their own workspace id", async () => {
    (prisma as any).workspaceMember = {
      findFirst: async () => null,
    };
    const response = await POST(request({ action: "dashboard_reviewed" }), {
      params: Promise.resolve({ id: "workspace-a" }),
    });
    assert.equal(response.status, 403);
  });
});
