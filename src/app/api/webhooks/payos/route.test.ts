import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { signPayOSData } from "@/lib/payos";
import { getRedis } from "@/lib/redis";
import type { VietQrOrder } from "@/lib/vietqr-gateway";
import { POST } from "./route";

const originalWorkspace = (prisma as any).workspace;
const originalTransaction = (prisma as any).$transaction;
const previousChecksumKey = process.env.PAYOS_CHECKSUM_KEY;

afterEach(() => {
  (prisma as any).workspace = originalWorkspace;
  (prisma as any).$transaction = originalTransaction;
  if (previousChecksumKey === undefined) delete process.env.PAYOS_CHECKSUM_KEY;
  else process.env.PAYOS_CHECKSUM_KEY = previousChecksumKey;
});

describe("PayOS webhook fulfillment without a real payment", () => {
  it("accepts a correctly signed sandbox payload and activates only the attached workspace", async () => {
    process.env.PAYOS_CHECKSUM_KEY = "payos-webhook-test-key";
    const orderCode = 765434;
    const order: VietQrOrder = {
      orderCode,
      plan: "professional",
      billingCycle: "monthly",
      amount: 1_190_000,
      memo: `MC${orderCode}`,
      status: "PENDING",
      workspaceId: "workspace-paid",
      createdAt: Date.now(),
      bankName: "PayOS",
      accountNo: "",
      accountName: "",
      qrUrl: "",
    };
    await getRedis().set(`vietqr_order_${orderCode}`, JSON.stringify(order), { ex: 60 });

    let updateArgs: any;
    (prisma as any).$transaction = async (callback: any) => callback({
      workspace: {
        findUnique: async () => ({ subscriptionEndsAt: null }),
        update: async (args: any) => {
          updateArgs = args;
          return { id: "workspace-paid" };
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
});
