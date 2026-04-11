/**
 * Agency Alert Service
 * Supports Telegram notifications for sync failures.
 */

export async function sendAgencyAlert(opts: {
    workspaceId: string;
    pipelineName: string;
    errorMsg: string;
    clientId?: string | null;
}) {
    // 1. Fetch Alert Config for this workspace (Stored in Workspace model or env for now)
    const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    if (!telegramBotToken || !telegramChatId) {
        console.warn("[ALERTS] Telegram config missing, skipping alert.");
        return;
    }

    const clientName = opts.clientId ? `[Client ID: ${opts.clientId}]` : "[Unassigned]";
    
    const message = `
🚨 *Monstera Sync Failure*
    
*Pipeline:* ${opts.pipelineName}
*Client:* ${clientName}
*Workspace:* ${opts.workspaceId}
*Error:* ${opts.errorMsg.slice(0, 200)}

_Action Required: Check API credentials in dashboard._
    `.trim();

    try {
        await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: telegramChatId,
                text: message,
                parse_mode: 'Markdown'
            })
        });
    } catch (e) {
        console.error("[ALERTS] Failed to send Telegram alert", e);
    }
}
