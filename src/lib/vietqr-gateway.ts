/**
 * Payment order and fulfillment support for the PayOS hosted checkout.
 */

import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { PLAN_PRICING, PLAN_VND_ANNUAL_TOTALS, type PlanName } from "@/lib/plan-config";
import { createPayOSPaymentLink, verifyPayOSData } from "@/lib/payos";
import { withSystemScope } from "@/lib/tenant-guard";

export type VietQrOrderStatus = "CREATING" | "PENDING" | "PAID" | "EXPIRED" | "CANCELLED" | "FAILED";

export interface VietQrOrder {
    orderCode: number;
    plan: PlanName;
    billingCycle: "monthly" | "annual";
    amount: number;
    memo: string;
    status: VietQrOrderStatus;
    userEmail?: string;
    userId?: string;
    workspaceId?: string;
    createdAt: number;
    expiresAt?: number;
    paidAt?: number;
    fulfilledAt?: number;
    bankName: string;
    accountNo: string;
    accountName: string;
    qrUrl: string;
    /** EMVCo/VietQR payload returned directly by PayOS. */
    qrCode?: string;
    checkoutUrl?: string;
    paymentLinkId?: string;
    transactionRef?: string;
    /** Access term is fixed when the payment request is created, never by the browser. */
    accessDurationDays?: number;
    paidThroughAt?: number;
}

export function mapPaymentOrderToDto(record: {
    orderCode: bigint | number;
    plan: string;
    billingCycle: string;
    amount: number;
    status: string;
    workspaceId: string;
    userId?: string | null;
    createdAt: Date | number;
    expiresAt: Date | number;
    paidAt?: Date | number | null;
    fulfilledAt?: Date | number | null;
    paymentLinkId?: string | null;
    checkoutUrl?: string | null;
    qrCode?: string | null;
    transactionRef?: string | null;
    accessDurationDays: number;
}): VietQrOrder {
    const codeNum = typeof record.orderCode === "bigint" ? Number(record.orderCode) : record.orderCode;
    const createdAt = record.createdAt instanceof Date ? record.createdAt.getTime() : Number(record.createdAt);
    const expiresAt = record.expiresAt instanceof Date ? record.expiresAt.getTime() : Number(record.expiresAt);
    const paidAt = record.paidAt instanceof Date ? record.paidAt.getTime() : record.paidAt ? Number(record.paidAt) : undefined;
    const fulfilledAt = record.fulfilledAt instanceof Date ? record.fulfilledAt.getTime() : record.fulfilledAt ? Number(record.fulfilledAt) : undefined;

    return {
        orderCode: codeNum,
        plan: record.plan as PlanName,
        billingCycle: record.billingCycle as "monthly" | "annual",
        amount: record.amount,
        memo: `MC${codeNum}`,
        status: record.status as VietQrOrderStatus,
        userId: record.userId ?? undefined,
        workspaceId: record.workspaceId,
        createdAt,
        expiresAt,
        paidAt,
        fulfilledAt,
        bankName: "PayOS",
        accountNo: "",
        accountName: "",
        qrUrl: "",
        qrCode: record.qrCode ?? undefined,
        checkoutUrl: record.checkoutUrl ?? undefined,
        paymentLinkId: record.paymentLinkId ?? undefined,
        transactionRef: record.transactionRef ?? undefined,
        accessDurationDays: record.accessDurationDays,
    };
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
        process.env.DATABASE_URL?.trim() ||
        ((process.env.KV_URL?.trim() || process.env.KV_REST_API_URL?.trim()) &&
        process.env.KV_REST_API_TOKEN?.trim()),
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
    for (let attempt = 0; attempt < 10; attempt++) {
        const orderCode = generateOrderCode();
        try {
            const existing = await withSystemScope(() =>
                prisma.paymentOrder.findUnique({
                    where: { orderCode: BigInt(orderCode) },
                    select: { id: true },
                })
            );
            if (!existing) {
                return orderCode;
            }
        } catch {
            return orderCode;
        }
    }
    throw new Error("Could not reserve a unique payment order code. Please try again.");
}

/**
 * Create a new Domestic VietQR payment order in PostgreSQL before exposing checkout URL
 */
export async function createVietQrOrder(opts: {
    plan: PlanName;
    billingCycle: "monthly" | "annual";
    userEmail?: string;
    userId?: string;
    workspaceId?: string;
    returnUrl: string;
    cancelUrl: string;
    amountVnd?: number;
    accessDurationDays?: number;
}): Promise<VietQrOrder> {
    if (!opts.workspaceId) {
        throw new Error("Payment orders require a workspace binding.");
    }
    if (process.env.NODE_ENV === "production" && !isPaymentOrderStorageConfigured()) {
        throw new Error("Payment orders require durable storage in production.");
    }

    const orderCode = await reserveOrderCode();
    const cfg = PLAN_PRICING[opts.plan] || PLAN_PRICING.free;
    const totalAmount = opts.amountVnd ?? (opts.billingCycle === "annual"
        ? PLAN_VND_ANNUAL_TOTALS[opts.plan] ?? cfg.vndAnnualMonthly * 12
        : cfg.vndMonthly);
    const accessDurationDays = opts.accessDurationDays ?? (opts.billingCycle === "annual" ? 365 : 30);
    const now = new Date();
    // PayOS checkout validity: 30 minutes
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
    const memo = `MC${orderCode}`;

    // 1. Create database record BEFORE exposing checkout URL.
    let dbOrder: any;
    try {
        dbOrder = await withSystemScope(() =>
            prisma.paymentOrder.create({
                data: {
                    orderCode: BigInt(orderCode),
                    workspaceId: opts.workspaceId!,
                    userId: opts.userId,
                    plan: opts.plan,
                    billingCycle: opts.billingCycle,
                    amount: totalAmount,
                    currency: "VND",
                    accessDurationDays,
                    status: "CREATING",
                    expiresAt,
                },
            })
        );
    } catch (dbErr) {
        logger.error("[VIETQR] Failed to create database PaymentOrder before checkout", dbErr);
        throw new Error("Payment order could not be stored in database. Please try again.");
    }

    // 2. Request signed checkout from PayOS with 30-minute expiry
    let paymentLink: any;
    try {
        paymentLink = await createPayOSPaymentLink({
            orderCode,
            amount: totalAmount,
            description: memo,
            returnUrl: opts.returnUrl,
            cancelUrl: opts.cancelUrl,
            buyerEmail: opts.userEmail,
            expiredAt: Math.floor(expiresAt.getTime() / 1000),
        });
    } catch (payosError) {
        await withSystemScope(() =>
            prisma.paymentOrder.update({
                where: { id: dbOrder.id },
                data: { status: "FAILED" },
            })
        ).catch(() => {});
        logger.error("[VIETQR] Failed to create PayOS payment link", payosError);
        throw payosError;
    }

    // 3. Mark database order PENDING with payment details
    let updatedDbOrder: any;
    try {
        updatedDbOrder = await withSystemScope(() =>
            prisma.paymentOrder.update({
                where: { id: dbOrder.id },
                data: {
                    status: "PENDING",
                    paymentLinkId: paymentLink.paymentLinkId,
                    checkoutUrl: paymentLink.checkoutUrl,
                    qrCode: paymentLink.qrCode,
                },
            })
        );
    } catch (updateErr) {
        logger.error("[VIETQR] Failed to update PaymentOrder to PENDING", updateErr);
        throw new Error("Payment order could not be finalized. Please try again.");
    }

    const orderDto = mapPaymentOrderToDto(updatedDbOrder);
    if (opts.userEmail) orderDto.userEmail = opts.userEmail;
    if (paymentLink.bin) orderDto.bankName = `Bank BIN ${paymentLink.bin}`;
    if (paymentLink.accountNumber) orderDto.accountNo = paymentLink.accountNumber;
    if (paymentLink.accountName) orderDto.accountName = paymentLink.accountName;

    // 4. Redis is an optional cache only
    try {
        const redis = getRedis();
        await redis.set(`vietqr_order_${orderCode}`, JSON.stringify(orderDto), { ex: 1800 });
        await redis.lpush("vietqr_recent_orders", String(orderCode));
        await redis.ltrim("vietqr_recent_orders", 0, 99);
    } catch (cacheErr) {
        logger.warn("[VIETQR] Failed to cache order in Redis, continuing with database authority", cacheErr);
    }

    logger.info("[VIETQR] Created durable order in PostgreSQL", {
        orderCode,
        plan: opts.plan,
        amount: totalAmount,
        workspaceId: opts.workspaceId,
        expiresAt: expiresAt.toISOString(),
    });

    return orderDto;
}

/**
 * Retrieve an existing order by orderCode with PostgreSQL authoritative check
 */
export async function getVietQrOrder(orderCode: number): Promise<VietQrOrder | null> {
    // 1. PostgreSQL is authoritative
    try {
        const dbOrder = await withSystemScope(() =>
            prisma.paymentOrder.findUnique({
                where: { orderCode: BigInt(orderCode) },
            })
        );
        if (dbOrder) {
            return mapPaymentOrderToDto(dbOrder);
        }
    } catch (err) {
        logger.warn("[VIETQR] Error fetching order from PostgreSQL, checking Redis cache fallback", err);
    }

    // 2. Redis fallback for legacy orders
    try {
        const redis = getRedis();
        const raw = await redis.get(`vietqr_order_${orderCode}`);
        if (raw) return typeof raw === "string" ? JSON.parse(raw) : (raw as VietQrOrder);
    } catch (err) {
        logger.error("[VIETQR] Error fetching order from Redis fallback", err);
    }

    return null;
}

/**
 * List recent VietQR orders for the BD Admin dashboard
 */
export async function listRecentVietQrOrders(limit = 20): Promise<VietQrOrder[]> {
    try {
        const dbOrders = await withSystemScope(() =>
            prisma.paymentOrder.findMany({
                orderBy: { createdAt: "desc" },
                take: limit,
            })
        );
        if (dbOrders.length > 0) {
            return dbOrders.map(mapPaymentOrderToDto);
        }
    } catch (err) {
        logger.warn("[VIETQR] Error listing recent orders from DB, falling back to Redis", err);
    }

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
        logger.error("[VIETQR] Error listing recent orders from Redis", err);
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
 * Fulfill payment in one database transaction:
 * - claims only pending order
 * - validates workspace binding and amount
 * - extends subscription
 * - marks order paid with transaction reference
 * - writes a sanitized audit event
 * - returns success without double-extending on duplicate delivery
 */
export async function fulfillVietQrPayment(
    orderCode: number,
    transactionDetails?: Record<string, unknown>
): Promise<{ success: boolean; message: string; duplicate?: boolean }> {
    const transferredAmount = transactionDetails?.amount ?? transactionDetails?.transferAmount;
    const transactionRef = String(
        transactionDetails?.reference ??
        transactionDetails?.paymentLinkId ??
        transactionDetails?.transactionId ??
        ""
    );

    return withSystemScope(async () => {
        return prisma.$transaction(async (tx) => {
            // 1. Claim only a pending order from authoritative DB
            const order = await tx.paymentOrder.findUnique({
                where: { orderCode: BigInt(orderCode) },
            });

            if (!order) {
                // Fallback for legacy cache-only order
                const legacyOrder = await getVietQrOrder(orderCode);
                if (!legacyOrder) {
                    return { success: false, message: `Order ${orderCode} not found` };
                }
                if (legacyOrder.status === "PAID") {
                    return { success: true, message: `Order ${orderCode} was already fulfilled`, duplicate: true };
                }
                if (!legacyOrder.workspaceId) {
                    return { success: false, message: `Order ${orderCode} is missing its workspace binding` };
                }
                if (!isTransferAmountValid(legacyOrder.amount, transferredAmount)) {
                    return {
                        success: false,
                        message: `Order ${orderCode} underpaid: expected >= ${legacyOrder.amount}, received ${String(transferredAmount)}`,
                    };
                }
                const workspace = await tx.workspace.findUnique({
                    where: { id: legacyOrder.workspaceId },
                    select: { id: true, subscriptionEndsAt: true },
                });
                if (!workspace) return { success: false, message: `Workspace ${legacyOrder.workspaceId} not found` };
                const paidAt = new Date();
                const accessDurationDays = legacyOrder.accessDurationDays ?? (legacyOrder.billingCycle === "annual" ? 365 : 30);
                const subscriptionEndsAt = calculatePaidThrough({
                    currentPaidThrough: workspace.subscriptionEndsAt,
                    paidAt,
                    accessDurationDays,
                });
                await tx.workspace.update({
                    where: { id: legacyOrder.workspaceId },
                    data: {
                        plan: legacyOrder.plan,
                        status: "ACTIVE",
                        subscriptionProvider: "vietqr_domestic",
                        subscriptionId: `vietqr_${orderCode}`,
                        subscriptionEndsAt,
                    },
                });
                return { success: true, message: `Order ${orderCode} fulfilled successfully` };
            }

            // Duplicate webhook: return success without extending access twice
            if (order.status === "PAID") {
                logger.info(`[VIETQR] Duplicate webhook for order ${orderCode}; already paid.`);
                return { success: true, message: `Order ${orderCode} was already fulfilled`, duplicate: true };
            }

            // Expiry check
            const now = new Date();
            if (order.expiresAt && order.expiresAt < now) {
                await tx.paymentOrder.update({
                    where: { id: order.id },
                    data: { status: "EXPIRED" },
                });
                return { success: false, message: `Order ${orderCode} has expired` };
            }

            // Claim only PENDING or CREATING orders
            if (order.status !== "PENDING" && order.status !== "CREATING") {
                return { success: false, message: `Order ${orderCode} cannot be fulfilled in status ${order.status}` };
            }

            // Validate workspace binding
            if (!order.workspaceId) {
                return { success: false, message: `Order ${orderCode} is missing its workspace binding` };
            }

            // Validate transferred amount (must never underpay)
            if (!isTransferAmountValid(order.amount, transferredAmount)) {
                return {
                    success: false,
                    message: `Order ${orderCode} underpaid: expected >= ${order.amount}, received ${String(transferredAmount)}`,
                };
            }

            // Extend subscription
            const workspace = await tx.workspace.findUnique({
                where: { id: order.workspaceId },
                select: { id: true, subscriptionEndsAt: true },
            });
            if (!workspace) {
                return { success: false, message: `Workspace ${order.workspaceId} not found` };
            }

            const paidAt = now;
            const accessDurationDays = order.accessDurationDays ?? (order.billingCycle === "annual" ? 365 : 30);
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

            // Mark order paid with transaction reference and fulfillment timestamp
            await tx.paymentOrder.update({
                where: { id: order.id },
                data: {
                    status: "PAID",
                    paidAt,
                    fulfilledAt: paidAt,
                    transactionRef: transactionRef || undefined,
                    metadata: transactionDetails ? (transactionDetails as any) : undefined,
                },
            });

            // Write sanitized audit event
            await tx.auditEvent.create({
                data: {
                    workspaceId: order.workspaceId,
                    actorUserId: order.userId,
                    action: "subscription.activated",
                    resource: "PaymentOrder",
                    resourceId: order.id,
                    metadata: {
                        orderCode: Number(order.orderCode),
                        plan: order.plan,
                        billingCycle: order.billingCycle,
                        amount: order.amount,
                        paidAt: paidAt.toISOString(),
                        subscriptionEndsAt: subscriptionEndsAt.toISOString(),
                        transactionRef: transactionRef || null,
                    },
                },
            });

            // Optional Redis cache update
            try {
                const redis = getRedis();
                const cachedDto: VietQrOrder = {
                    ...mapPaymentOrderToDto(order),
                    status: "PAID",
                    paidAt: paidAt.getTime(),
                    fulfilledAt: paidAt.getTime(),
                    paidThroughAt: subscriptionEndsAt.getTime(),
                    transactionRef,
                };
                await redis.set(`vietqr_order_${orderCode}`, JSON.stringify(cachedDto), { ex: 86400 * 30 });
            } catch {
                // Redis cache failure does not fail transaction
            }

            logger.info(`[VIETQR] Successfully fulfilled order ${orderCode} in database transaction`, {
                orderCode,
                workspaceId: order.workspaceId,
                plan: order.plan,
                amount: order.amount,
                subscriptionEndsAt: subscriptionEndsAt.toISOString(),
            });

            return { success: true, message: `Order ${orderCode} fulfilled successfully` };
        });
    });
}

/**
 * PayOS Webhook Checksum Verification (HMAC-SHA256)
 */
export function verifyPayOSWebhook(data: Record<string, unknown>, signature: string): boolean {
    return verifyPayOSData(data, signature);
}
