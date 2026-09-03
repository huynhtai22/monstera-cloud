import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { signPayOSData } from "@/lib/payos";
import { getRedis } from "@/lib/redis";
import type { VietQrOrder } from "@/lib/vietqr-gateway";
import { POST } from "./route";

const originalWorkspace = (prisma as any).workspace;
const originalPaymentOrder = (prisma as any).paymentOrder;
const originalAuditEvent = (prisma as any).auditEvent;
const originalTransaction = (prisma as any).$transaction;
const previousChecksumKey = process.env.PAYOS_CHECKSUM_KEY;

afterEach(() => {
  (prisma as any).workspace = originalWorkspace;
  (prisma as any).paymentOrder = originalPaymentOrder;
  (prisma as any).auditEvent = originalAuditEvent;
  (prisma as any).$transaction = originalTransaction;
  if (previousChecksumKey === undefined) delete process.env.PAYOS_CHECKSUM_KEY;
  else process.env.PAYOS_CHECKSUM_KEY = previousChecksumKey;
});

describe("PayOS webhook fulfillment without a real payment", () => {
  it("accepts a correctly signed sandbox payload and activates only the attached workspace", async () => {
    process.env.PAYOS_CHECKSUM_KEY = "payos-webhook-test-key";
    const orderCode = 765434;
    const now = new Date();
    const dbOrderRecord = {
      id: "order_webhook_1",
      orderCode: BigInt(orderCode),
      workspaceId: "workspace-paid",
      userId: "user-webhook-1",
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
      paymentLinkId: "test-link",
      checkoutUrl: "https://payos.vn/test-link",
    };

    let updateArgs: any;
    let auditEventArgs: any;
    (prisma as any).paymentOrder = {
      findUnique: async () => dbOrderRecord,
      update: async (args: any) => ({ ...dbOrderRecord, ...args.data }),
    };
    (prisma as any).$transaction = async (callback: any) => callback({
      paymentOrder: {
        findUnique: async () => dbOrderRecord,
        update: async (args: any) => ({ ...dbOrderRecord, ...args.data }),
      },
      workspace: {
        findUnique: async () => ({ id: "workspace-paid", subscriptionEndsAt: null }),
        update: async (args: any) => {
          updateArgs = args;
          return { id: "workspace-paid" };
        },
      },
      auditEvent: {
        create: async (args: any) => {
          auditEventArgs = args;
          return { id: "audit_1" };
        },
      },
    });

    const data = {
      amount: 1_190_000,
      orderCode,
      description: `MC${orderCode}`,
      code: "00",
      desc: "success",
      currency: "VND",
      paymentLinkId: "test-link",
      reference: "TRANS_REF_123",
    };
    const response = await POST(new NextRequest("https://monstera.test/api/webhooks/payos", {
      method: "POST",
      body: JSON.stringify({ code: "00", success: true, data, signature: signPayOSData(data) }),
      headers: { "content-type": "application/json" },
    }));

    assert.equal(response.status, 200);
    assert.equal(updateArgs.where.id, "workspace-paid");
    assert.equal(updateArgs.data.plan, "professional");
    assert.equal(updateArgs.data.status, "ACTIVE");
    assert.equal(updateArgs.data.subscriptionEndsAt instanceof Date, true);
    assert.equal(auditEventArgs.data.action, "subscription.activated");
  });

  it("returns a retryable 500 when database transaction fails", async () => {
    process.env.PAYOS_CHECKSUM_KEY = "payos-webhook-test-key";
    const orderCode = 765435;

    (prisma as any).$transaction = async () => {
      throw new Error("Connection pool timeout: database offline");
    };

    const data = {
      amount: 1_190_000,
      orderCode,
      description: `MC${orderCode}`,
      code: "00",
      desc: "success",
    };
    const response = await POST(new NextRequest("https://monstera.test/api/webhooks/payos", {
      method: "POST",
      body: JSON.stringify({ code: "00", success: true, data, signature: signPayOSData(data) }),
      headers: { "content-type": "application/json" },
    }));

    // Must return retryable 5xx so PayOS retries delivery
    assert.equal(response.status, 500);
    const json = await response.json();
    assert.match(json.error, /database offline/i);
  });

  it("handles duplicate webhook deliveries with 200 without double-extending", async () => {
    process.env.PAYOS_CHECKSUM_KEY = "payos-webhook-test-key";
    const orderCode = 765436;
    const dbOrderRecord = {
      id: "order_dup",
      orderCode: BigInt(orderCode),
      workspaceId: "workspace-paid",
      status: "PAID", // Already paid
      amount: 1_190_000,
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

    const data = {
      amount: 1_190_000,
      orderCode,
      description: `MC${orderCode}`,
      code: "00",
      desc: "success",
    };
    const response = await POST(new NextRequest("https://monstera.test/api/webhooks/payos", {
      method: "POST",
      body: JSON.stringify({ code: "00", success: true, data, signature: signPayOSData(data) }),
      headers: { "content-type": "application/json" },
    }));

    assert.equal(response.status, 200);
    assert.equal(workspaceUpdated, false);
  });

  it("rejects an unsigned or tampered webhook before it can activate a workspace", async () => {
    process.env.PAYOS_CHECKSUM_KEY = "payos-webhook-test-key";
    const response = await POST(new NextRequest("https://monstera.test/api/webhooks/payos", {
      method: "POST",
      body: JSON.stringify({ code: "00", success: true, data: { amount: 1, orderCode: 123456 }, signature: "forged" }),
      headers: { "content-type": "application/json" },
    }));

    assert.equal(response.status, 401);
  });

  it("returns 500 when underpaid so PayOS or monitoring alerts", async () => {
    process.env.PAYOS_CHECKSUM_KEY = "payos-webhook-test-key";
    const orderCode = 765437;
    const dbOrderRecord = {
      id: "order_underpaid",
      orderCode: BigInt(orderCode),
      workspaceId: "workspace-paid",
      status: "PENDING",
      amount: 1_190_000,
      expiresAt: new Date(Date.now() + 100000),
      accessDurationDays: 30,
    };

    (prisma as any).$transaction = async (callback: any) => callback({
      paymentOrder: {
        findUnique: async () => dbOrderRecord,
      },
    });

    const data = {
      amount: 500_000, // Underpaid
      orderCode,
      description: `MC${orderCode}`,
      code: "00",
      desc: "success",
    };
    const response = await POST(new NextRequest("https://monstera.test/api/webhooks/payos", {
      method: "POST",
      body: JSON.stringify({ code: "00", success: true, data, signature: signPayOSData(data) }),
      headers: { "content-type": "application/json" },
    }));

    assert.equal(response.status, 500);
  });
});
