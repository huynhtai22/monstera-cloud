/** Durable, at-least-once Telegram delivery for workspace operations alerts. */
import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withSystemScope } from "@/lib/tenant-guard";

const MAX_ATTEMPTS = 12;
const DELIVERY_LEASE_MS = 30_000;
const MAX_RETRY_MS = 6 * 60 * 60 * 1000;

function sanitizeAlertText(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization)\s*[:=]\s*["']?[^,\s"'}]+/gi, "$1=[redacted]");
}

export async function sendAgencyAlert(opts: {
  workspaceId: string;
  pipelineName: string;
  errorMsg: string;
  clientId?: string | null;
  actionHint?: string;
  /** Stable key deduplicates repeat notifications for the same incident. */
  idempotencyKey?: string;
}) {
  const alert = await withSystemScope(() => prisma.agencyAlertDelivery.create({
    data: {
      workspaceId: opts.workspaceId,
      idempotencyKey: opts.idempotencyKey ?? randomUUID(),
      pipelineName: sanitizeAlertText(opts.pipelineName).slice(0, 200),
      clientId: opts.clientId ?? null,
      errorMsg: sanitizeAlertText(opts.errorMsg).slice(0, 1000),
      actionHint: opts.actionHint ? sanitizeAlertText(opts.actionHint).slice(0, 500) : null,
    },
    select: { id: true },
  })).catch(async (error: unknown) => {
    if ((error as { code?: string })?.code !== "P2002" || !opts.idempotencyKey) throw error;
    return withSystemScope(() => prisma.agencyAlertDelivery.findUnique({
      where: { workspaceId_idempotencyKey: { workspaceId: opts.workspaceId, idempotencyKey: opts.idempotencyKey! } },
      select: { id: true },
    }));
  });

  if (!alert) throw new Error("Could not persist agency alert");
  await dispatchAgencyAlert(alert.id);
}

type DispatchResult = "sent" | "retry_scheduled" | "dead" | "idle";

async function dispatchAgencyAlert(alertId?: string): Promise<DispatchResult> {
  const now = new Date();
  const candidate = await withSystemScope(() => prisma.agencyAlertDelivery.findFirst({
    where: alertId
      ? { id: alertId, OR: [{ status: "pending", availableAt: { lte: now } }, { status: "sending", leaseExpiresAt: { lt: now } }] }
      : { OR: [{ status: "pending", availableAt: { lte: now } }, { status: "sending", leaseExpiresAt: { lt: now } }] },
    orderBy: { createdAt: "asc" },
  }));
  if (!candidate) return "idle";

  const leaseId = randomUUID();
  const claimed = await withSystemScope(() => prisma.agencyAlertDelivery.updateMany({
    where: {
      id: candidate.id,
      OR: [
        { status: "pending", availableAt: { lte: now } },
        { status: "sending", leaseExpiresAt: { lt: now } },
      ],
    },
    data: {
      status: "sending",
      attempts: { increment: 1 },
      leaseId,
      leaseExpiresAt: new Date(now.getTime() + DELIVERY_LEASE_MS),
    },
  }));
  if (claimed.count === 0) return "idle";

  const workspace = await withSystemScope(() => prisma.workspace.findUnique({
    where: { id: candidate.workspaceId },
    select: { telegramChatId: true },
  }));
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = workspace?.telegramChatId?.trim() || process.env.TELEGRAM_CHAT_ID?.trim();
  if (!botToken || !chatId) {
    logger.warn("[ALERTS] Delivery queued; Telegram bot token or workspace chat ID is not configured", {
      alertId: candidate.id,
      workspaceId: candidate.workspaceId,
    });
    return deferAgencyAlert(candidate.id, leaseId, candidate.attempts + 1, "Telegram delivery is not configured");
  }

  const clientName = candidate.clientId ? `[Client ID: ${candidate.clientId}]` : "[Unassigned]";
  const message = [
    "🚨 *Monstera Sync Failure*",
    "",
    `*Source:* ${candidate.pipelineName}`,
    `*Client:* ${clientName}`,
    `*Workspace:* \`${candidate.workspaceId}\``,
    `*Error:* ${candidate.errorMsg.slice(0, 280)}`,
    "",
    `_${candidate.actionHint || "Open Data Explorer → Recent runs and copy IDs for support."}_`,
  ].join("\n");

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return deferAgencyAlert(candidate.id, leaseId, candidate.attempts + 1, `Telegram returned HTTP ${response.status}`);

    const updated = await withSystemScope(() => prisma.agencyAlertDelivery.updateMany({
      where: { id: candidate.id, status: "sending", leaseId },
      data: { status: "sent", deliveredAt: new Date(), leaseId: null, leaseExpiresAt: null, lastError: null },
    }));
    return updated.count === 1 ? "sent" : "idle";
  } catch (error) {
    logger.warn("[ALERTS] Telegram delivery attempt failed", { alertId: candidate.id, error: error instanceof Error ? error.name : "unknown" });
    return deferAgencyAlert(candidate.id, leaseId, candidate.attempts + 1, "Telegram request failed or timed out");
  }
}

async function deferAgencyAlert(id: string, leaseId: string, attempts: number, reason: string): Promise<DispatchResult> {
  const dead = attempts >= MAX_ATTEMPTS;
  const delay = Math.min(30_000 * 2 ** Math.max(0, attempts - 1), MAX_RETRY_MS);
  await withSystemScope(() => prisma.agencyAlertDelivery.updateMany({
    where: { id, status: "sending", leaseId },
    data: {
      status: dead ? "dead" : "pending",
      availableAt: new Date(Date.now() + delay),
      leaseId: null,
      leaseExpiresAt: null,
      lastError: reason,
    },
  }));
  return dead ? "dead" : "retry_scheduled";
}

/** Called by the frequent health cron; expired delivery leases are reclaimed. */
export async function deliverPendingAgencyAlerts(limit = 25) {
  const results: Record<DispatchResult, number> = { sent: 0, retry_scheduled: 0, dead: 0, idle: 0 };
  for (let index = 0; index < limit; index++) {
    const outcome = await dispatchAgencyAlert();
    results[outcome]++;
    if (outcome === "idle") break;
  }
  const [pending, dead] = await withSystemScope(() => Promise.all([
    prisma.agencyAlertDelivery.count({ where: { status: { in: ["pending", "sending"] } } }),
    prisma.agencyAlertDelivery.count({ where: { status: "dead" } }),
  ]));
  await withSystemScope(() => prisma.agencyAlertDelivery.deleteMany({
    where: { status: "sent", deliveredAt: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
  }));
  return { ...results, pending, dead };
}
