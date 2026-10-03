import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { claimConsoleReminder } from "./console-reminder-server";
const enabled = Boolean(process.env.DATABASE_URL);
const db = new PrismaClient();
const suffix = `${Date.now()}-${process.pid}`;
const user = `reminder-user-${suffix}`, other = `reminder-other-${suffix}`, workspace = `reminder-ws-${suffix}`, secondWorkspace = `reminder-ws-two-${suffix}`, otherWorkspace = `reminder-other-ws-${suffix}`;
before(async () => {
  if (!enabled) return;
  await db.user.createMany({ data: [{ id: user, workProfileAnsweredAt: new Date() }, { id: other, workProfileAnsweredAt: new Date() }] });
  await db.workspace.create({ data: { id: workspace, name: "Reminder fixture", slug: workspace, ownerId: user, members: { create: { userId: user, role: "owner" } } } });
});
after(async () => {
  if (enabled) { await db.workspace.deleteMany({ where: { id: { in: [workspace, secondWorkspace, otherWorkspace] } } }); await db.user.deleteMany({ where: { id: { in: [user, other] } } }); }
  await db.$disconnect();
});
test("unauthorized identity cannot read or consume workspace reminder", { skip: !enabled }, async () => {
  assert.equal(await claimConsoleReminder(db, other, "other-session", workspace), null);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: other } })).consoleReminderHistory, null);
});
test("simultaneous tabs reserve exactly one introduction; new device cannot replay it", { skip: !enabled }, async () => {
  const results = await Promise.all(Array.from({ length: 4 }, (_, i) => claimConsoleReminder(db, user, `session-${i}`, workspace)));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await claimConsoleReminder(db, user, "another-device", workspace, new Date("2027-01-01")), null);
  await db.workspace.create({ data: { id: secondWorkspace, name: "Second workspace", slug: secondWorkspace, ownerId: user, members: { create: { userId: user, role: "owner" } } } });
  assert.equal(await claimConsoleReminder(db, user, "workspace-switch", secondWorkspace, new Date("2027-02-01")), null);
  const history = (await db.user.findUniqueOrThrow({ where: { id: user } })).consoleReminderHistory as Array<{ sessionHash: string }>;
  assert.equal(history.length, 1);
  assert.match(history[0].sessionHash, /^[a-f0-9]{64}$/);
});

test("unfinished setup blocks; reviewed completion unlocks the other user's own introduction", { skip: !enabled }, async () => {
  await db.workspace.create({ data: { id: otherWorkspace, name: "Other identity", slug: otherWorkspace, ownerId: other, members: { create: { userId: other, role: "owner" } } } });
  const run = await db.agentRun.create({ data: { workspaceId: otherWorkspace, initiatorUserId: other, kind: "onboarding", status: "ready_to_review" } });
  assert.equal(await claimConsoleReminder(db, other, "other-session", otherWorkspace), null);
  await db.agentRun.update({ where: { id: run.id }, data: { status: "completed", reviewedAt: new Date() } });
  assert.equal((await claimConsoleReminder(db, other, "other-session", otherWorkspace))?.id, "console-introduction");
});
