import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { calculatePaidThrough, fulfillVietQrPayment, type VietQrOrder } from "./vietqr-gateway";

const originalWorkspace = (prisma as any).workspace;
const originalTransaction = (prisma as any).$transaction;

afterEach(() => {
  (prisma as any).workspace = originalWorkspace;
  (prisma as any).$transaction = originalTransaction;
});

describe("VietQR payment fulfillment", () => {
  it("upgrades only the workspace attached to the order", async () => {
    const orderCode = 765432;
    const order: VietQrOrder = {
      orderCode,
      plan: "professional",
      billingCycle: "monthly",
      amount: 1_190_000,
      memo: `MC${orderCode}`,
      status: "PENDING",
      workspaceId: "workspace-a",
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
          return { id: "workspace-a" };
        },
      },
    });

    const result = await fulfillVietQrPayment(orderCode, { amount: 1_190_000 });

    assert.equal(result.success, true);
    assert.equal(updateArgs.where.id, "workspace-a");
    assert.equal(updateArgs.data.plan, "professional");
    assert.equal(updateArgs.data.subscriptionEndsAt instanceof Date, true);
    assert.ok(updateArgs.data.subscriptionEndsAt.getTime() > Date.now() + 29 * 86_400_000);
  });

  it("refuses a legacy unbound order instead of upgrading every workspace owned by an email", async () => {
    const orderCode = 765433;
    const order: VietQrOrder = {
      orderCode,
      plan: "professional",
      billingCycle: "monthly",
      amount: 1_190_000,
      memo: `MC${orderCode}`,
      status: "PENDING",
      userEmail: "owner@example.test",
      createdAt: Date.now(),
      bankName: "PayOS",
      accountNo: "",
      accountName: "",
      qrUrl: "",
    };
    await getRedis().set(`vietqr_order_${orderCode}`, JSON.stringify(order), { ex: 60 });

    const result = await fulfillVietQrPayment(orderCode, { amount: 1_190_000 });

    assert.equal(result.success, false);
    assert.match(result.message, /missing its workspace binding/);
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
