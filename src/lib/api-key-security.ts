import crypto from "crypto";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  extractIp,
  hashTelemetryValue,
  resolveTelemetrySalt,
  type RequestLike,
} from "@/lib/login-telemetry";

const KEY_PREFIX = "mc_live_";

export function hashApiKey(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

export function generateApiKey(): {
  secret: string;
  keyHash: string;
  keyPrefix: string;
  keyLastFour: string;
} {
  const secret = `${KEY_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  return {
    secret,
    keyHash: hashApiKey(secret),
    keyPrefix: KEY_PREFIX,
    keyLastFour: secret.slice(-4),
  };
}

export async function resolveApiKey(secret: string) {
  const keyHash = hashApiKey(secret);
  const current = await prisma.apiKey.findFirst({
    where: { keyHash, revokedAt: null },
    include: { workspace: true },
  });
  return current;
}

/**
 * P2: optional office-IP pin. When `allowedIpHash` is set, the request must
 * come from the pinned network or the key is rejected. Fail-CLOSED by
 * design (a pin that can't be verified denies) — but pins are strictly
 * opt-in because Looker scheduled refreshes fan out across Google IPs.
 */
export function isApiKeyIpAllowed(
  key: { allowedIpHash: string | null },
  request: RequestLike | null | undefined,
): boolean {
  if (!key.allowedIpHash) return true;
  const ip = extractIp(request);
  if (!ip) return false;
  const candidate = hashTelemetryValue(ip, resolveTelemetrySalt());
  const pinned = Buffer.from(key.allowedIpHash, "utf8");
  const probe = Buffer.from(candidate, "utf8");
  return pinned.length === probe.length && crypto.timingSafeEqual(pinned, probe);
}

/** Salted hash of the caller's current IP, for setting a pin. Null when unknown. */
export function pinHashForRequest(request: RequestLike | null | undefined): string | null {
  const ip = extractIp(request);
  return ip ? hashTelemetryValue(ip, resolveTelemetrySalt()) : null;
}

const pinRejectionThrottle = new Map<string, number>();

/**
 * Workspace-scoped audit trail for rejected pinned-key use (someone holding
 * the secret is on the wrong network — leaked or shared key signal).
 * Throttled to one row per key per hour per instance; never throws.
 */
export async function auditApiKeyPinRejection(opts: {
  workspaceId: string;
  keyId: string;
}): Promise<void> {
  if ((pinRejectionThrottle.get(opts.keyId) ?? 0) + 60 * 60 * 1000 > Date.now()) return;
  pinRejectionThrottle.set(opts.keyId, Date.now());
  try {
    await prisma.auditEvent.create({
      data: {
        workspaceId: opts.workspaceId,
        action: "api_key.pin_rejected",
        resource: "api_key",
        resourceId: opts.keyId,
      },
    });
  } catch (error) {
    logger.warn("[API_KEYS] pin rejection audit failed (fail-open):", error);
  }
}

export function publicApiKeyRow(key: {
  id: string;
  name: string;
  keyPrefix: string | null;
  keyLastFour: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  useCount?: number;
  allowedIpHash?: string | null;
}) {
  return {
    id: key.id,
    name: key.name,
    keyMasked: key.keyPrefix && key.keyLastFour
      ? `${key.keyPrefix}••••••••${key.keyLastFour}`
      : "legacy key — rotate required",
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
    useCount: key.useCount ?? 0,
    ipPinned: key.allowedIpHash != null,
  };
}
