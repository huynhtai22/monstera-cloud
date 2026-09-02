/**
 * Payment order and fulfillment support for the PayOS hosted checkout.
 */

import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { PLAN_PRICING, PLAN_VND_ANNUAL_TOTALS, type PlanName } from "@/lib/plan-config";
import { createPayOSPaymentLink, verifyPayOSData } from "@/lib/payos";

export interface VietQrOrder {
    orderCode: number;
    plan: PlanName;
    billingCycle: "monthly" | "annual";
    amount: number;
    memo: string;
    status: "PENDING" | "PAID" | "EXPIRED" | "CANCELLED";
    userEmail?: string;
    workspaceId?: string;
    createdAt: number;
    paidAt?: number;
    bankName: string;
    accountNo: string;
    accountName: string;
    qrUrl: string;
    /** EMVCo/VietQR payload returned directly by PayOS. */
    qrCode?: string;
    checkoutUrl?: string;
    paymentLinkId?: string;
    /** Access term is fixed when the payment request is created, never by the browser. */
    accessDurationDays?: number;
    paidThroughAt?: number;
}

/**
 * Generate unique 6-digit numeric order code (e.g. 183920)
 */
function generateOrderCode(): number {
    return Math.floor(100000 + Math.random() * 900000);
}

/** Payment orders must survive a serverless webhook invocation on another instance. */
export function isPaymentOrderStorageConfigured(): boolean {
    return Boolean(
        (process.env.KV_URL?.trim() || process.env.KV_REST_API_URL?.trim()) &&
        process.env.KV_REST_API_TOKEN?.trim(),
    );
}

/**
 * Compatibility helper for internal callers and pricing tests. Checkout order
 * creation uses the same calculation below, including the exact published
 * annual total rather than twelve times a rounded display value.
 */
export function vietQrAmountForPlan(
    plan: PlanName,
    billingCycle: "monthly" | "annual",
): number {
    const cfg = PLAN_PRICING[plan] || PLAN_PRICING.free;
    return billingCycle === "annual"
        ? PLAN_VND_ANNUAL_TOTALS[plan] ?? cfg.vndAnnualMonthly * 12
        : cfg.vndMonthly;
}

async function reserveOrderCode(): Promise<number> {
    const redis = getRedis();
    for (let attempt = 0; attempt < 10; attempt++) {
        const orderCode = generateOrderCode();
        const reserved = await redis.setnx(`vietqr_order_reservation_${orderCode}`, "1");
        if (reserved === 1) {
            await redis.expire(`vietqr_order_reservation_${orderCode}`, 60 * 60 * 24);
            return orderCode;
        }
    }
    throw new Error("Could not reserve a unique payment order code. Please try again.");
}

/**
 * Create a new Domestic VietQR payment order
 */
export async function createVietQrOrder(opts: {
    plan: PlanName;
    billingCycle: "monthly" | "annual";
    userEmail?: string;
    workspaceId?: string;
    returnUrl: string;
    cancelUrl: string;
    amountVnd?: number;
    accessDurationDays?: number;
}): Promise<VietQrOrder> {
    // In a serverless deployment, in-memory fallback storage would make a
    // successful payment impossible to reconcile in the webhook invocation.
    if (process.env.NODE_ENV === "production" && !isPaymentOrderStorageConfigured()) {
        throw new Error("Payment orders require durable KV storage in production.");
    }

    const orderCode = await reserveOrderCode();
    const cfg = PLAN_PRICING[opts.plan] || PLAN_PRICING.free;
    const totalAmount = opts.amountVnd ?? (opts.billingCycle === "annual"
        ? PLAN_VND_ANNUAL_TOTALS[opts.plan] ?? cfg.vndAnnualMonthly * 12
        : cfg.vndMonthly);
    const accessDurationDays = opts.accessDurationDays ?? (opts.billingCycle === "annual" ? 365 : 30);

    const memo = `MC${orderCode}`;
    const paymentLink = await createPayOSPaymentLink({
        orderCode,
        amount: totalAmount,
        description: memo,
        returnUrl: opts.returnUrl,
        cancelUrl: opts.cancelUrl,
        buyerEmail: opts.userEmail,
    });

    const order: VietQrOrder = {
        orderCode,
        plan: opts.plan,
        billingCycle: opts.billingCycle,
        amount: totalAmount,
        memo,
        status: "PENDING",
        userEmail: opts.userEmail,
        workspaceId: opts.workspaceId,
        createdAt: Date.now(),
        bankName: paymentLink.bin ? `Bank BIN ${paymentLink.bin}` : "PayOS",
        accountNo: paymentLink.accountNumber || "",
        accountName: paymentLink.accountName || "",
        qrUrl: "",
        qrCode: paymentLink.qrCode,
        checkoutUrl: paymentLink.checkoutUrl,
        paymentLinkId: paymentLink.paymentLinkId,
        accessDurationDays,
    };

    // Store the full order before returning a checkout URL. Do not continue if
    // storage fails: a link whose order cannot be reconciled must never reach a
    // customer.
    try {
        const redis = getRedis();
        await redis.set(`vietqr_order_${orderCode}`, JSON.stringify(order), { ex: 86400 });
        // Also keep a list of recent order codes for BD admin
        await redis.lpush("vietqr_recent_orders", String(orderCode));
        await redis.ltrim("vietqr_recent_orders", 0, 99); // Keep latest 100
    } catch (err) {
        logger.error("[VIETQR] Failed to durably write payment order", err);
        throw new Error("Payment order could not be stored. Please try again.");
    }

    logger.info("[VIETQR] Created order", { orderCode, plan: opts.plan, amount: totalAmount, memo });
    return order;
}

/**
 * Retrieve an existing order by orderCode
 */
export async function getVietQrOrder(orderCode: number): Promise<VietQrOrder | null> {
    try {
        const redis = getRedis();
        const raw = await redis.get(`vietqr_order_${orderCode}`);
        if (!raw) return null;
        return typeof raw === "string" ? JSON.parse(raw) : (raw as VietQrOrder);
    } catch (err) {
        logger.error("[VIETQR] Error fetching order from Redis", err);
        return null;
    }
}

/**
 * List recent VietQR orders for the BD Admin dashboard
 */
export async function listRecentVietQrOrders(limit = 20): Promise<VietQrOrder[]> {
    try {
        const redis = getRedis();
        const codes: string[] = (await redis.lrange("vietqr_recent_orders", 0, limit - 1)) || [];
        const orders: VietQrOrder[] = [];
        for (const code of codes) {
            const ord = await getVietQrOrder(Number(code));
            if (ord) orders.push(ord);
        }
        return orders;
    } catch (err) {
        logger.error("[VIETQR] Error listing recent orders", err);
        return [];
    }
}

/**
 * A bank transfer may exceed the order amount (overpayment), but must never be
 * less — underpayment must not fulfill (upgrade) an order.
 */
export function isTransferAmountValid(orderAmount: number, transferAmount: unknown): boolean {
    if (transferAmount === undefined || transferAmount === null) return true; // manual/admin-verified path
    const paid = Number(transferAmount);
    return Number.isFinite(paid) && paid >= orderAmount;
}

export function calculatePaidThrough(input: {
    currentPaidThrough?: Date | null;
    paidAt: Date;
    accessDurationDays: number;
}): Date {
    const current = input.currentPaidThrough?.getTime() ?? 0;
    const startsAt = Math.max(current, input.paidAt.getTime());
    return new Date(startsAt + input.accessDurationDays * 86_400_000);
}

/**
 * Fulfill payment: Upgrades workspace & user subscription in database
 */
export async function fulfillVietQrPayment(orderCode: number, transactionDetails?: Record<string, unknown>): Promise<{ success: boolean; message: string }> {
    const order = await getVietQrOrder(orderCode);
    if (!order) {
        return { success: false, message: `Order ${orderCode} not found` };
    }

    if (order.status === "PAID") {
        return { success: true, message: `Order ${orderCode} was already fulfilled` };
    }

    const transferredAmount = transactionDetails?.amount ?? transactionDetails?.transferAmount;
    if (!isTransferAmountValid(order.amount, transferredAmount)) {
        return {
            success: false,
            message: `Order ${orderCode} underpaid: expected >= ${order.amount}, received ${String(transferredAmount)}`,
        };
    }

    const redis = getRedis();
    const fulfillmentLockKey = `vietqr_order_fulfillment_${orderCode}`;
    const locked = await redis.setnx(fulfillmentLockKey, "1");
    if (locked !== 1) {
        const latest = await getVietQrOrder(orderCode);
        return latest?.status === "PAID"
            ? { success: true, message: `Order ${orderCode} was already fulfilled` }
            : { success: true, message: `Order ${orderCode} is already being fulfilled` };
    }
    await redis.expire(fulfillmentLockKey, 60);

    // Upgrade the bound workspace first. Marking the cached order paid before
    // this write succeeds would make a failed database update permanently look
    // fulfilled to a webhook retry.
    try {
        if (order.workspaceId) {
            const paidAt = new Date();
            const accessDurationDays = order.accessDurationDays ?? (order.billingCycle === "annual" ? 365 : 30);
            const paidThrough = await prisma.$transaction(async (tx) => {
                const workspace = await tx.workspace.findUnique({
                    where: { id: order.workspaceId },
                    select: { subscriptionEndsAt: true },
                });
                if (!workspace) throw new Error("Workspace not found");

                const subscriptionEndsAt = calculatePaidThrough({
                    currentPaidThrough: workspace.subscriptionEndsAt,
                    paidAt,
                    accessDurationDays,
                });
                await tx.workspace.update({
                    where: { id: order.workspaceId },
                    data: {
                        plan: order.plan,
                        status: "ACTIVE",
                        subscriptionProvider: "vietqr_domestic",
                        subscriptionId: `vietqr_${orderCode}`,
                        subscriptionEndsAt,
                    },
                });
                return subscriptionEndsAt;
            });
            logger.info(`[VIETQR] Upgraded workspace ${order.workspaceId} to ${order.plan}`);
            order.paidThroughAt = paidThrough.getTime();
        } else {
            // All orders created by the checkout endpoint are tenant-bound. A
            // fallback that upgrades every workspace owned by an email would
            // violate multi-tenant billing boundaries.
            return { success: false, message: `Order ${orderCode} is missing its workspace binding` };
        }

        order.status = "PAID";
        order.paidAt = Date.now();
        try {
            const redis = getRedis();
            await redis.set(`vietqr_order_${orderCode}`, JSON.stringify(order), { ex: 86400 * 30 }); // Keep 30 days
        } catch (cacheError) {
            // The plan update already succeeded. Report this loudly for repair,
            // but do not turn a confirmed payment into a failed customer result.
            logger.error(`[VIETQR] Payment ${orderCode} fulfilled but status cache update failed`, cacheError);
        }

        logger.info(`[VIETQR] Successfully fulfilled order ${orderCode}`, {
            amount: order.amount,
            plan: order.plan,
            transactionDetails,
        });

        return { success: true, message: `Order ${orderCode} fulfilled successfully` };
    } catch (err: any) {
        await redis.del(fulfillmentLockKey).catch(() => {});
        logger.error(`[VIETQR] Database update failed for order ${orderCode}`, err);
        return { success: false, message: err.message || "Database update failed" };
    }
}

/**
 * PayOS Webhook Checksum Verification (HMAC-SHA256)
 */
export function verifyPayOSWebhook(data: Record<string, unknown>, signature: string): boolean {
    return verifyPayOSData(data, signature);
}
