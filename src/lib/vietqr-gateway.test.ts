import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { calculatePaidThrough, fulfillVietQrPayment, getVietQrOrder } from "./vietqr-gateway";

const originalWorkspace = (prisma as any).workspace;
const originalPaymentOrder = (prisma as any).paymentOrder;
const originalAuditEvent = (prisma as any).auditEvent;
const originalTransaction = (prisma as any).$transaction;

afterEach(() => {
  (prisma as any).workspace = originalWorkspace;
  (prisma as any).paymentOrder = originalPaymentOrder;
  (prisma as any).auditEvent = originalAuditEvent;
  (prisma as any).$transaction = originalTransaction;
});

describe("VietQR payment fulfillment", () => {
  it("upgrades only the workspace attached to the order and writes audit event", async () => {
    const orderCode = 765432;
    const now = new Date();
    const dbOrderRecord = {
      id: "order_123",
      orderCode: BigInt(orderCode),
      workspaceId: "workspace-a",
      userId: "user-1",
      plan: "professional",
      billingCycle: "monthly",
      amount: 1_190_000,
      currency: "VND",
      accessDurationDays: 30,
      status: "PENDING",
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      createdAt: now,
      paidAt: null,
      fulfilledAt: null,
      paymentLinkId: "pl_123",
      checkoutUrl: "https://pay.payos.vn/web/123",
      qrCode: null,
      transactionRef: null,
    };

    let updateArgs: any;
    let paymentOrderUpdateArgs: any;
    let auditEventCreateArgs: any;

    (prisma as any).paymentOrder = {
      findUnique: async () => dbOrderRecord,
      update: async (args: any) => {
        paymentOrderUpdateArgs = args;
        return { ...dbOrderRecord, ...args.data };
      },
    };

    (prisma as any).$transaction = async (callback: any) => callback({
      paymentOrder: {
        findUnique: async () => dbOrderRecord,
        update: async (args: any) => {
          paymentOrderUpdateArgs = args;
          return { ...dbOrderRecord, ...args.data };
        },
      },
      workspace: {
        findUnique: async () => ({ id: "workspace-a", subscriptionEndsAt: null }),
        update: async (args: any) => {
          updateArgs = args;
          return { id: "workspace-a" };
        },
      },
      auditEvent: {
        create: async (args: any) => {
          auditEventCreateArgs = args;
          return { id: "audit_123" };
        },
      },
    });

    const result = await fulfillVietQrPayment(orderCode, { amount: 1_190_000, reference: "PAYOS_REF_001" });

    assert.equal(result.success, true);
    assert.equal(updateArgs.where.id, "workspace-a");
    assert.equal(updateArgs.data.plan, "professional");
    assert.equal(updateArgs.data.status, "ACTIVE");
    assert.equal(updateArgs.data.subscriptionEndsAt instanceof Date, true);
    assert.ok(updateArgs.data.subscriptionEndsAt.getTime() > Date.now() + 29 * 86_400_000);

    // PaymentOrder marked PAID in DB
    assert.equal(paymentOrderUpdateArgs.data.status, "PAID");
    assert.equal(paymentOrderUpdateArgs.data.transactionRef, "PAYOS_REF_001");
    assert.equal(paymentOrderUpdateArgs.data.paidAt instanceof Date, true);

    // Sanitized AuditEvent written
    assert.equal(auditEventCreateArgs.data.workspaceId, "workspace-a");
    assert.equal(auditEventCreateArgs.data.action, "subscription.activated");
    assert.equal(auditEventCreateArgs.data.resource, "PaymentOrder");
    assert.equal(auditEventCreateArgs.data.metadata.orderCode, orderCode);
  });

  it("proves PostgreSQL is authoritative on cache loss (Redis empty)", async () => {
    const orderCode = 765439;
    const now = new Date();
    const dbOrderRecord = {
      id: "order_cache_loss",
      orderCode: BigInt(orderCode),
      workspaceId: "workspace-cache-loss",
      userId: "user-cache-loss",
      plan: "professional",
      billingCycle: "monthly",
      amount: 1_190_000,
      currency: "VND",
      accessDurationDays: 30,
      status: "PENDING",
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      createdAt: now,
      paidAt: null,
      fulfilledAt: null,
      paymentLinkId: "pl_cache_loss",
      checkoutUrl: "https://pay.payos.vn/web/cache-loss",
      qrCode: null,
      transactionRef: null,
    };

    // Ensure Redis does NOT have this key
    await getRedis().del(`vietqr_order_${orderCode}`);

    (prisma as any).paymentOrder = {
      findUnique: async () => dbOrderRecord,
      update: async (args: any) => ({ ...dbOrderRecord, ...args.data }),
    };

    // getVietQrOrder must find it in PostgreSQL despite cache loss
    const fetched = await getVietQrOrder(orderCode);
    assert.ok(fetched);
    assert.equal(fetched.orderCode, orderCode);
    assert.equal(fetched.workspaceId, "workspace-cache-loss");
    assert.equal(fetched.status, "PENDING");

    (prisma as any).$transaction = async (callback: any) => callback({
      paymentOrder: {
        findUnique: async () => dbOrderRecord,
        update: async (args: any) => ({ ...dbOrderRecord, ...args.data }),
      },
      workspace: {
        findUnique: async () => ({ id: "workspace-cache-loss", subscriptionEndsAt: null }),
        update: async () => ({ id: "workspace-cache-loss" }),
      },
      auditEvent: {
        create: async () => ({ id: "audit_test" }),
      },
    });

    // Fulfill succeeds authoritatively from PostgreSQL
    const result = await fulfillVietQrPayment(orderCode, { amount: 1_190_000 });
    assert.equal(result.success, true);
  });

  it("rejects fulfillment for an expired checkout and marks order EXPIRED", async () => {
    const orderCode = 765438;
    const past = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
    const dbOrderRecord = {
      id: "order_expired",
      orderCode: BigInt(orderCode),
      workspaceId: "workspace-expired",
      plan: "professional",
      billingCycle: "monthly",
      amount: 1_190_000,
      status: "PENDING",
      expiresAt: past,
      accessDurationDays: 30,
    };

    let expiredUpdateArgs: any;
    (prisma as any).$transaction = async (callback: any) => callback({
      paymentOrder: {
        findUnique: async () => dbOrderRecord,
        update: async (args: any) => {
          expiredUpdateArgs = args;
          return { ...dbOrderRecord, ...args.data };
        },
      },
      workspace: {
        findUnique: async () => ({ id: "workspace-expired" }),
        update: async () => { throw new Error("Workspace must not be updated on expired order"); },
      },
    });

    const result = await fulfillVietQrPayment(orderCode, { amount: 1_190_000 });
    assert.equal(result.success, false);
    assert.match(result.message, /expired/i);
    assert.equal(expiredUpdateArgs.data.status, "EXPIRED");
  });

  it("handles duplicate webhooks idempotently without double-extending access", async () => {
    const orderCode = 765437;
    const dbOrderRecord = {
      id: "order_already_paid",
      orderCode: BigInt(orderCode),
      workspaceId: "workspace-paid",
      plan: "professional",
      billingCycle: "monthly",
      amount: 1_190_000,
      status: "PAID",
      expiresAt: new Date(Date.now() + 100000),
      accessDurationDays: 30,
    };

    let workspaceUpdated = false;
    (prisma as any).$transaction = async (callback: any) => callback({
      paymentOrder: {
        findUnique: async () => dbOrderRecord,
        update: async () => { throw new Error("PaymentOrder must not be updated again"); },
      },
      workspace: {
        update: async () => { workspaceUpdated = true; },
      },
    });

    const result = await fulfillVietQrPayment(orderCode, { amount: 1_190_000 });
    assert.equal(result.success, true);
    assert.equal(result.duplicate, true);
    assert.equal(workspaceUpdated, false);
  });

  it("rejects underpayment without extending access", async () => {
    const orderCode = 765436;
    const dbOrderRecord = {
      id: "order_underpaid",
      orderCode: BigInt(orderCode),
      workspaceId: "workspace-u",
      plan: "professional",
      billingCycle: "monthly",
      amount: 1_190_000,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 100000),
      accessDurationDays: 30,
    };

    let workspaceUpdated = false;
    (prisma as any).$transaction = async (callback: any) => callback({
      paymentOrder: {
        findUnique: async () => dbOrderRecord,
      },
      workspace: {
        update: async () => { workspaceUpdated = true; },
      },
    });

    const result = await fulfillVietQrPayment(orderCode, { amount: 1_000_000 }); // Underpaid!
    assert.equal(result.success, false);
    assert.match(result.message, /underpaid/i);
    assert.equal(workspaceUpdated, false);
  });

  it("refuses an unbound order instead of upgrading arbitrary workspaces", async () => {
    const orderCode = 765435;
    const dbOrderRecord = {
      id: "order_unbound",
      orderCode: BigInt(orderCode),
      workspaceId: "", // Missing workspace binding
      plan: "professional",
      billingCycle: "monthly",
      amount: 1_190_000,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 100000),
      accessDurationDays: 30,
    };

    (prisma as any).$transaction = async (callback: any) => callback({
      paymentOrder: {
        findUnique: async () => dbOrderRecord,
      },
    });

    const result = await fulfillVietQrPayment(orderCode, { amount: 1_190_000 });
    assert.equal(result.success, false);
    assert.match(result.message, /workspace binding/i);
  });

  it("extends a renewal from the existing paid-through date instead of discarding time", () => {
    const paidAt = new Date("2026-09-02T00:00:00.000Z");
    const paidThrough = calculatePaidThrough({
      currentPaidThrough: new Date("2026-09-20T00:00:00.000Z"),
      paidAt,
      accessDurationDays: 30,
    });
    assert.equal(paidThrough.toISOString(), "2026-10-20T00:00:00.000Z");
  });

  it("uses a 365-day term for an annual order", () => {
    const paidAt = new Date("2026-09-02T00:00:00.000Z");
    const paidThrough = calculatePaidThrough({ currentPaidThrough: null, paidAt, accessDurationDays: 365 });
    assert.equal(paidThrough.toISOString(), "2027-09-02T00:00:00.000Z");
  });
});
