/**
 * Agency alert service — Telegram notifications for sync failures.
 * Chat ID: per-workspace `telegramChatId` on Workspace, else TELEGRAM_CHAT_ID env.
 * Bot token: TELEGRAM_BOT_TOKEN (one bot for the Monstera deployment).
 *
 * Zalo: not integrated here. Use a generic webhook or email (cron) for other channels.
 */

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function sendAgencyAlert(opts: {
    workspaceId: string;
    pipelineName: string;
    errorMsg: string;
    clientId?: string | null;
}) {
    const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const ws = await prisma.workspace.findUnique({
        where: { id: opts.workspaceId },
        select: { telegramChatId: true },
    });
    const telegramChatId =
        ws?.telegramChatId?.trim() || process.env.TELEGRAM_CHAT_ID?.trim();

    if (!telegramBotToken || !telegramChatId) {
        logger.warn(
            "[ALERTS] Telegram bot token or chat id missing — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID or workspace Telegram chat ID in Settings."
        );
        return;
    }

    const clientName = opts.clientId
        ? `[Client ID: ${opts.clientId}]`
        : "[Unassigned]";

    const message = `
🚨 *Monstera Sync Failure*

*Pipeline:* ${opts.pipelineName}
*Client:* ${clientName}
*Workspace:* ${opts.workspaceId}
*Error:* ${opts.errorMsg.slice(0, 200)}

_Action Required: Check API credentials in dashboard._
    `.trim();

    try {
        const res = await fetch(
            `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: telegramChatId,
                    text: message,
                    parse_mode: "Markdown",
                }),
            }
        );
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            logger.error("[ALERTS] Telegram send failed", res.status, err);
        }
    } catch (e) {
        logger.error("[ALERTS] Failed to send Telegram alert", e);
    }
}
