import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * /api/report-schedules
 *
 * Agency layer: per-client weekly report schedules.
 *
 *   GET    ?workspaceId=...          → list schedules for a workspace
 *   POST   { workspaceId, clientId?, recipients, cron?, enabled? }
 *                                      → upsert (one schedule per workspace+clientId)
 *   PATCH  { id, enabled?, recipients?, cron? }
 *                                      → pause / resume / edit
 *   DELETE ?id=...                   → remove
 */

async function requireMembership(workspaceId: string, userId: string) {
    const membership = await (prisma.workspaceMember as any).findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
    });
    return !!membership;
}

export async function GET(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const workspaceId = searchParams.get("workspaceId");
        if (!workspaceId) {
            return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
        }

        if (!(await requireMembership(workspaceId, session.user.id))) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const rows = await (prisma as any).reportSchedule.findMany({
            where: { workspaceId },
            orderBy: { createdAt: "desc" },
        });

        return NextResponse.json(rows);
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || "Failed" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const {
            workspaceId,
            clientId,
            recipients,
            cron,
            enabled,
        }: {
            workspaceId?: string;
            clientId?: string | null;
            recipients?: string;
            cron?: string;
            enabled?: boolean;
        } = body || {};

        if (!workspaceId || !recipients || !recipients.trim()) {
            return NextResponse.json(
                { error: "workspaceId and recipients are required" },
                { status: 400 }
            );
        }

        if (!(await requireMembership(workspaceId, session.user.id))) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        // Normalize recipient list
        const cleaned = recipients
            .split(/[,\n;]/)
            .map((s) => s.trim())
            .filter(Boolean);
        if (cleaned.length === 0) {
            return NextResponse.json({ error: "At least one recipient email required" }, { status: 400 });
        }

        const normalizedClientId = clientId && !clientId.startsWith("mock_client_") ? clientId : null;

        // Upsert: one schedule per (workspace, client) pair.
        const existing = await (prisma as any).reportSchedule.findFirst({
            where: { workspaceId, clientId: normalizedClientId },
        });

        const data = {
            workspaceId,
            clientId: normalizedClientId,
            recipients: cleaned.join(","),
            cron: cron && cron.trim() ? cron.trim() : "0 9 * * 1",
            enabled: typeof enabled === "boolean" ? enabled : true,
        };

        let row;
        if (existing) {
            row = await (prisma as any).reportSchedule.update({
                where: { id: existing.id },
                data,
            });
        } else {
            row = await (prisma as any).reportSchedule.create({ data });
        }

        return NextResponse.json(row, { status: existing ? 200 : 201 });
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || "Failed" }, { status: 500 });
    }
}

export async function PATCH(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { id, enabled, recipients, cron } = body || {};
        if (!id) {
            return NextResponse.json({ error: "id is required" }, { status: 400 });
        }

        const row = await (prisma as any).reportSchedule.findUnique({ where: { id } });
        if (!row) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        if (!(await requireMembership(row.workspaceId, session.user.id))) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const data: Record<string, unknown> = {};
        if (typeof enabled === "boolean") data.enabled = enabled;
        if (typeof recipients === "string" && recipients.trim()) {
            const cleaned = recipients
                .split(/[,\n;]/)
                .map((s) => s.trim())
                .filter(Boolean);
            if (cleaned.length === 0) {
                return NextResponse.json({ error: "At least one recipient email required" }, { status: 400 });
            }
            data.recipients = cleaned.join(",");
        }
        if (typeof cron === "string" && cron.trim()) {
            data.cron = cron.trim();
        }

        if (Object.keys(data).length === 0) {
            return NextResponse.json({ error: "No fields to update" }, { status: 400 });
        }

        const updated = await (prisma as any).reportSchedule.update({
            where: { id },
            data,
        });
        return NextResponse.json(updated);
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || "Failed" }, { status: 500 });
    }
}

export async function DELETE(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");
        if (!id) {
            return NextResponse.json({ error: "id is required" }, { status: 400 });
        }

        const row = await (prisma as any).reportSchedule.findUnique({ where: { id } });
        if (!row) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        if (!(await requireMembership(row.workspaceId, session.user.id))) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        await (prisma as any).reportSchedule.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || "Failed" }, { status: 500 });
    }
}
