/**
 * Payment order and fulfillment support for the PayOS hosted checkout.
 */

import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { PLAN_PRICING, type PlanName } from "@/lib/plan-config";
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
    checkoutUrl?: string;
    paymentLinkId?: string;
}

/**
 * Generate unique 6-digit numeric order code (e.g. 183920)
 */
function generateOrderCode(): number {
    return Math.floor(100000 + Math.random() * 900000);
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
}): Promise<VietQrOrder> {
    const orderCode = generateOrderCode();
    const cfg = PLAN_PRICING[opts.plan] || PLAN_PRICING.free;
    const monthlyPrice = opts.billingCycle === "annual" ? cfg.vndAnnualMonthly : cfg.vndMonthly;
    const totalAmount = opts.billingCycle === "annual" ? monthlyPrice * 12 : monthlyPrice;

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
        bankName: "PayOS",
        accountNo: "",
        accountName: "",
        qrUrl: "",
        checkoutUrl: paymentLink.checkoutUrl,
        paymentLinkId: paymentLink.paymentLinkId,
    };

    // Store order in Redis with 24-hour TTL (86400s)
    try {
        const redis = getRedis();
        await redis.set(`vietqr_order_${orderCode}`, JSON.stringify(order), { ex: 86400 });
        // Also keep a list of recent order codes for BD admin
        await redis.lpush("vietqr_recent_orders", String(orderCode));
        await redis.ltrim("vietqr_recent_orders", 0, 99); // Keep latest 100
    } catch (err) {
        logger.warn("[VIETQR] Failed to write order to Redis, continuing in memory", err);
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

    // Mark as PAID
    order.status = "PAID";
    order.paidAt = Date.now();

    try {
        const redis = getRedis();
        await redis.set(`vietqr_order_${orderCode}`, JSON.stringify(order), { ex: 86400 * 30 }); // Keep 30 days
    } catch {
        // continue
    }

    // Upgrade Workspace / User in Database
    try {
        if (order.workspaceId) {
            await prisma.workspace.update({
                where: { id: order.workspaceId },
                data: {
                    plan: order.plan,
                    status: "ACTIVE",
                    subscriptionProvider: "vietqr_domestic",
                    subscriptionId: `vietqr_${orderCode}`,
                },
            });
            logger.info(`[VIETQR] Upgraded workspace ${order.workspaceId} to ${order.plan}`);
        } else if (order.userEmail) {
            // Find user and their owned workspace
            const user = await prisma.user.findUnique({
                where: { email: order.userEmail },
                include: { workspaces: { include: { workspace: true } } },
            });

            if (user) {
                await prisma.user.update({
                    where: { id: user.id },
                    data: { plan: order.plan, subscriptionId: `vietqr_${orderCode}` },
                });

                // Upgrade all workspaces where this user is owner
                const ownedWorkspaces = user.workspaces.filter((wm) => wm.role === "owner");
                for (const wm of ownedWorkspaces) {
                    await prisma.workspace.update({
                        where: { id: wm.workspaceId },
                        data: {
                            plan: order.plan,
                            status: "ACTIVE",
                            subscriptionProvider: "vietqr_domestic",
                            subscriptionId: `vietqr_${orderCode}`,
                        },
                    });
                    logger.info(`[VIETQR] Upgraded workspace ${wm.workspaceId} for user ${user.email} to ${order.plan}`);
                }
            }
        }

        logger.info(`[VIETQR] Successfully fulfilled order ${orderCode}`, {
            amount: order.amount,
            plan: order.plan,
            transactionDetails,
        });

        return { success: true, message: `Order ${orderCode} fulfilled successfully` };
    } catch (err: any) {
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
