import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getVietQrOrder } from "@/lib/vietqr-gateway";
import { isPlatformAdminEmail } from "@/lib/admin-auth";
import prisma from "@/lib/prisma";

/**
 * Order status lookup. Orders contain plan/amount/paidAt details, so access is
 * limited to: platform admins, members of the order's workspace, or the user
 * whose email created the order. Previously this leaked any order's details
 * without authentication.
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ orderCode: string }> }
) {
    const session = await getAuthSession();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { orderCode } = await params;
        const codeNum = parseInt(orderCode, 10);
        if (isNaN(codeNum)) {
            return NextResponse.json({ error: "Invalid order code" }, { status: 400 });
        }

        const order = await getVietQrOrder(codeNum);
        if (!order) {
            return NextResponse.json({ error: "Order not found" }, { status: 404 });
        }

        const isAdmin = isPlatformAdminEmail(session.user.email);
        if (!isAdmin) {
            let allowed = false;
            if (order.workspaceId) {
                const membership = await prisma.workspaceMember.findFirst({
                    where: { workspaceId: order.workspaceId, userId: session.user.id },
                    select: { id: true },
                });
                allowed = Boolean(membership);
            }
            if (!allowed && order.userEmail) {
                allowed = order.userEmail.trim().toLowerCase() === (session.user.email ?? "").trim().toLowerCase();
            }
            if (!allowed) {
                return NextResponse.json({ error: "Access denied" }, { status: 403 });
            }
        }

        return NextResponse.json({
            success: true,
            status: order.status,
            orderCode: order.orderCode,
            plan: order.plan,
            amount: order.amount,
            paidAt: order.paidAt,
            paidThroughAt: order.paidThroughAt,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to check status" }, { status: 500 });
    }
}
