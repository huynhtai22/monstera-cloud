/**
 * Automated Client Brief Dispatch Engine
 * Parses multi-channel recipient configurations (Slack Webhooks, Telegram Chat IDs, Emails),
 * formats verified performance briefs, and delivers them across channels.
 */

import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendClientBriefEmail } from "@/lib/mail";
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
  emailsFailed: number;
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
 * The request is genuinely cancelled via `AbortSignal` when the per-request
 * timeout or the overall schedule deadline fires.
 */
export async function sendSlackWebhook(
  webhookUrl: string,
  text: string,
  delivery?: DispatchDeliveryOptions,
): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        mrkdwn: true,
      }),
      signal: composeDeliverySignal(
        delivery?.signal,
        delivery?.perRequestTimeoutMs ?? DISPATCH_PER_REQUEST_TIMEOUT_MS,
      ),
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
  text: string,
  delivery?: DispatchDeliveryOptions,
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
      signal: composeDeliverySignal(
        delivery?.signal,
        delivery?.perRequestTimeoutMs ?? DISPATCH_PER_REQUEST_TIMEOUT_MS,
      ),
    });
    return res.ok;
  } catch (err) {
    logger.error("[report-dispatch] Failed to send Telegram brief:", err);
    return false;
  }
}

/**
 * Evaluates whether a report schedule is due for execution.
 * Standard 5-part cron: minute hour day-of-month month day-of-week
 * Prevents repeat sends within the schedule cycle window.
 */
export function isScheduleDue(
  cronExpr: string,
  lastSentAt?: Date | string | null,
  now = new Date()
): boolean {
  if (!cronExpr || typeof cronExpr !== "string") return false;

  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const [, hourStr, domStr, monStr, dowStr] = parts;

  const currentHour = now.getUTCHours();
  const currentDom = now.getUTCDate();
  const currentMonth = now.getUTCMonth() + 1; // 1-12
  const currentDow = now.getUTCDay(); // 0-6 (0=Sun)

  // 1. Day of week check
  if (dowStr !== "*") {
    const allowedDows = dowStr.split(",").map((d) => {
      const num = parseInt(d.trim(), 10);
      return num === 7 ? 0 : num; // 7 is Sunday in standard cron
    });
    if (!allowedDows.includes(currentDow)) return false;
  }

  // 2. Month check
  if (monStr !== "*") {
    const allowedMonths = monStr.split(",").map((m) => parseInt(m.trim(), 10));
    if (!allowedMonths.includes(currentMonth)) return false;
  }

  // 3. Day of month check
  if (domStr !== "*") {
    const allowedDoms = domStr.split(",").map((d) => parseInt(d.trim(), 10));
    if (!allowedDoms.includes(currentDom)) return false;
  }

  // 4. Hour check:
  // When scheduled via cron, the schedule is due if currentHour >= targetHour
  if (hourStr !== "*") {
    const targetHour = parseInt(hourStr, 10);
    if (!isNaN(targetHour) && currentHour < targetHour) return false;
  }

  // 5. Prevent repeat dispatch if already sent in this cycle
  if (lastSentAt) {
    const lastSent = new Date(lastSentAt).getTime();
    if (!isNaN(lastSent)) {
      const elapsedMs = now.getTime() - lastSent;

      // If weekly (dow !== "*"), minimum 5 days before next send
      if (dowStr !== "*") {
        if (elapsedMs < 5 * 24 * 60 * 60 * 1000) return false;
      } else {
        // If daily, minimum 20 hours before next send
        if (elapsedMs < 20 * 60 * 60 * 1000) return false;
      }
    }
  }

  return true;
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
 * Durable dispatch-lease contract.
 *
 * Overlapping cron callers (GitHub Pilot cron, Vercel master cron) must never
 * deliver the same due schedule twice. `lastSentAt` is written only AFTER a
 * successful delivery, so it cannot prevent that overlap. Instead every
 * dispatching code path first atomically claims a bounded lease:
 *
 * - `claimScheduleDispatch` is one atomic updateMany whose predicate requires
 *   schedule identity, workspace identity, enabled state, an unchanged
 *   `lastSentAt` (compare-and-set against the scanned row) and no active
 *   lease. Affecting exactly one row makes the caller the sole owner.
 * - Completion is ownership-checked: `lastSentAt` is set and the lease is
 *   cleared in the same update, gated on the exact lease token.
 * - Handled failures release the lease (also ownership-checked) and leave
 *   `lastSentAt` untouched, keeping the schedule retryable.
 * - A crashed owner never releases: the lease simply expires (TTL below), and
 *   only then can another caller reclaim it. The TTL exceeds the enforced
 *   delivery budget (see DISPATCH_OVERALL_DEADLINE_MS) while staying far under
 *   the cron cadence (15 minutes for Pilot, daily for master), so crash
 *   recovery needs no manual action.
 * - No database transaction is held across provider/network delivery, and no
 *   `lastSentAt` is ever written before delivery succeeds.
 */
export const DISPATCH_LEASE_TTL_MS = 5 * 60 * 1000;

/**
 * Enforced delivery budget. Provider transports (Slack/Telegram fetch, email)
 * carry no deadlines of their own — without this budget a stalled endpoint
 * could keep a delivery alive past the lease TTL, letting another sweep
 * reclaim and re-deliver the same schedule. The overall deadline bounds the
 * COMPLETE schedule delivery (every Slack recipient, Telegram, and email,
 * sequentially), and every provider request additionally carries a per-request
 * timeout; both are strictly below the lease TTL:
 *
 *   DISPATCH_PER_REQUEST_TIMEOUT_MS (20s)
 *     < DISPATCH_OVERALL_DEADLINE_MS (90s)
 *       < DISPATCH_LEASE_TTL_MS (300s)   [safety margin: 210s]
 */
export const DISPATCH_PER_REQUEST_TIMEOUT_MS = 20_000;
export const DISPATCH_OVERALL_DEADLINE_MS = 90_000;

/** Sanitized internal reason used to abort deliveries that exceed the budget. */
export class DispatchDeadlineExceededError extends Error {
  constructor() {
    super("Dispatch deadline exceeded");
    this.name = "DispatchDeadlineExceededError";
  }
}

/** Options for one provider delivery attempt. */
export interface DispatchDeliveryOptions {
  /** Overall schedule deadline signal; composed with the per-request timeout. */
  signal?: AbortSignal;
  /** Per-request timeout override for deterministic tests. */
  perRequestTimeoutMs?: number;
}

/**
 * Composes the caller's overall deadline signal (if any) with a fresh
 * per-request timeout into the single signal handed to `fetch`, so transport
 * cancellation is genuine: aborting either deadline tears down the in-flight
 * request, not just an early return.
 */
function composeDeliverySignal(signal: AbortSignal | undefined, perRequestTimeoutMs: number): AbortSignal {
  const perRequest = AbortSignal.timeout(perRequestTimeoutMs);
  return signal ? AbortSignal.any([signal, perRequest]) : perRequest;
}

/** Bounds one complete schedule delivery; the abort reason is sanitized. */
class DispatchDeadline {
  readonly signal: AbortSignal;
  private readonly timer: NodeJS.Timeout;

  constructor(overallDeadlineMs: number) {
    const controller = new AbortController();
    this.timer = setTimeout(
      () => controller.abort(new DispatchDeadlineExceededError()),
      overallDeadlineMs,
    );
    this.signal = controller.signal;
  }

  get exceeded(): boolean {
    return this.signal.aborted;
  }

  dispose(): void {
    clearTimeout(this.timer);
  }
}

export interface DispatchLeaseOptions {
  /** Injected clock for deterministic tests; defaults to the current time. */
  now?: Date;
  /** Injected token source for deterministic tests; defaults to randomUUID. */
  tokenGenerator?: () => string;
  /** Injected TTL for deterministic tests; defaults to DISPATCH_LEASE_TTL_MS. */
  ttlMs?: number;
}

export async function claimScheduleDispatch(
  schedule: { id: string; workspaceId: string; lastSentAt?: Date | string | null },
  options?: DispatchLeaseOptions,
): Promise<string | null> {
  const now = options?.now ?? new Date();
  const token = (options?.tokenGenerator ?? randomUUID)();
  const expiresAt = new Date(now.getTime() + (options?.ttlMs ?? DISPATCH_LEASE_TTL_MS));
  const claimed = await prisma.reportSchedule.updateMany({
    where: {
      id: schedule.id,
      workspaceId: schedule.workspaceId,
      enabled: true,
      // Compare-and-set against the scanned row: if another sweep completed
      // this schedule between discovery and claim, the token is refused.
      lastSentAt: schedule.lastSentAt ?? null,
      OR: [{ dispatchLeaseToken: null }, { dispatchLeaseExpiresAt: { lte: now } }],
    },
    data: { dispatchLeaseToken: token, dispatchLeaseExpiresAt: expiresAt },
  });
  return claimed.count === 1 ? token : null;
}

/** Ownership-checked completion: `lastSentAt` + lease clear in one atomic update. */
export async function completeScheduleDispatch(
  scheduleId: string,
  workspaceId: string,
  token: string,
  options?: DispatchLeaseOptions,
): Promise<boolean> {
  const completed = await prisma.reportSchedule.updateMany({
    where: { id: scheduleId, workspaceId, dispatchLeaseToken: token },
    data: {
      lastSentAt: options?.now ?? new Date(),
      dispatchLeaseToken: null,
      dispatchLeaseExpiresAt: null,
    },
  });
  return completed.count === 1;
}

/** Ownership-checked release after handled failure: clears the lease, leaves `lastSentAt` untouched. */
export async function releaseScheduleDispatch(
  scheduleId: string,
  workspaceId: string,
  token: string,
): Promise<boolean> {
  const released = await prisma.reportSchedule.updateMany({
    where: { id: scheduleId, workspaceId, dispatchLeaseToken: token },
    data: { dispatchLeaseToken: null, dispatchLeaseExpiresAt: null },
  });
  return released.count === 1;
}

/**
 * Execute dispatch for a single ReportSchedule record.
 *
 * `lease` must be provided by concurrent-callers-facing code paths (the cron
 * route): completion then requires the exact lease token, and a handled
 * failure releases the lease without touching `lastSentAt`. A fenced (stale)
 * owner can neither complete nor release another caller's lease.
 */
export async function executeScheduleDispatch(
  scheduleId: string,
  lease?: { token: string },
  budget?: { overallDeadlineMs?: number; perRequestTimeoutMs?: number },
): Promise<DispatchResult> {
  const schedule = await prisma.reportSchedule.findUnique({
    where: { id: scheduleId },
  });

  if (!schedule) {
    throw new Error(`ReportSchedule not found: ${scheduleId}`);
  }

  // The overall deadline bounds the COMPLETE delivery of this schedule — every
  // Slack recipient, Telegram chat, and email, sequentially — and is strictly
  // below the dispatch lease TTL. Delivery options carry the deadline signal
  // plus a per-request timeout to every provider call, so stalled transports
  // are genuinely cancelled instead of outliving the lease.
  const deadline = new DispatchDeadline(budget?.overallDeadlineMs ?? DISPATCH_OVERALL_DEADLINE_MS);
  const perRequestTimeoutMs = budget?.perRequestTimeoutMs ?? DISPATCH_PER_REQUEST_TIMEOUT_MS;

  try {
    const recipients = parseRecipients(schedule.recipients);
    const { markdown, clientName } = await compileClientBrief({
      workspaceId: schedule.workspaceId,
      clientId: schedule.clientId,
    });

    const workspace = await prisma.workspace.findUnique({
      where: { id: schedule.workspaceId },
      select: { name: true },
    });
    const workspaceName = workspace?.name || "Monstera Cloud";

    const result: DispatchResult = {
      scheduleId: schedule.id,
      clientId: schedule.clientId,
      clientName,
      slackDelivered: 0,
      slackFailed: 0,
      telegramDelivered: 0,
      telegramFailed: 0,
      emailsDelivered: 0,
      emailsFailed: 0,
      errors: [],
    };

    // 1. Deliver to Slack Webhooks. Error strings are sanitized: no URLs,
    // chat IDs, email addresses, tokens, or raw provider responses.
    for (const webhook of recipients.slackWebhooks) {
      if (deadline.exceeded) {
        result.slackFailed++;
        result.errors.push("Slack webhook skipped: dispatch deadline exceeded.");
        continue;
      }
      const ok = await sendSlackWebhook(webhook, markdown, { signal: deadline.signal, perRequestTimeoutMs });
      if (ok) {
        result.slackDelivered++;
      } else {
        result.slackFailed++;
        result.errors.push("Slack webhook failed.");
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
          if (deadline.exceeded) {
            result.telegramFailed++;
            result.errors.push("Telegram send skipped: dispatch deadline exceeded.");
            continue;
          }
          const ok = await sendTelegramBrief(botToken, chatId, markdown, { signal: deadline.signal, perRequestTimeoutMs });
          if (ok) {
            result.telegramDelivered++;
          } else {
            result.telegramFailed++;
            result.errors.push("Telegram send failed.");
          }
        }
      }
    }

    // 3. Deliver to Email recipients
    for (const email of recipients.emails) {
      if (deadline.exceeded) {
        result.emailsFailed++;
        result.errors.push("Email send skipped: dispatch deadline exceeded.");
        continue;
      }
      const emailResult = await sendClientBriefEmail(
        email,
        clientName,
        workspaceName,
        markdown,
        { signal: AbortSignal.any([deadline.signal, AbortSignal.timeout(perRequestTimeoutMs)]) },
      );
      if (emailResult.success) {
        result.emailsDelivered++;
      } else {
        result.emailsFailed++;
        result.errors.push("Email send failed.");
      }
    }

    // Only advance lastSentAt if at least one delivery succeeded. With a lease,
    // completion and lease-clearing are the same ownership-checked atomic update;
    // a stale (fenced) owner can neither mark success nor clear another caller's
    // lease. A handled all-channel failure releases the lease so a later tick
    // can retry, while lastSentAt stays unchanged.
    const totalDelivered = result.slackDelivered + result.telegramDelivered + result.emailsDelivered;
    if (totalDelivered > 0) {
      if (lease) {
        const owned = await completeScheduleDispatch(schedule.id, schedule.workspaceId, lease.token);
        if (!owned) {
          logger.warn(
            `[report-dispatch] Dispatch of schedule ${schedule.id} delivered but its lease was taken over (expired); completion left to the current owner.`,
          );
        }
      } else {
        await prisma.reportSchedule.update({
          where: { id: schedule.id },
          data: { lastSentAt: new Date() },
        });
      }
    } else if (lease) {
      await releaseScheduleDispatch(schedule.id, schedule.workspaceId, lease.token);
    }

    return result;
  } finally {
    // No deadline timer, and therefore no delivery budget, survives the
    // dispatch: timed-out transports were already torn down via their signals.
    deadline.dispose();
  }
}
