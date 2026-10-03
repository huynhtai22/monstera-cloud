import assert from "node:assert/strict";
import { before, after, it, describe } from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertAllowedTestDatabase } from "../pg-test-discipline";
import { recordFreshnessObservation, monitorReportFreshness } from "./report-freshness-monitor";

describe("durable client freshness observations", () => {
  const suffix = `${Date.now()}-${process.pid}`;
  const a = `fresh-a-${suffix}`, b = `fresh-b-${suffix}`, user = `fresh-user-${suffix}`, client = `fresh-client-${suffix}`;
  const db = new PrismaClient();
  const now = new Date("2026-09-21T12:00:00Z");
  const observe = (status: string, seconds: number) => recordFreshnessObservation({ workspaceId: a, clientId: client,
    observedAt: new Date(now.getTime() + seconds * 1000), status, incidentKey: status });
  before(async () => {
    assertAllowedTestDatabase(process.env.DATABASE_URL);
    await db.user.create({ data: { id: user, email: `${user}@example.test` } });
    for (const id of [a, b]) await db.workspace.create({ data: { id, name: id, slug: id, ownerId: user } });
    await db.client.create({ data: { id: client, workspaceId: a, name: "Freshness fixture" } });
  });
  after(async () => {
    await db.auditEvent.deleteMany({ where: { workspaceId: { in: [a, b] } } });
    await db.workspace.deleteMany({ where: { id: { in: [a, b] } } });
    await db.user.deleteMany({ where: { id: user } });
    await db.$disconnect();
  });
  it("deduplicates incidents, advances observation time, ignores older results, and journals recovery", async () => {
    assert.equal(await observe("NOT_READY", 0), true);
    assert.equal(await observe("NOT_READY", 10), false);
    assert.equal(await observe("READY", 5), false, "older recovery cannot supersede newer attention");
    assert.equal(await observe("READY", 20), true);
    assert.equal(await observe("READY", 30), false);
    const events = await db.auditEvent.findMany({ where: { workspaceId: a, action: "report_freshness.changed" }, orderBy: { createdAt: "asc" } });
    assert.equal(events.length, 2);
    assert.equal((events[1].metadata as { previousStatus: string }).previousStatus, "NOT_READY");
    const state = await db.clientFreshnessState.findUniqueOrThrow({ where: { workspaceId_clientId: { workspaceId: a, clientId: client } } });
    assert.equal(state.checkedAt.toISOString(), "2026-09-21T12:00:30.000Z");
  });
  it("concurrent identical observations create one transition", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => observe("UNAVAILABLE", 40)));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await db.auditEvent.count({ where: { workspaceId: a, action: "report_freshness.changed" } }), 3);
  });
  it("does not record evidence for a rival client and the composite FK rejects it", async () => {
    assert.equal(await recordFreshnessObservation({ workspaceId: b, clientId: client, observedAt: now, status: "READY", incidentKey: "forged" }), false);
    await assert.rejects(db.clientFreshnessState.create({ data: { workspaceId: b, clientId: client, status: "READY", incidentKey: "forged", checkedAt: now, changedAt: now } }));
  });
  it("runs bounded canonical evaluations and writes no provider/destination activation", async () => {
    const previous = process.env.REPORT_FRESHNESS_MONITOR_ENABLED;
    try {
      process.env.REPORT_FRESHNESS_MONITOR_ENABLED = "0";
      assert.deepEqual(await monitorReportFreshness(now), { enabled: false });
      process.env.REPORT_FRESHNESS_MONITOR_ENABLED = "1";
      const result = await monitorReportFreshness(new Date("2026-09-21T12:15:00Z"));
      assert.equal(result.enabled, true);
      assert.ok(typeof result.checked === "number" && result.checked <= 3);
      assert.equal(await db.destinationDeliveryReceipt.count({ where: { workspaceId: a } }), 0);
    } finally {
      if (previous === undefined) delete process.env.REPORT_FRESHNESS_MONITOR_ENABLED;
      else process.env.REPORT_FRESHNESS_MONITOR_ENABLED = previous;
    }
  });
});
