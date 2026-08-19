import { NextRequest, NextResponse } from "next/server";
import { createVietQrOrder } from "@/lib/vietqr-gateway";
import { type PlanName } from "@/lib/plan-config";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { plan, billingCycle = "monthly", userEmail, workspaceId } = body;

        if (!plan || !["starter", "professional", "enterprise"].includes(plan)) {
            return NextResponse.json({ error: "Invalid plan specified" }, { status: 400 });
        }

        const order = await createVietQrOrder({
            plan: plan as PlanName,
            billingCycle: billingCycle === "annual" ? "annual" : "monthly",
            userEmail,
            workspaceId,
        });

        return NextResponse.json({
            success: true,
            order,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Failed to create QR order" }, { status: 500 });
    }
}
