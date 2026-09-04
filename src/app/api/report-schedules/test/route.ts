import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import {
  parseRecipients,
  compileClientBrief,
  sendSlackWebhook,
  sendTelegramBrief,
} from "@/lib/report-dispatch";

/**
 * POST /api/report-schedules/test
 * Immediately delivers a test client brief to the specified recipients or schedule.
 */
export async function POST(req: Request) {
  try {
    const session = await getAuthSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { workspaceId, clientId, recipients: rawRecipients } = body;

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    if (!rawRecipients || typeof rawRecipients !== "string") {
      return NextResponse.json({ error: "recipients string is required" }, { status: 400 });
    }

    await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "member" });

    const recipients = parseRecipients(rawRecipients);
    if (
      recipients.emails.length === 0 &&
      recipients.slackWebhooks.length === 0 &&
      recipients.telegramChatIds.length === 0
    ) {
      return NextResponse.json(
        { error: "No valid recipient email, Slack webhook URL, or Telegram chat ID found" },
        { status: 400 }
      );
    }

    const { markdown, clientName } = await compileClientBrief({
      workspaceId,
      clientId,
    });

    const testHeader = `🧪 *[TEST DISPATCH]*\n`;
    const messageToSend = testHeader + markdown;

    let slackDelivered = 0;
    let slackFailed = 0;
    let telegramDelivered = 0;
    let telegramFailed = 0;
    const errors: string[] = [];

    // Send Slack
    for (const webhook of recipients.slackWebhooks) {
      const ok = await sendSlackWebhook(webhook, messageToSend);
      if (ok) {
        slackDelivered++;
      } else {
        slackFailed++;
        errors.push("Failed to deliver to Slack webhook");
      }
    }

    // Send Telegram
    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (recipients.telegramChatIds.length > 0) {
      if (!botToken) {
        telegramFailed += recipients.telegramChatIds.length;
        errors.push("TELEGRAM_BOT_TOKEN not configured on server");
      } else {
        for (const chatId of recipients.telegramChatIds) {
          const ok = await sendTelegramBrief(botToken, chatId, messageToSend);
          if (ok) {
            telegramDelivered++;
          } else {
            telegramFailed++;
            errors.push(`Telegram delivery failed for ${chatId}`);
          }
        }
      }
    }

    return NextResponse.json({
      success: errors.length === 0 || slackDelivered > 0 || telegramDelivered > 0,
      clientName,
      slackDelivered,
      slackFailed,
      telegramDelivered,
      telegramFailed,
      emailRecipients: recipients.emails,
      errors,
    });
  } catch (error: unknown) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to execute test dispatch" },
      { status: 500 }
    );
  }
}
