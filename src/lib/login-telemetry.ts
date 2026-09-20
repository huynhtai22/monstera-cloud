import crypto from "crypto";
import { prismaBase } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * P0 seat-sharing telemetry — read-only observability, zero enforcement.
 *
 * Privacy: raw IPs / user-agents are never persisted. Only SHA-256 hashes
 * with a server-side salt are stored (`ipHash`, `uaHash`).
 */

export type LoginMethod = "credentials" | "google" | "google-sheets";

type HeadersLike = {
  get: (name: string) => string | null;
};

export type RequestLike = {
  headers: HeadersLike | Record<string, string | string[] | undefined>;
};

function readHeader(headers: RequestLike["headers"], name: string): string | null {
  if (headers && typeof (headers as HeadersLike).get === "function") {
    return (headers as HeadersLike).get(name);
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const value = record?.[name] ?? record?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function resolveTelemetrySalt(env: NodeJS.ProcessEnv = process.env): string {
  const salt = env.LOGIN_IP_SALT?.trim() || env.NEXTAUTH_SECRET?.trim();
  // Local/dev fallback keeps telemetry working without extra setup.
  // Production should set LOGIN_IP_SALT (see .env.example).
  return salt || "local-dev-telemetry-salt";
}

export function extractIp(request: RequestLike | null | undefined): string | null {
  if (!request?.headers) return null;
  const forwarded = readHeader(request.headers, "x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  const realIp =
    readHeader(request.headers, "x-real-ip") ?? readHeader(request.headers, "cf-connecting-ip");
  const cleaned = realIp?.trim();
  return cleaned || null;
}

export function extractUserAgent(request: RequestLike | null | undefined): string | null {
  if (!request?.headers) return null;
  const ua = readHeader(request.headers, "user-agent");
  const cleaned = ua?.trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 500);
}

export function hashTelemetryValue(value: string, salt: string): string {
  return crypto.createHash("sha256").update(`${salt}:${value}`, "utf8").digest("hex");
}

export function telemetryHashesFromRequest(
  request: RequestLike | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { ipHash: string | null; uaHash: string | null } {
  const salt = resolveTelemetrySalt(env);
  const ip = extractIp(request);
  const ua = extractUserAgent(request);
  return {
    ipHash: ip ? hashTelemetryValue(ip, salt) : null,
    uaHash: ua ? hashTelemetryValue(ua, salt) : null,
  };
}

/**
 * Persist a login event. Never throws — telemetry must not break auth.
 */
export async function recordLoginEvent(opts: {
  userId: string;
  method: LoginMethod;
  request?: RequestLike | null;
  ipHash?: string | null;
  uaHash?: string | null;
}): Promise<string | null> {
  if (!opts.userId) return null;
  try {
    let { ipHash = null, uaHash = null } = opts;
    if ((ipHash == null || uaHash == null) && opts.request) {
      const derived = telemetryHashesFromRequest(opts.request);
      ipHash = ipHash ?? derived.ipHash;
      uaHash = uaHash ?? derived.uaHash;
    }
    const created = await prismaBase.loginEvent.create({
      data: {
        userId: opts.userId,
        method: opts.method,
        ipHash,
        uaHash,
      },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    logger.warn("[TELEMETRY] recordLoginEvent failed (fail-open):", error);
    return null;
  }
}

/**
 * Touch API-key usage counters. Never throws — telemetry must not break data routes.
 * Falls back to `lastUsedAt`-only when the P0 columns are not migrated yet.
 */
export async function touchApiKeyUsage(opts: {
  apiKeyId: string;
  request?: RequestLike | null;
}): Promise<void> {
  if (!opts.apiKeyId) return;
  const { ipHash, uaHash } = telemetryHashesFromRequest(opts.request ?? null);
  const now = new Date();
  try {
    await prismaBase.apiKey.update({
      where: { id: opts.apiKeyId },
      data: {
        lastUsedAt: now,
        useCount: { increment: 1 },
        lastUsedIpHash: ipHash,
        lastUsedUaHash: uaHash,
      },
    });
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    // P2022 = column missing (code deployed before migration). Keep serving traffic.
    if (code === "P2022") {
      try {
        await prismaBase.apiKey.update({
          where: { id: opts.apiKeyId },
          data: { lastUsedAt: now },
        });
      } catch (fallbackError) {
        logger.warn("[TELEMETRY] touchApiKeyUsage fallback failed (fail-open):", fallbackError);
      }
      return;
    }
    logger.warn("[TELEMETRY] touchApiKeyUsage failed (fail-open):", error);
  }
}

export type LoginEventSignal = {
  userId: string;
  ipHash: string | null;
  uaHash: string | null;
};

/**
 * Pure aggregation for operator-only measurement and synthetic validation.
 * Do not expose these user-global signals through a tenant-admin endpoint;
 * LoginEvent intentionally has no workspace attribution.
 */
export function aggregateLoginSignals(events: LoginEventSignal[]): Array<{
  userId: string;
  loginCount: number;
  distinctIps: number;
  distinctUas: number;
}> {
  const byUser = new Map<string, { ips: Set<string>; uas: Set<string>; count: number }>();
  for (const event of events) {
    if (!event.userId) continue;
    let entry = byUser.get(event.userId);
    if (!entry) {
      entry = { ips: new Set(), uas: new Set(), count: 0 };
      byUser.set(event.userId, entry);
    }
    entry.count += 1;
    if (event.ipHash) entry.ips.add(event.ipHash);
    if (event.uaHash) entry.uas.add(event.uaHash);
  }
  return [...byUser.entries()].map(([userId, entry]) => ({
    userId,
    loginCount: entry.count,
    distinctIps: entry.ips.size,
    distinctUas: entry.uas.size,
  }));
}
