import crypto from "crypto";
import { prismaBase } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getPlanLimits } from "@/lib/plan-config";
import { createNodeRedis } from "@/lib/node-redis";
import {
  extractUserAgent,
  telemetryHashesFromRequest,
  type RequestLike,
} from "@/lib/login-telemetry";

/**
 * P1 seat-sharing hardening: revocable browser sessions + concurrent cap.
 *
 * Design constraints (do not regress):
 * - Fail-open: any telemetry/session-infra failure must never block login
 *   or turn a valid user into a 401. Unknown `jti` (pre-P1 JWTs, DB outage)
 *   is treated as ACTIVE.
 * - Bounded writes: revocation checks are cached (memory + Redis when
 *   configured, 60s TTL); `lastSeenAt` touches are throttled to 1 per
 *   10 minutes per session.
 * - Revocation propagation worst case is ~60s across instances.
 */

const REVOCATION_CACHE_TTL_MS = 60_000;
const HEARTBEAT_THROTTLE_MS = 10 * 60 * 1000;
const REVOKED_PRUNE_DAYS = 90;
const REVOCATION_CACHE_MAX = 5_000;
export const SESSION_GRACE_DURATION_MS = 24 * 60 * 60 * 1000;
export const SESSION_GRACE_SLOTS = 1;

type RevocationCacheEntry = { revoked: boolean; expiresAt: number };

const revocationCache = new Map<string, RevocationCacheEntry>();
const touchThrottle = new Map<string, number>();
const newDeviceThrottle = new Map<string, number>();

function cacheGet(jti: string): boolean | null {
  const entry = revocationCache.get(jti);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    revocationCache.delete(jti);
    return null;
  }
  return entry.revoked;
}

function cacheSet(jti: string, revoked: boolean): void {
  if (revocationCache.size >= REVOCATION_CACHE_MAX) {
    const oldest = revocationCache.keys().next();
    if (!oldest.done) revocationCache.delete(oldest.value);
  }
  revocationCache.set(jti, { revoked, expiresAt: Date.now() + REVOCATION_CACHE_TTL_MS });
}

function redisKey(jti: string): string {
  return `monstera:sessrev:${jti}`;
}

export function maxConcurrentSessionsForPlan(plan: string): number {
  return getPlanLimits(plan).maxConcurrentSessions;
}

export type SessionSlot = {
  id: string;
  lastSeenAt: Date;
  graceEndsAt?: Date | null;
};

export type SessionAllowance = {
  plan: string;
  activeLimit: number;
  graceSlots: typeof SESSION_GRACE_SLOTS;
  graceDurationHours: 24;
};

export type SessionRegistrationPolicy = {
  revokeIds: string[];
  graceEndsAt: Date | null;
};

/**
 * Pure: which existing session ids to revoke to make room for one new login.
 * `totalLimit` is the cap INCLUDING the incoming session.
 */
export function selectSessionsToRevoke(existing: SessionSlot[], totalLimit: number): string[] {
  const overflow = existing.length + 1 - totalLimit;
  if (overflow <= 0) return [];
  return [...existing]
    .sort((a, b) => a.lastSeenAt.getTime() - b.lastSeenAt.getTime())
    .slice(0, overflow)
    .map((session) => session.id);
}

/**
 * Decide how to make room for a login without treating ordinary multi-device
 * use as abuse. The first browser above the normal allowance receives a
 * 24-hour grace window. Further logins keep the account at `limit + 1` and
 * inherit the same deadline instead of silently extending it.
 */
export function sessionRegistrationPolicy(
  existing: SessionSlot[],
  totalLimit: number,
  now = new Date(),
): SessionRegistrationPolicy {
  if (existing.length < totalLimit) return { revokeIds: [], graceEndsAt: null };

  const liveGraceTimes = existing
    .map((session) => session.graceEndsAt?.getTime() ?? 0)
    .filter((time) => time > now.getTime());
  const graceEndsAt = liveGraceTimes.length > 0
    ? new Date(Math.min(...liveGraceTimes))
    : new Date(now.getTime() + SESSION_GRACE_DURATION_MS);
  const hardLimit = totalLimit + SESSION_GRACE_SLOTS;

  return {
    revokeIds: selectSessionsToRevoke(existing, hardLimit),
    graceEndsAt,
  };
}

/**
 * Once no live grace window remains, return the oldest sessions that should
 * be retired to restore the normal allowance. Prefer keeping the browser
 * currently sending the heartbeat so a background device is removed first.
 */
export function selectExpiredGraceSessionsToRevoke(
  existing: Array<SessionSlot & { jti: string }>,
  totalLimit: number,
  now = new Date(),
  currentJti?: string | null,
): string[] {
  if (existing.length <= totalLimit) return [];
  if (existing.some((session) => (session.graceEndsAt?.getTime() ?? 0) > now.getTime())) return [];
  const overflow = existing.length - totalLimit;
  return [...existing]
    .sort((a, b) => {
      if (a.jti === currentJti && b.jti !== currentJti) return 1;
      if (b.jti === currentJti && a.jti !== currentJti) return -1;
      return a.lastSeenAt.getTime() - b.lastSeenAt.getTime();
    })
    .slice(0, overflow)
    .map((session) => session.id);
}

/** Store only a coarse browser/platform label, never the raw user agent. */
export function deviceLabelFromRequest(request?: RequestLike | null): string | null {
  const ua = extractUserAgent(request ?? null);
  if (!ua) return null;

  const platform = /iPad/i.test(ua)
    ? "iPad"
    : /iPhone/i.test(ua)
      ? "iPhone"
      : /Android/i.test(ua)
        ? "Android"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/i.test(ua)
            ? "Mac"
            : /Linux/i.test(ua)
              ? "Linux"
              : "device";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /Firefox\//i.test(ua)
      ? "Firefox"
      : /CriOS\//i.test(ua)
        ? "Chrome"
        : /Chrome\//i.test(ua)
          ? "Chrome"
          : /Safari\//i.test(ua) && !/Chrome|Chromium|CriOS/i.test(ua)
            ? "Safari"
            : "Browser";
  return `${browser} on ${platform}`;
}

export async function getUserSessionAllowance(userId: string): Promise<SessionAllowance | null> {
  try {
    const row = await prismaBase.user.findUnique({
      where: { id: userId },
      select: { workspaces: { select: { workspace: { select: { plan: true } } } } },
    });
    const plans = row?.workspaces.map((membership) => membership.workspace.plan) ?? [];
    const plan = plans.reduce((best, candidate) => (
      maxConcurrentSessionsForPlan(candidate) > maxConcurrentSessionsForPlan(best)
        ? candidate
        : best
    ), "free");
    return {
      plan,
      activeLimit: maxConcurrentSessionsForPlan(plan),
      graceSlots: SESSION_GRACE_SLOTS,
      graceDurationHours: 24,
    };
  } catch (error) {
    logger.warn("[SESSION] plan lookup failed (fail-open, skipping cap):", error);
    return null;
  }
}

export function newSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Register a fresh browser login. When the user is over their plan's
 * concurrent-session cap, the least-recently-seen sessions are revoked
 * (revoke-oldest policy — less support load than block-newest).
 * Never throws.
 */
export async function registerSession(opts: {
  userId: string;
  jti: string;
  request?: RequestLike | null;
}): Promise<{ revokedCount: number; graceEndsAt: Date | null }> {
  if (!opts.userId || !opts.jti) return { revokedCount: 0, graceEndsAt: null };
  try {
    const allowance = await getUserSessionAllowance(opts.userId);
    const { ipHash, uaHash } = telemetryHashesFromRequest(opts.request ?? null);
    const deviceLabel = deviceLabelFromRequest(opts.request);

    let revokedCount = 0;
    let graceEndsAt: Date | null = null;
    if (allowance) {
      const active = await prismaBase.userSession.findMany({
        where: { userId: opts.userId, revokedAt: null },
        select: { id: true, jti: true, lastSeenAt: true, graceEndsAt: true },
        orderBy: { lastSeenAt: "asc" },
      });
      const policy = sessionRegistrationPolicy(active, allowance.activeLimit);
      const toRevoke = policy.revokeIds;
      graceEndsAt = policy.graceEndsAt;
      if (toRevoke.length > 0) {
        await prismaBase.userSession.updateMany({
          where: { id: { in: toRevoke } },
          data: { revokedAt: new Date(), revokedReason: "allowance_exceeded" },
        });
        revokedCount = toRevoke.length;
        const redis = createNodeRedis();
        for (const row of active) {
          if (toRevoke.includes(row.id)) {
            cacheSet(row.jti, true);
            if (redis) {
              try {
                await redis.set(redisKey(row.jti), "1", { ex: 60 });
              } catch {
                /* fail-open */
              }
            }
          }
        }
        logger.info(`[SESSION] revoked ${revokedCount} oldest session(s) for user ${opts.userId} (allowance ${allowance.activeLimit} + ${allowance.graceSlots} grace)`);
      }
    }

    await prismaBase.userSession.create({
      data: { userId: opts.userId, jti: opts.jti, ipHash, uaHash, deviceLabel, graceEndsAt },
    });
    cacheSet(opts.jti, false);

    // Bounded hygiene: prune long-revoked rows for this user only.
    try {
      await prismaBase.userSession.deleteMany({
        where: {
          userId: opts.userId,
          revokedAt: { lt: new Date(Date.now() - REVOKED_PRUNE_DAYS * 24 * 60 * 60 * 1000) },
        },
      });
    } catch {
      /* best-effort */
    }

    return { revokedCount, graceEndsAt };
  } catch (error) {
    logger.warn("[SESSION] registerSession failed (fail-open):", error);
    return { revokedCount: 0, graceEndsAt: null };
  }
}

/**
 * True when the session row exists and is revoked. Unknown/missing rows
 * (pre-P1 JWTs, DB outage) are ACTIVE — fail-open by design.
 */
export async function isSessionRevoked(jti: string | null | undefined): Promise<boolean> {
  if (!jti) return false;
  const cached = cacheGet(jti);
  if (cached !== null) return cached;

  const redis = createNodeRedis();
  if (redis) {
    try {
      const hit = await redis.get<string | null>(redisKey(jti));
      if (hit === "1") {
        cacheSet(jti, true);
        return true;
      }
    } catch {
      /* fall through to DB */
    }
  }

  try {
    const row = await prismaBase.userSession.findUnique({
      where: { jti },
      select: { revokedAt: true },
    });
    // Unknown jti (legacy JWT or write failed) => active.
    const revoked = row ? row.revokedAt != null : false;
    cacheSet(jti, revoked);
    return revoked;
  } catch (error) {
    logger.warn("[SESSION] revocation check failed (fail-open as active):", error);
    return false;
  }
}

async function cacheRevokedSessions(rows: Array<{ jti: string }>): Promise<void> {
  const redis = createNodeRedis();
  for (const row of rows) {
    cacheSet(row.jti, true);
    if (redis) {
      try {
        await redis.set(redisKey(row.jti), "1", { ex: 60 });
      } catch {
        /* fail-open */
      }
    }
  }
}

/**
 * Best-effort cleanup after the temporary overflow window. This is called by
 * heartbeats, so an account naturally returns to its normal allowance while
 * active without requiring a cron or blocking valid authentication.
 */
export async function enforceExpiredSessionGrace(
  userId: string,
  currentJti?: string | null,
): Promise<number> {
  if (!userId) return 0;
  try {
    const allowance = await getUserSessionAllowance(userId);
    if (!allowance) return 0;
    const active = await prismaBase.userSession.findMany({
      where: { userId, revokedAt: null },
      select: { id: true, jti: true, lastSeenAt: true, graceEndsAt: true },
      orderBy: { lastSeenAt: "asc" },
    });
    const revokeIds = selectExpiredGraceSessionsToRevoke(
      active,
      allowance.activeLimit,
      new Date(),
      currentJti,
    );
    if (revokeIds.length === 0) return 0;
    const revokedRows = active.filter((row) => revokeIds.includes(row.id));
    const result = await prismaBase.userSession.updateMany({
      where: { userId, id: { in: revokeIds }, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "grace_expired" },
    });
    await cacheRevokedSessions(revokedRows);
    logger.info(`[SESSION] expired grace cleanup revoked ${result.count} session(s) for user ${userId}`);
    return result.count;
  } catch (error) {
    logger.warn("[SESSION] grace cleanup failed (fail-open):", error);
    return 0;
  }
}

/**
 * Refresh `lastSeenAt` (and opportunistically IP/UA hashes) at most once
 * per 10 minutes per session. Never throws.
 */
export async function touchSession(jti: string | null | undefined, request?: RequestLike | null): Promise<void> {
  if (!jti) return;
  const now = Date.now();
  if ((touchThrottle.get(jti) ?? 0) + HEARTBEAT_THROTTLE_MS > now) return;
  touchThrottle.set(jti, now);
  try {
    const row = await prismaBase.userSession.findUnique({
      where: { jti },
      select: { userId: true },
    });
    const data: {
      lastSeenAt: Date;
      ipHash?: string | null;
      uaHash?: string | null;
      deviceLabel?: string | null;
    } = {
      lastSeenAt: new Date(),
    };
    if (request) {
      const { ipHash, uaHash } = telemetryHashesFromRequest(request);
      if (ipHash) data.ipHash = ipHash;
      if (uaHash) data.uaHash = uaHash;
      const deviceLabel = deviceLabelFromRequest(request);
      if (deviceLabel) data.deviceLabel = deviceLabel;
    }
    await prismaBase.userSession.updateMany({
      where: { jti, revokedAt: null },
      data,
    });
    if (row?.userId) await enforceExpiredSessionGrace(row.userId, jti);
  } catch (error) {
    logger.warn("[SESSION] touchSession failed (fail-open):", error);
  }
}

/** Revoke one of the caller's own sessions. Returns rows revoked. */
export async function revokeUserSession(
  userId: string,
  jti: string,
  reason = "user_revoked",
): Promise<number> {
  try {
    const result = await prismaBase.userSession.updateMany({
      where: { userId, jti, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    if (result.count > 0) {
      cacheSet(jti, true);
      const redis = createNodeRedis();
      if (redis) {
        try {
          await redis.set(redisKey(jti), "1", { ex: 60 });
        } catch {
          /* fail-open */
        }
      }
    }
    return result.count;
  } catch (error) {
    logger.warn("[SESSION] revokeUserSession failed:", error);
    return 0;
  }
}

/** Revoke all of the caller's sessions except `exceptJti`. Returns rows revoked. */
export async function revokeOtherUserSessions(userId: string, exceptJti: string): Promise<number> {
  try {
    const rows = await prismaBase.userSession.findMany({
      where: { userId, revokedAt: null, NOT: { jti: exceptJti } },
      select: { jti: true },
    });
    if (rows.length === 0) return 0;
    const result = await prismaBase.userSession.updateMany({
      where: { userId, revokedAt: null, NOT: { jti: exceptJti } },
      data: { revokedAt: new Date(), revokedReason: "user_revoked_others" },
    });
    const redis = createNodeRedis();
    for (const row of rows) {
      cacheSet(row.jti, true);
      if (redis) {
        try {
          await redis.set(redisKey(row.jti), "1", { ex: 60 });
        } catch {
          /* fail-open */
        }
      }
    }
    return result.count;
  } catch (error) {
    logger.warn("[SESSION] revokeOtherUserSessions failed:", error);
    return 0;
  }
}

export type ListedUserSession = {
  jti: string;
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  graceEndsAt: Date | null;
  deviceLabel: string | null;
  seenIp: boolean;
  current: boolean;
};

export async function listUserSessions(userId: string, currentJti?: string | null): Promise<ListedUserSession[]> {
  try {
    const rows = await prismaBase.userSession.findMany({
      where: { userId },
      select: {
        jti: true,
        createdAt: true,
        lastSeenAt: true,
        revokedAt: true,
        revokedReason: true,
        graceEndsAt: true,
        deviceLabel: true,
        ipHash: true,
      },
      orderBy: { lastSeenAt: "desc" },
      take: 50,
    });
    return rows.map((row) => ({
      jti: row.jti,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      revokedAt: row.revokedAt,
      revokedReason: row.revokedReason,
      graceEndsAt: row.graceEndsAt,
      deviceLabel: row.deviceLabel,
      seenIp: row.ipHash != null,
      current: currentJti != null && row.jti === currentJti,
    }));
  } catch (error) {
    logger.warn("[SESSION] listUserSessions failed:", error);
    return [];
  }
}

/**
 * P3 helper: notify the account email when a login arrives from a previously
 * unseen IP hash. No-op when the user has no history yet (first login) or
 * the IP was seen in the window. Best-effort, throttled to 1 email per
 * (user, ip) per 24h per instance. Never throws.
 */
export async function maybeNotifyNewDevice(opts: {
  userId: string;
  email?: string | null;
  ipHash: string | null;
  method: string;
  notify: (email: string, method: string) => Promise<unknown>;
}): Promise<void> {
  if (!opts.ipHash || !opts.email) return;
  try {
    const recent = await prismaBase.loginEvent.findMany({
      where: { userId: opts.userId },
      select: { ipHash: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    // Exclude the event just written for this login (newest row).
    const prior = recent.slice(1).map((row) => row.ipHash).filter(Boolean) as string[];
    if (prior.length === 0) return;
    if (prior.includes(opts.ipHash)) return;
    const throttleKey = `${opts.userId}:${opts.ipHash}`;
    if ((newDeviceThrottle.get(throttleKey) ?? 0) + 24 * 60 * 60 * 1000 > Date.now()) return;
    newDeviceThrottle.set(throttleKey, Date.now());
    await opts.notify(opts.email, opts.method);
    logger.info(`[SESSION] new-device nudge sent: userId=${opts.userId} method=${opts.method}`);
  } catch (error) {
    logger.warn("[SESSION] maybeNotifyNewDevice failed (fail-open):", error);
  }
}
