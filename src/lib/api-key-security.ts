import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  extractIp,
  hashTelemetryValue,
  resolveTelemetrySalt,
  type RequestLike,
} from "@/lib/login-telemetry";
import { recordSecurityControlEvent } from "@/lib/security-control-events";

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

async function resolveApiKey(secret: string) {
  const keyHash = hashApiKey(secret);
  const current = await prisma.apiKey.findFirst({
    where: { keyHash, revokedAt: null },
    include: { workspace: true },
  });
  return current;
}

export type ApiKeyRequestResolution =
  | { ok: true; key: NonNullable<Awaited<ReturnType<typeof resolveApiKey>>> }
  | { ok: false; reason: "invalid" | "ip_pinned" };

/**
 * Canonical API-key authentication path. Every bearer-key route must use this
 * helper so optional IP pins cannot be bypassed through secondary endpoints.
 */
export async function resolveApiKeyForRequest(
  secret: string,
  request: RequestLike | null | undefined,
): Promise<ApiKeyRequestResolution> {
  const key = await resolveApiKey(secret);
  if (!key) return { ok: false, reason: "invalid" };
  if (!isApiKeyIpAllowed(key, request)) {
    await auditApiKeyPinRejection({ workspaceId: key.workspaceId, keyId: key.id });
    return { ok: false, reason: "ip_pinned" };
  }
  return { ok: true, key };
}

/** Serialize cap decisions and key lifecycle writes for one workspace. */
export async function withApiKeyMutationLock<T>(
  workspaceId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`monstera:api-key:${workspaceId}`}))`;
    return operation(tx as Prisma.TransactionClient);
  });
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
  return pinHashCandidates(ip).some((candidate) => constantTimeHashEqual(key.allowedIpHash!, candidate));
}

/** Salted hash of the caller's current IP, for setting a pin. Null when unknown. */
export function pinHashForRequest(request: RequestLike | null | undefined): string | null {
  const ip = extractIp(request);
  if (!ip) return null;
  const current = currentPinSalt();
  return `${current.version}:${hashTelemetryValue(ip, current.salt)}`;
}

type VersionedSalt = { version: string; salt: string };

function normalizedSaltVersion(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  return /^v[1-9][0-9]*$/.test(candidate) ? candidate : fallback;
}

function currentPinSalt(env: NodeJS.ProcessEnv = process.env): VersionedSalt {
  return {
    version: normalizedSaltVersion(env.API_KEY_PIN_SALT_VERSION, "v1"),
    salt: env.API_KEY_PIN_SALT?.trim() || resolveTelemetrySalt(env),
  };
}

function previousPinSalt(env: NodeJS.ProcessEnv = process.env): VersionedSalt | null {
  const salt = env.API_KEY_PIN_SALT_PREVIOUS?.trim();
  if (!salt) return null;
  return {
    version: normalizedSaltVersion(env.API_KEY_PIN_SALT_PREVIOUS_VERSION, "v0"),
    salt,
  };
}

function pinHashCandidates(ip: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const current = currentPinSalt(env);
  const previous = previousPinSalt(env);
  const versioned = [current, ...(previous ? [previous] : [])]
    .map((entry) => `${entry.version}:${hashTelemetryValue(ip, entry.salt)}`);

  // Pre-versioning pins were hashed with LOGIN_IP_SALT/NEXTAUTH_SECRET.
  // Keep them valid through the rollout; admins can unpin/re-pin to migrate.
  const legacy = [
    hashTelemetryValue(ip, resolveTelemetrySalt(env)),
    ...(env.LOGIN_IP_SALT_PREVIOUS?.trim()
      ? [hashTelemetryValue(ip, env.LOGIN_IP_SALT_PREVIOUS.trim())]
      : []),
  ];
  return [...new Set([...versioned, ...legacy])];
}

function constantTimeHashEqual(actual: string, candidate: string): boolean {
  const left = Buffer.from(actual, "utf8");
  const right = Buffer.from(candidate, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
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
    await recordSecurityControlEvent({
      eventType: "api_key_pin_rejection",
      outcome: "rejected",
      scope: "api_key",
      workspaceId: opts.workspaceId,
      metadata: { keyIdHash: hashApiKey(opts.keyId) },
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
