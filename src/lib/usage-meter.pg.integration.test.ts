import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { assertAllowedTestDatabase } from "./pg-test-discipline";
import { recordUsage } from "./usage-meter";

describe("PostgreSQL integration: workspace daily usage", () => {
  const suffix = randomUUID().replaceAll("-", "");
  const userId = `usage-user-${suffix}`;
  const workspaceId = `usage-ws-${suffix}`;
  const now = new Date("2026-09-20T23:45:00.000Z");

  before(async () => {
    assertAllowedTestDatabase(process.env.DATABASE_URL);
    await prisma.user.create({ data: { id: userId, email: `${userId}@example.test` } });
    await prisma.workspace.create({
      data: { id: workspaceId, slug: workspaceId, name: "Usage Meter", ownerId: userId, plan: "free" },
    });
  });

  after(async () => {
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("increments two same-day records into one row", async () => {
    await recordUsage(workspaceId, "query", { now });
    await recordUsage(workspaceId, "query", { now: new Date(now.getTime() + 10_000) });

    const rows = await prisma.workspaceDailyUsage.findMany({ where: { workspaceId } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].date.toISOString(), "2026-09-20T00:00:00.000Z");
    assert.equal(rows[0].queryCount, 2);
    assert.equal(rows[0].importCount, 0);
    assert.equal(rows[0].keyHitCount, 0);
  });
});
