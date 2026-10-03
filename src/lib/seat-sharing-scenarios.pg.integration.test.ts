import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import prisma, { prismaBase } from "@/lib/prisma";
import { assertAllowedTestDatabase } from "./pg-test-discipline";
import { aggregateLoginSignals, recordLoginEvent, touchApiKeyUsage } from "./login-telemetry";
import { auditApiKeyPinRejection, pinHashForRequest } from "./api-key-security";
import { registerSession } from "./session-limits";
import { recordUsage } from "./usage-meter";

function requestFrom(ip: string, ua: string): Request {
  return new Request("https://preview.example.test/console", {
    headers: { "x-forwarded-for": ip, "user-agent": ua },
  });
}

describe("PostgreSQL low-N seat-sharing validation", () => {
  const suffix = randomUUID().replaceAll("-", "");
  const scenarios = ["normal", "sharer", "key-spreader", "staggered"] as const;
  const ids = Object.fromEntries(scenarios.map((name) => [name, {
    user: `scenario-user-${name}-${suffix}`,
    workspace: `scenario-ws-${name}-${suffix}`,
  }])) as Record<(typeof scenarios)[number], { user: string; workspace: string }>;

  before(async () => {
    assertAllowedTestDatabase(process.env.DATABASE_URL);
    for (const name of scenarios) {
      await prisma.user.create({ data: { id: ids[name].user, email: `${ids[name].user}@example.test` } });
      await prisma.workspace.create({
        data: {
          id: ids[name].workspace,
          slug: ids[name].workspace,
          name: `Scenario ${name}`,
          ownerId: ids[name].user,
          plan: "free",
        },
      });
      await prisma.workspaceMember.create({
        data: { workspaceId: ids[name].workspace, userId: ids[name].user, role: "owner" },
      });
    }
  });

  after(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: scenarios.map((name) => ids[name].workspace) } } });
    await prisma.user.deleteMany({ where: { id: { in: scenarios.map((name) => ids[name].user) } } });
  });

  it("normal: one device remains active and produces ordinary usage evidence", async () => {
    const scenario = ids.normal;
    const request = requestFrom("192.0.2.10", "Normal/1.0");
    await recordLoginEvent({ userId: scenario.user, method: "credentials", request });
    await registerSession({ userId: scenario.user, jti: `normal-${suffix}`, request });
    await recordUsage(scenario.workspace, "query", { now: new Date("2026-09-20T12:00:00Z") });

    const [events, active, usage] = await Promise.all([
      prismaBase.loginEvent.findMany({ where: { userId: scenario.user } }),
      prismaBase.userSession.count({ where: { userId: scenario.user, revokedAt: null } }),
      prisma.workspaceDailyUsage.findFirst({ where: { workspaceId: scenario.workspace } }),
    ]);
    const signal = aggregateLoginSignals(events)[0];
    assert.equal(signal.distinctIps, 1);
    assert.equal(active, 1);
    assert.equal(usage?.queryCount, 1);
  });

  it("sharer: repeated network events are visible and only the fifth browser triggers cleanup", async () => {
    const scenario = ids.sharer;
    for (let index = 0; index < 5; index += 1) {
      const request = requestFrom(`198.51.100.${index + 10}`, `Sharer/${index}`);
      await recordLoginEvent({ userId: scenario.user, method: "credentials", request });
      await registerSession({ userId: scenario.user, jti: `sharer-${index}-${suffix}`, request });
    }

    const [events, active, revoked] = await Promise.all([
      prismaBase.loginEvent.findMany({ where: { userId: scenario.user } }),
      prismaBase.userSession.count({ where: { userId: scenario.user, revokedAt: null } }),
      prismaBase.userSession.count({ where: { userId: scenario.user, revokedAt: { not: null } } }),
    ]);
    const signal = aggregateLoginSignals(events)[0];
    assert.equal(signal.distinctIps, 5);
    assert.equal(active, 4);
    assert.equal(revoked, 1);
  });

  it("key-spreader: allowed use is counted and off-network use creates a durable rejection event", async () => {
    const scenario = ids["key-spreader"];
    const office = requestFrom("203.0.113.40", "KeySpreader/office");
    const key = await prisma.apiKey.create({
      data: {
        workspaceId: scenario.workspace,
        keyHash: `scenario-key-${suffix}`,
        name: "Pinned scenario key",
        allowedIpHash: pinHashForRequest(office),
      },
    });
    await touchApiKeyUsage({ apiKeyId: key.id, request: office });
    await recordUsage(scenario.workspace, "keyHit", { now: new Date("2026-09-20T12:00:00Z") });
    await auditApiKeyPinRejection({ workspaceId: scenario.workspace, keyId: key.id });

    const [storedKey, rejection, usage] = await Promise.all([
      prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } }),
      prisma.auditEvent.findFirst({
        where: { workspaceId: scenario.workspace, action: "api_key.pin_rejected", resourceId: key.id },
      }),
      prisma.workspaceDailyUsage.findFirst({ where: { workspaceId: scenario.workspace } }),
    ]);
    assert.equal(storedKey.useCount, 1);
    assert.ok(rejection, "off-network pin rejection must be durable");
    assert.equal(usage?.keyHitCount, 1);
  });

  it("staggered pair: two legitimate devices stay active without a false sharing alert", async () => {
    const scenario = ids.staggered;
    for (let index = 0; index < 2; index += 1) {
      const request = requestFrom(`192.0.2.${80 + index}`, `Staggered/${index}`);
      await recordLoginEvent({ userId: scenario.user, method: "credentials", request });
      await registerSession({ userId: scenario.user, jti: `staggered-${index}-${suffix}`, request });
    }

    const [events, active, revoked] = await Promise.all([
      prismaBase.loginEvent.findMany({ where: { userId: scenario.user } }),
      prismaBase.userSession.count({ where: { userId: scenario.user, revokedAt: null } }),
      prismaBase.userSession.count({ where: { userId: scenario.user, revokedAt: { not: null } } }),
    ]);
    const signal = aggregateLoginSignals(events)[0];
    assert.equal(signal.distinctIps, 2);
    assert.equal(active, 2);
    assert.equal(revoked, 0);
  });
});
