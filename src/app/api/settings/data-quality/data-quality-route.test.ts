import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { NextRequest } from "next/server";
import { GET, POST, PATCH, DELETE } from "./route";
import prisma from "@/lib/prisma";
import { setAuthSessionOverride } from "@/lib/auth-session";

describe("Data Quality Route Handlers (Real Handler Invocations)", () => {
  const mockUserId = "user-alice-123";
  const mockWorkspaceId = "ws-prod-456";
  const foreignWorkspaceId = "ws-foreign-789";

  beforeEach(() => {
    // Default auth mock: authenticated as Alice
    setAuthSessionOverride(async () => ({
      user: { id: mockUserId, email: "alice@example.com" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));

    // Real RBAC verification backed by mocked Prisma workspaceMember
    (prisma as any).workspaceMember = {
      findFirst: async ({ where }: any) => {
        if (where.userId === mockUserId && where.workspaceId === mockWorkspaceId) {
          return { userId: mockUserId, workspaceId: mockWorkspaceId, role: "admin" };
        }
        return null; // Deny foreign or unknown memberships
      },
    };

    (prisma as any).workspace = {
      findUnique: async ({ where }: any) => {
        if (where.id === mockWorkspaceId) {
          return { id: mockWorkspaceId, name: "Production Workspace", telegramChatId: "-100123456789" };
        }
        return null;
      },
      update: async ({ data }: any) => ({ id: mockWorkspaceId, ...data }),
    };

    (prisma as any).dataQualityRule = {
      findMany: async () => [],
      findFirst: async () => null,
      create: async ({ data }: any) => ({ id: "rule-created-1", ...data }),
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }: any) => ({ id: "rule-1", ...data }),
      deleteMany: async () => ({ count: 1 }),
    };

    (prisma as any).dataQualityViolation = {
      findMany: async () => [],
      create: async ({ data }: any) => ({ id: "violation-1", ...data }),
    };
  });

  it("GET: rejects unauthenticated requests with 401", async () => {
    setAuthSessionOverride(async () => null);

    const req = new NextRequest(`http://localhost:3000/api/settings/data-quality?workspaceId=${mockWorkspaceId}`);
    const res = await GET(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "Unauthorized");
  });

  it("GET: returns 400 when workspaceId query param is missing", async () => {
    const req = new NextRequest("http://localhost:3000/api/settings/data-quality");
    const res = await GET(req);
    assert.equal(res.status, 400);
  });

  it("GET: rejects non-member workspace access with 404", async () => {
    const req = new NextRequest(`http://localhost:3000/api/settings/data-quality?workspaceId=${foreignWorkspaceId}`);
    const res = await GET(req);
    assert.equal(res.status, 404);
  });

  it("POST: rejects insufficient viewer role with 403", async () => {
    (prisma as any).workspaceMember.findFirst = async () => ({
      userId: mockUserId,
      workspaceId: mockWorkspaceId,
      role: "viewer", // viewer cannot create rules (requires admin)
    });

    const req = new NextRequest("http://localhost:3000/api/settings/data-quality", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: mockWorkspaceId,
        name: "Forbidden Rule",
        ruleType: "threshold",
        metric: "spend",
        operator: "gt",
        threshold: 500,
        severity: "critical",
      }),
    });
    const res = await POST(req);
    assert.equal(res.status, 403);
  });

  it("POST: validates strict discriminated union schemas and rejects invalid rule combinations", async () => {
    // 1. Missing threshold on threshold rule -> 400
    const req1 = new NextRequest("http://localhost:3000/api/settings/data-quality", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: mockWorkspaceId,
        name: "Broken Threshold Rule",
        ruleType: "threshold",
        metric: "spend",
        operator: "gt",
        severity: "critical",
        // missing threshold
      }),
    });
    const res1 = await POST(req1);
    assert.equal(res1.status, 400);
    const body1 = await res1.json();
    assert.equal(body1.error, "Validation failed");

    // 2. Out of bounds pctThreshold (< 0.01 or > 1.0) on comparison rule -> 400
    const req2 = new NextRequest("http://localhost:3000/api/settings/data-quality", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: mockWorkspaceId,
        name: "Broken Comparison Rule",
        ruleType: "comparison",
        metric: "revenue",
        operator: "drop_pct",
        pctThreshold: 2.5, // 250% is invalid (must be <= 1.0)
        severity: "warning",
      }),
    });
    const res2 = await POST(req2);
    assert.equal(res2.status, 400);

    // 3. Schema check without expectedColumns -> 400
    const req3 = new NextRequest("http://localhost:3000/api/settings/data-quality", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: mockWorkspaceId,
        name: "Broken Schema Check",
        ruleType: "schema_check",
        metric: "orders",
        operator: "schema_check",
        severity: "critical",
        expectedColumns: [], // empty -> 400
      }),
    });
    const res3 = await POST(req3);
    assert.equal(res3.status, 400);
  });

  it("POST: creates a valid threshold rule and returns 201", async () => {
    let capturedCreateData: any = null;
    (prisma as any).dataQualityRule = {
      create: async ({ data }: any) => {
        capturedCreateData = data;
        return { id: "rule-created-1", ...data };
      },
    };

    const req = new NextRequest("http://localhost:3000/api/settings/data-quality", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: mockWorkspaceId,
        name: "Valid Spend Rule",
        ruleType: "threshold",
        metric: "spend",
        operator: "gt",
        threshold: 1000,
        severity: "critical",
        notifyTelegram: true,
      }),
    });
    const res = await POST(req);
    assert.equal(res.status, 201);
    assert.equal(capturedCreateData.workspaceId, mockWorkspaceId);
    assert.equal(capturedCreateData.threshold, 1000);
    assert.equal(capturedCreateData.severity, "critical");
  });

  it("PATCH: enforces tenant isolation on rule update (rejects cross-workspace ruleId)", async () => {
    (prisma as any).dataQualityRule = {
      findFirst: async ({ where }: any) => {
        // Rule exists in foreign workspace, not mockWorkspaceId
        if (where.workspaceId === mockWorkspaceId && where.id === "foreign-rule-999") {
          return null;
        }
        return { id: "foreign-rule-999", workspaceId: foreignWorkspaceId, name: "Foreign Rule" };
      },
      updateMany: async () => ({ count: 0 }),
    };

    const req = new NextRequest("http://localhost:3000/api/settings/data-quality", {
      method: "PATCH",
      body: JSON.stringify({
        workspaceId: mockWorkspaceId,
        ruleId: "foreign-rule-999",
        enabled: false,
      }),
    });
    const res = await PATCH(req);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "Rule not found in this workspace");
  });

  it("PATCH: validates merged rule state and updates within tenant scope", async () => {
    const existingRule = {
      id: "rule-existing-1",
      workspaceId: mockWorkspaceId,
      name: "Existing Spend Rule",
      ruleType: "threshold",
      metric: "spend",
      operator: "gt",
      threshold: 500,
      pctThreshold: null,
      expectedColumns: [],
      severity: "critical",
      enabled: true,
      notifyEmail: false,
      notifyTelegram: true,
      pipelineId: null,
      connectionId: null,
    };

    let capturedUpdateWhere: any = null;
    let capturedUpdateData: any = null;

    (prisma as any).dataQualityRule = {
      findFirst: async ({ where }: any) => {
        if (where.id === "rule-existing-1" && where.workspaceId === mockWorkspaceId) {
          return existingRule;
        }
        return null;
      },
      update: async ({ where, data }: any) => {
        capturedUpdateWhere = where;
        capturedUpdateData = data;
        return { ...existingRule, ...data };
      },
    };

    const req = new NextRequest("http://localhost:3000/api/settings/data-quality", {
      method: "PATCH",
      body: JSON.stringify({
        workspaceId: mockWorkspaceId,
        ruleId: "rule-existing-1",
        threshold: 750,
        enabled: false,
      }),
    });
    const res = await PATCH(req);
    assert.equal(res.status, 200);
    assert.equal(capturedUpdateWhere.id, "rule-existing-1");
    assert.equal(capturedUpdateData.threshold, 750);
    assert.equal(capturedUpdateData.enabled, false);
  });

  it("DELETE: enforces tenant isolation on deletion", async () => {
    let capturedDeleteWhere: any = null;
    (prisma as any).dataQualityRule = {
      deleteMany: async ({ where }: any) => {
        capturedDeleteWhere = where;
        // If searching with mockWorkspaceId and rule-123 -> success
        if (where.workspaceId === mockWorkspaceId && where.id === "rule-123") {
          return { count: 1 };
        }
        return { count: 0 };
      },
    };

    // 1. Valid workspace delete
    const req1 = new NextRequest(`http://localhost:3000/api/settings/data-quality?workspaceId=${mockWorkspaceId}&ruleId=rule-123`, {
      method: "DELETE",
    });
    const res1 = await DELETE(req1);
    assert.equal(res1.status, 200);
    assert.deepEqual(capturedDeleteWhere, { id: "rule-123", workspaceId: mockWorkspaceId });

    // 2. Cross-workspace delete target -> 404
    const req2 = new NextRequest(`http://localhost:3000/api/settings/data-quality?workspaceId=${mockWorkspaceId}&ruleId=other-rule-456`, {
      method: "DELETE",
    });
    const res2 = await DELETE(req2);
    assert.equal(res2.status, 404);
  });
});
