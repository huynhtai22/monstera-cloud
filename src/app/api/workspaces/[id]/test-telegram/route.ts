import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";

/**
 * POST /api/workspaces/[id]/test-telegram
 * Sends a test message to the workspace Telegram chat (or env fallback).
 */
export async function POST(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getAuthSession();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id: workspaceId } = await params;
        await requireWorkspaceAccess({
            userId: session.user.id,
            workspaceId,
            minimumRole: "admin",
            operation: "test_workspace_notification",
        });

        const ws = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { name: true, telegramChatId: true },
        });
        if (!ws) {
            return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
        }

        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const chatId =
            ws.telegramChatId?.trim() || process.env.TELEGRAM_CHAT_ID?.trim();
        if (!botToken || !chatId) {
            return NextResponse.json(
                {
                    error:
                        "Configure TELEGRAM_BOT_TOKEN and a chat ID (workspace field or TELEGRAM_CHAT_ID).",
                },
                { status: 400 }
            );
        }

        const text = `✅ Monstera test alert\nWorkspace: ${ws.name}\nThis confirms Telegram delivery for sync-failure notifications.`;

        const tgRes = await fetch(
            `https://api.telegram.org/bot${botToken}/sendMessage`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: chatId,
                    text,
                }),
            }
        );
        const tgJson = await tgRes.json().catch(() => ({}));
        if (!tgRes.ok) {
            return NextResponse.json(
                {
                    error:
                        typeof tgJson?.description === "string"
                            ? tgJson.description
                            : "Telegram API error",
                    details: tgJson,
                },
                { status: 502 }
            );
        }

        return NextResponse.json({ ok: true });
    } catch (e: unknown) {
        const rbac = toRbacResponse(e);
        if (rbac) return rbac;
        logger.error("[test-telegram]", e);
        return NextResponse.json(
            { error: e instanceof Error ? e.message : "Failed" },
            { status: 500 }
        );
    }
}
