/**
 * Monstera Cloud - Domestic Vietnamese QR Payment Gateway (VietQR / PayOS / SePay)
 *
 * Supports:
 * 1. 100% In-House Direct VietQR (Napas 24/7 with manual / BD 1-click confirmation)
 * 2. PayOS.vn Open Banking API & Webhooks (Zero fees, automated 24/7)
 * 3. SePay.vn Bank Balance Webhook Receiver
 */

import crypto from "crypto";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { PLAN_PRICING, type PlanName } from "@/lib/plan-config";

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
}

// Bank Default Settings (Configurable via Environment Variables)
export function getBankConfig() {
    return {
        bankId: (process.env.VIETQR_BANK_ID || "TCB").trim(), // TCB, VCB, MB, ACB, VPB, etc.
        bankName: (process.env.VIETQR_BANK_NAME || "Techcombank").trim(),
        accountNo: (process.env.VIETQR_ACCOUNT_NO || "19036348292019").trim(),
        accountName: (process.env.VIETQR_ACCOUNT_NAME || "HUYNH CAM TAI").trim(),
    };
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
}): Promise<VietQrOrder> {
    const orderCode = generateOrderCode();
    const cfg = PLAN_PRICING[opts.plan] || PLAN_PRICING.free;
    const monthlyPrice = opts.billingCycle === "annual" ? cfg.vndAnnualMonthly : cfg.vndMonthly;
    const totalAmount = opts.billingCycle === "annual" ? monthlyPrice * 12 : monthlyPrice;

    const bank = getBankConfig();
    const memo = `MC${orderCode}`;

    // Standard Napas 24/7 VietQR API format (img.vietqr.io)
    const qrUrl = `https://img.vietqr.io/image/${bank.bankId}-${bank.accountNo}-compact2.png?amount=${totalAmount}&addInfo=${encodeURIComponent(
        memo
    )}&accountName=${encodeURIComponent(bank.accountName)}`;

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
        bankName: bank.bankName,
        accountNo: bank.accountNo,
        accountName: bank.accountName,
        qrUrl,
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
    const checksumKey = process.env.PAYOS_CHECKSUM_KEY;
    if (!checksumKey) return true; // If not set in development, bypass

    try {
        // Sort keys alphabetically and construct query string format
        const sortedKeys = Object.keys(data).sort();
        const dataStr = sortedKeys.map((k) => `${k}=${data[k]}`).join("&");
        const hmac = crypto.createHmac("sha256", checksumKey).update(dataStr).digest("hex");
        return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
    } catch {
        return false;
    }
}
