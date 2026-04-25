import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * POST /api/workspaces/[id]/test-telegram
 * Sends a test message to the workspace Telegram chat (or env fallback).
 */
export async function POST(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id: workspaceId } = await params;
        const membership = await (prisma.workspaceMember as any).findUnique({
            where: {
                workspaceId_userId: { workspaceId, userId: session.user.id },
            },
        });
        if (!membership) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

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
        logger.error("[test-telegram]", e);
        return NextResponse.json(
            { error: e instanceof Error ? e.message : "Failed" },
            { status: 500 }
        );
    }
}
