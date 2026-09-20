import crypto from "node:crypto";
import { prismaBase } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { hashTelemetryValue, resolveTelemetrySalt } from "@/lib/login-telemetry";

export type SecurityControlEventType =
  | "auth_failure"
  | "api_key_pin_rejection"
  | "cron_execution"
  | "retention_cleanup";

function sanitizedMetadata(value: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> | undefined {
  if (!value) return undefined;
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) continue;
    if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      const normalized = typeof item === "string" ? item.slice(0, 200) : item;
      result[key] = normalized;
    }
  }
  return result;
}

/** Best-effort, sanitized security evidence. It must never reject user traffic. */
export async function recordSecurityControlEvent(input: {
  eventType: SecurityControlEventType;
  outcome: "success" | "failure" | "rejected";
  scope: string;
  workspaceId?: string | null;
  actorHash?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!process.env.DATABASE_URL && process.env.NODE_ENV !== "production") return;
  try {
    await prismaBase.securityControlEvent.create({
      data: {
        eventType: input.eventType,
        outcome: input.outcome,
        scope: input.scope.slice(0, 100),
        workspaceId: input.workspaceId?.slice(0, 100) || null,
        actorHash: input.actorHash?.slice(0, 100) || null,
        metadata: sanitizedMetadata(input.metadata),
      },
    });
  } catch (error) {
    logger.warn("[security-control-event] failed open", {
      eventType: input.eventType,
      scope: input.scope,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function securityActorHash(identity: string): string {
  return hashTelemetryValue(identity.trim().toLowerCase(), resolveTelemetrySalt());
}

export function securityEventFingerprint(parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join(":"), "utf8").digest("hex");
}
