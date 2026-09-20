import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import prisma, { prismaBase } from "@/lib/prisma";
import { assertAllowedTestDatabase } from "./pg-test-discipline";
import {
  enforceExpiredSessionGrace,
  isSessionRevoked,
  registerSession,
  revokeOtherUserSessions,
  revokeUserSession,
  touchSession,
} from "./session-limits";
import {
  isApiKeyIpAllowed,
  auditApiKeyPinRejection,
  pinHashForRequest,
} from "./api-key-security";
import { recordLoginEvent, touchApiKeyUsage } from "./login-telemetry";
import { assertCanCreateApiKey, PLAN_LIMIT_CODES, PlanLimitError } from "./plan-entitlements";

/**
 * PostgreSQL integration: seat-sharing P0–P2 flows against real tables.
 * Never touches production: assertAllowedTestDatabase fails closed.
 *
 * Covers what pure unit tests cannot: revoke-oldest capping, revocation
 * visibility, usage counters, IP-pin checks, and the key-count gate.
 */

function authedRequest(ip: string, ua: string): Request {
  return new Request("https://app.example.test/api/ping", {
    headers: { "x-forwarded-for": ip, "user-agent": ua },
  });
}

describe("PostgreSQL integration: seat-sharing telemetry, sessions, keys", () => {
  const uid = randomUUID().replaceAll("-", "");
  const userId = `seat-user-${uid}`;
  const keyUserId = `seat-key-user-${uid}`;
  const wsFree = `seat-ws-free-${uid}`;
  const wsStarter = `seat-ws-starter-${uid}`;
  const email = `seat-user-${uid}@example.test`;

  const jtiA = `seat-jti-a-${uid}`;
  const jtiB = `seat-jti-b-${uid}`;
  const jtiC = `seat-jti-c-${uid}`;

  before(async () => {
    assertAllowedTestDatabase(process.env.DATABASE_URL);
    await prisma.user.createMany({
      data: [
        { id: userId, email, name: "Seat User" },
        { id: keyUserId, email: `seat-key-user-${uid}@example.test`, name: "Seat Key User" },
      ],
    });
    await prisma.workspace.createMany({
      data: [
        // free => 3 normal sessions + one 24h grace session; Starter keys tested on wsStarter.
        { id: wsFree, slug: wsFree, name: "Seat Free", ownerId: userId, plan: "free" },
        { id: wsStarter, slug: wsStarter, name: "Seat Starter", ownerId: keyUserId, plan: "starter" },
      ],
    });
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId: wsFree, userId, role: "owner" },
        { workspaceId: wsStarter, userId: keyUserId, role: "owner" },
      ],
    });
  });

  after(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: [wsFree, wsStarter] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, keyUserId] } } });
  });

  it("recordLoginEvent stores salted hashes, never raw identity", async () => {
    await recordLoginEvent({
      userId,
      method: "credentials",
      request: authedRequest("203.0.113.9", `SeatAgent/${uid}`),
    });
    const row = await prismaBase.loginEvent.findFirst({
      where: { userId, method: "credentials" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(row, "login event row must exist");
    assert.ok(row.ipHash && /^[0-9a-f]{64}$/.test(row.ipHash), "ipHash must be SHA-256 hex");
    assert.ok(!row.ipHash.includes("203.0.113"), "raw IP must never be stored");
    assert.ok(row.uaHash && !row.uaHash.includes("SeatAgent"), "raw UA must never be stored");
  });

  it("registerSession allows one temporary overflow, then revokes oldest at the hard ceiling", async () => {
    await registerSession({ userId, jti: jtiA });
    await registerSession({ userId, jti: jtiB });
    await registerSession({ userId, jti: jtiC });
    assert.equal(await isSessionRevoked(jtiA), false);
    assert.equal(await isSessionRevoked(jtiB), false);
    assert.equal(await isSessionRevoked(jtiC), false);

    const graceJti = `seat-jti-grace-${uid}`;
    const graceRegistration = await registerSession({ userId, jti: graceJti });
    assert.equal(graceRegistration.revokedCount, 0);
    assert.ok(graceRegistration.graceEndsAt, "fourth free browser receives 24h grace");

    const overflowJti = `seat-jti-overflow-${uid}`;
    const { revokedCount, graceEndsAt } = await registerSession({ userId, jti: overflowJti });
    assert.equal(revokedCount, 1);
    assert.equal(graceEndsAt?.getTime(), graceRegistration.graceEndsAt?.getTime(), "further login cannot extend grace");
    assert.equal(await isSessionRevoked(jtiA), true);
    assert.equal(await isSessionRevoked(jtiB), false);
    assert.equal(await isSessionRevoked(jtiC), false);
    assert.equal(await isSessionRevoked(graceJti), false);
    assert.equal(await isSessionRevoked(overflowJti), false);
    assert.equal(await isSessionRevoked(`unknown-jti-${uid}`), false);
  });

  it("heartbeat cleanup restores the normal allowance after grace expires", async () => {
    const currentJti = `seat-jti-overflow-${uid}`;
    await prismaBase.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { graceEndsAt: new Date("2020-01-01T00:00:00.000Z") },
    });
    assert.equal(await enforceExpiredSessionGrace(userId, currentJti), 1);
    assert.equal(
      await prismaBase.userSession.count({ where: { userId, revokedAt: null } }),
      3,
    );
    assert.equal(await isSessionRevoked(currentJti), false, "active heartbeat browser is preserved");
    const expired = await prismaBase.userSession.findFirst({
      where: { userId, revokedReason: "grace_expired" },
    });
    assert.ok(expired, "cleanup records a user-visible revocation reason");
  });

  it("concurrent registrations never throw and stay bounded", async () => {
    const jtis = [0, 1, 2].map((n) => `seat-race-${n}-${uid}`);
    await Promise.all(jtis.map((jti) => registerSession({ userId, jti })));
    const active = await prismaBase.userSession.count({ where: { userId, revokedAt: null } });
    // Hard ceiling is 4; a 3-way race may overshoot by at most the race width
    // minus the one guaranteed overlapping revoke.
    assert.ok(active <= 6, `active sessions bounded after race (got ${active})`);
  });

  it("revoke helpers sign out one or all-other sessions", async () => {
    const keep = `seat-keep-${uid}`;
    const drop = `seat-drop-${uid}`;
    const extra = `seat-extra-${uid}`;
    await prismaBase.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "test_reset" },
    });
    await registerSession({ userId, jti: keep });
    await registerSession({ userId, jti: drop });
    assert.equal(await revokeUserSession(userId, drop), 1);
    assert.equal(await isSessionRevoked(drop), true);
    // Re-fill to two actives so "others" is deterministically non-empty.
    await registerSession({ userId, jti: extra });
    assert.equal(await revokeOtherUserSessions(userId, keep), 1);
    assert.equal(await isSessionRevoked(extra), true);
    assert.equal(await isSessionRevoked(keep), false);
  });

  it("touchSession refreshes lastSeenAt", async () => {
    const jti = `seat-touch-${uid}`;
    await registerSession({ userId, jti });
    await prismaBase.userSession.update({
      where: { jti },
      data: { lastSeenAt: new Date("2020-01-01T00:00:00.000Z") },
    });
    await touchSession(jti, authedRequest("198.51.100.7", "TouchAgent/1.0"));
    const row = await prismaBase.userSession.findUniqueOrThrow({ where: { jti } });
    assert.ok(row.lastSeenAt.getTime() > new Date("2020-01-01T00:00:00.000Z").getTime());
    assert.ok(row.ipHash, "heartbeat enriches the IP hash");
  });

  it("touchApiKeyUsage counts hits and hashes identity", async () => {
    const created = await prisma.apiKey.create({
      data: {
        keyHash: `seat-hash-${uid}`,
        keyPrefix: "mc_live_",
        keyLastFour: "0000",
        name: "Seat Key",
        workspaceId: wsFree,
      },
    });
    await touchApiKeyUsage({ apiKeyId: created.id, request: authedRequest("192.0.2.77", "KeyAgent/2.0") });
    await touchApiKeyUsage({ apiKeyId: created.id, request: authedRequest("192.0.2.77", "KeyAgent/2.0") });
    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(row.useCount, 2);
    assert.ok(row.lastUsedAt);
    assert.ok(row.lastUsedIpHash && !row.lastUsedIpHash.includes("192.0.2"), "raw IP never stored");
  });

  it("IP pins allow the pinned network and reject others", async () => {
    const office = authedRequest("203.0.113.50", "OfficeAgent/1.0");
    const away = authedRequest("198.51.100.99", "CafeAgent/1.0");
    const pin = pinHashForRequest(office);
    assert.ok(pin, "pin hash must derive from office request");
    assert.equal(pinHashForRequest(null), null);
    assert.equal(isApiKeyIpAllowed({ allowedIpHash: null }, away), true);
    assert.equal(isApiKeyIpAllowed({ allowedIpHash: pin }, office), true);
    assert.equal(isApiKeyIpAllowed({ allowedIpHash: pin }, away), false);
    assert.equal(isApiKeyIpAllowed({ allowedIpHash: pin }, null), false);
  });

  it("pin rejections write one throttled workspace audit event", async () => {
    const beforeCount = await prisma.auditEvent.count({
      where: { workspaceId: wsFree, action: "api_key.pin_rejected" },
    });
    const keyId = `seat-pinkey-${uid}`;
    await auditApiKeyPinRejection({ workspaceId: wsFree, keyId });
    await auditApiKeyPinRejection({ workspaceId: wsFree, keyId });
    const afterCount = await prisma.auditEvent.count({
      where: { workspaceId: wsFree, action: "api_key.pin_rejected" },
    });
    assert.equal(afterCount - beforeCount, 1);
  });

  it("Starter key-count gate blocks the 4th key but allows rotation", async () => {
    const ids: string[] = [];
    for (let n = 0; n < 3; n++) {
      const row = await prisma.apiKey.create({
        data: {
          keyHash: `seat-cap-${n}-${uid}`,
          keyPrefix: "mc_live_",
          keyLastFour: "1111",
          name: `Cap Key ${n}`,
          workspaceId: wsStarter,
        },
      });
      ids.push(row.id);
    }
    await assert.rejects(assertCanCreateApiKey(wsStarter), (error: unknown) => {
      assert.ok(error instanceof PlanLimitError);
      assert.equal((error as PlanLimitError).code, PLAN_LIMIT_CODES.KEY_LIMIT);
      return true;
    });
    // Rotation excludes the key being replaced, so capped workspaces recover.
    await assertCanCreateApiKey(wsStarter, { excludingKeyId: ids[0] });
  });
});
