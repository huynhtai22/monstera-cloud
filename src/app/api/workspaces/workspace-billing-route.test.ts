import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import prisma from "@/lib/prisma";
import { setAuthSessionOverride } from "@/lib/auth-session";
import { GET } from "./[id]/billing/route";

describe("GET /api/workspaces/[id]/billing", () => {
  let originalWorkspace: any;
  let originalWorkspaceMember: any;
  let originalPaymentOrder: any;

  beforeEach(() => {
    setAuthSessionOverride(async () => ({
      user: { id: "user-1", email: "agency@example.com" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));

    originalWorkspace = (prisma as any).workspace;
    originalWorkspaceMember = (prisma as any).workspaceMember;
    originalPaymentOrder = (prisma as any).paymentOrder;

    (prisma as any).workspace = {
      findUnique: async () => ({
        id: "ws-1",
        name: "Test Agency",
        plan: "professional",
        status: "ACTIVE",
        subscriptionEndsAt: new Date("2026-10-01T00:00:00.000Z"),
        _count: {
          connections: 3,
          members: 2,
          pipelines: 5,
        },
      }),
    };

    (prisma as any).workspaceMember = {
      findUnique: async () => ({
        userId: "user-1",
        workspaceId: "ws-1",
        role: "owner",
      }),
      findFirst: async () => ({
        userId: "user-1",
        workspaceId: "ws-1",
        role: "owner",
      }),
    };

    (prisma as any).paymentOrder = {
      findMany: async () => [
        {
          id: "po-1",
          orderCode: BigInt(123456789),
          plan: "professional",
          billingCycle: "annual",
          amount: 14900000,
          currency: "VND",
          status: "PAID",
          checkoutUrl: null,
          createdAt: new Date("2026-09-01T10:00:00.000Z"),
          paidAt: new Date("2026-09-01T10:05:00.000Z"),
          expiresAt: new Date("2026-09-01T11:00:00.000Z"),
        },
      ],
    };
  });

  afterEach(() => {
    setAuthSessionOverride(null);
    (prisma as any).workspace = originalWorkspace;
    (prisma as any).workspaceMember = originalWorkspaceMember;
    (prisma as any).paymentOrder = originalPaymentOrder;
  });

  it("returns billing status, usage, limits, and serialized payment orders", async () => {
    const req = new Request("http://localhost:3000/api/workspaces/ws-1/billing");
    const res = await GET(req, { params: Promise.resolve({ id: "ws-1" }) });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.workspaceId, "ws-1");
    assert.equal(body.plan, "professional");
    assert.equal(body.usage.connectionsCount, 3);
    assert.equal(body.limits.maxConnections, 15);
    assert.equal(body.orders.length, 1);
    assert.equal(body.orders[0].orderCode, 123456789);
    assert.equal(body.orders[0].status, "PAID");
  });

  it("denies unauthenticated requests", async () => {
    setAuthSessionOverride(async () => null);
    const req = new Request("http://localhost:3000/api/workspaces/ws-1/billing");
    const res = await GET(req, { params: Promise.resolve({ id: "ws-1" }) });
    assert.equal(res.status, 401);
  });
});
