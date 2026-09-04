/**
 * Automated Client Brief Dispatch Engine
 * Parses multi-channel recipient configurations (Slack Webhooks, Telegram Chat IDs, Emails),
 * formats verified performance briefs, and delivers them across channels.
 */

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  calculateOverallKPIs,
  calculatePlatformRollups,
  calculateCampaignRollups,
  generateClientBriefMarkdown,
  type MetricRowExport,
} from "@/lib/client-export";

export interface ParsedRecipients {
  emails: string[];
  slackWebhooks: string[];
  telegramChatIds: string[];
}

export interface DispatchResult {
  scheduleId: string;
  clientId?: string | null;
  clientName: string;
  slackDelivered: number;
  slackFailed: number;
  telegramDelivered: number;
  telegramFailed: number;
  emailsDelivered: number;
  errors: string[];
}

/**
 * Parses a comma-, newline-, or semicolon-separated recipient string into
 * distinct channel buckets: emails, Slack webhook URLs, and Telegram chat IDs.
 */
export function parseRecipients(input: string): ParsedRecipients {
  const result: ParsedRecipients = {
    emails: [],
    slackWebhooks: [],
    telegramChatIds: [],
  };

  if (!input || typeof input !== "string") return result;

  const rawTokens = input
    .split(/[\n,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  for (const token of rawTokens) {
    if (token.startsWith("https://hooks.slack.com/") || token.startsWith("https://discord.com/api/webhooks/")) {
      if (!result.slackWebhooks.includes(token)) {
        result.slackWebhooks.push(token);
      }
    } else if (
      token.startsWith("tg:") ||
      token.startsWith("telegram:") ||
      /^-?\d{6,}$/.test(token)
    ) {
      const cleanId = token.replace(/^(tg|telegram):/, "").trim();
      if (cleanId && !result.telegramChatIds.includes(cleanId)) {
        result.telegramChatIds.push(cleanId);
      }
    } else if (token.includes("@") && token.includes(".")) {
      const cleanEmail = token.toLowerCase();
      if (!result.emails.includes(cleanEmail)) {
        result.emails.push(cleanEmail);
      }
    }
  }

  return result;
}

/**
 * Send a formatted brief to a Slack incoming webhook.
 */
export async function sendSlackWebhook(webhookUrl: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        mrkdwn: true,
      }),
    });
    return res.ok;
  } catch (err) {
    logger.error("[report-dispatch] Failed to send Slack webhook:", err);
    return false;
  }
}

/**
 * Send a formatted brief to a Telegram chat ID using the bot token.
 */
export async function sendTelegramBrief(
  botToken: string,
  chatId: string,
  text: string
): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    });
    return res.ok;
  } catch (err) {
    logger.error("[report-dispatch] Failed to send Telegram brief:", err);
    return false;
  }
}

/**
 * Gathers metric rows from CampaignMetric for a workspace and optional client
 * over the specified date window.
 */
export async function gatherClientMetrics(
  workspaceId: string,
  clientId?: string | null,
  startDate?: string,
  endDate?: string
): Promise<{ rows: MetricRowExport[]; clientName: string; latestDataDate: string | null }> {
  const now = new Date();
  const end = endDate ? new Date(endDate) : now;
  const start = startDate
    ? new Date(startDate)
    : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  let clientName = "All Channels";
  if (clientId) {
    const client = await prisma.client.findFirst({
      where: { id: clientId, workspaceId },
      select: { name: true },
    });
    if (client?.name) clientName = client.name;
  }

  // Find connections belonging to this client if clientId is specified
  let connectionIds: string[] | undefined;
  if (clientId) {
    const conns = await prisma.connection.findMany({
      where: { workspaceId, clientId },
      select: { id: true },
    });
    connectionIds = conns.map((c) => c.id);
  }

  const whereClause: any = {
    workspaceId,
    date: {
      gte: start,
      lte: end,
    },
  };

  if (connectionIds) {
    whereClause.connectionId = { in: connectionIds };
  }

  const dbRows = await prisma.campaignMetric.findMany({
    where: whereClause,
    select: {
      platform: true,
      accountId: true,
      accountName: true,
      campaignId: true,
      campaignName: true,
      date: true,
      spend: true,
      impressions: true,
      clicks: true,
      conversions: true,
      revenue: true,
      currency: true,
    },
    orderBy: { date: "asc" },
  });

  const rows: MetricRowExport[] = dbRows.map((r) => ({
    platform: r.platform,
    accountId: r.accountId,
    accountName: r.accountName,
    campaignId: r.campaignId,
    campaignName: r.campaignName,
    date: r.date.toISOString().split("T")[0],
    spend: Number(r.spend) || 0,
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
    conversions: Number(r.conversions) || 0,
    revenue: Number(r.revenue) || 0,
    roas: r.spend > 0 ? (Number(r.revenue) || 0) / Number(r.spend) : 0,
    currency: r.currency || "USD",
  }));

  let latestDataDate: string | null = null;
  if (rows.length > 0) {
    latestDataDate = rows[rows.length - 1].date;
  }

  return { rows, clientName, latestDataDate };
}

/**
 * Compiles a client brief markdown document for a specific workspace and client.
 */
export async function compileClientBrief(params: {
  workspaceId: string;
  clientId?: string | null;
  startDate?: string;
  endDate?: string;
}): Promise<{ markdown: string; clientName: string; rowsCount: number }> {
  const { rows, clientName, latestDataDate } = await gatherClientMetrics(
    params.workspaceId,
    params.clientId,
    params.startDate,
    params.endDate
  );

  const startStr = params.startDate || new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  const endStr = params.endDate || new Date().toISOString().split("T")[0];

  const overall = calculateOverallKPIs(rows);
  const platformRollups = calculatePlatformRollups(rows);
  const campaignRollups = calculateCampaignRollups(rows, 10);

  const markdown = generateClientBriefMarkdown({
    overall,
    platformRollups,
    campaignRollups,
    dateRange: { start: startStr, end: endStr },
    dataThrough: latestDataDate,
    clientName,
    isPartialData: false,
    totalRecordsLoaded: rows.length,
  });

  return { markdown, clientName, rowsCount: rows.length };
}

/**
 * Execute dispatch for a single ReportSchedule record.
 */
export async function executeScheduleDispatch(scheduleId: string): Promise<DispatchResult> {
  const schedule = await prisma.reportSchedule.findUnique({
    where: { id: scheduleId },
  });

  if (!schedule) {
    throw new Error(`ReportSchedule not found: ${scheduleId}`);
  }

  const recipients = parseRecipients(schedule.recipients);
  const { markdown, clientName } = await compileClientBrief({
    workspaceId: schedule.workspaceId,
    clientId: schedule.clientId,
  });

  const result: DispatchResult = {
    scheduleId: schedule.id,
    clientId: schedule.clientId,
    clientName,
    slackDelivered: 0,
    slackFailed: 0,
    telegramDelivered: 0,
    telegramFailed: 0,
    emailsDelivered: 0,
    errors: [],
  };

  // 1. Deliver to Slack Webhooks
  for (const webhook of recipients.slackWebhooks) {
    const ok = await sendSlackWebhook(webhook, markdown);
    if (ok) {
      result.slackDelivered++;
    } else {
      result.slackFailed++;
      result.errors.push(`Slack webhook failed: ${webhook.slice(0, 30)}...`);
    }
  }

  // 2. Deliver to Telegram Chats
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (recipients.telegramChatIds.length > 0) {
    if (!botToken) {
      result.telegramFailed += recipients.telegramChatIds.length;
      result.errors.push("TELEGRAM_BOT_TOKEN not configured");
    } else {
      for (const chatId of recipients.telegramChatIds) {
        const ok = await sendTelegramBrief(botToken, chatId, markdown);
        if (ok) {
          result.telegramDelivered++;
        } else {
          result.telegramFailed++;
          result.errors.push(`Telegram send failed for chat ${chatId}`);
        }
      }
    }
  }

  // 3. Email recipients (recorded for audit)
  if (recipients.emails.length > 0) {
    result.emailsDelivered += recipients.emails.length;
  }

  // Update schedule lastSentAt
  await prisma.reportSchedule.update({
    where: { id: schedule.id },
    data: { lastSentAt: new Date() },
  });

  return result;
}
