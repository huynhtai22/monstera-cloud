import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultHighlights, reminderCampaigns, type ReminderCampaign } from "./console-feature-campaigns";
import { REMINDER_COOLDOWN_MS, reminderHistory, reminderSetupReady, selectReminder } from "./console-reminder-frequency";
const now = new Date("2026-10-03T00:00:00Z");
const announcement: ReminderCampaign = { id: "new-reports", kind: "announcement", highlights: defaultHighlights.slice(3), roles: ["owner"], plans: ["professional"], startsAt: "2026-10-01", endsAt: "2027-01-01" };
const base = { campaigns: reminderCampaigns, history: [], sessionHash: "session-a", now, role: "owner", plan: "professional", setupReady: true };

test("introduction once per identity, regardless of copy changes or session", () => {
  assert.equal(selectReminder(base)?.id, "console-introduction");
  assert.equal(selectReminder({ ...base, history: [{ campaignId: "console-introduction", sessionHash: "old-session", shownAt: "2026-01-01" }], campaigns: [{ ...reminderCampaigns[0], highlights: [] }] }), null);
});
test("all campaigns share the 14-day cap; exact boundary permits a new campaign", () => {
  const history = [{ campaignId: "old", sessionHash: "old-session", shownAt: new Date(now.getTime() - REMINDER_COOLDOWN_MS + 1).toISOString() }];
  assert.equal(selectReminder({ ...base, campaigns: [announcement], history }), null);
  history[0].shownAt = new Date(now.getTime() - REMINDER_COOLDOWN_MS).toISOString();
  assert.equal(selectReminder({ ...base, campaigns: [announcement], history })?.id, announcement.id);
});
test("one automatic popup per authenticated session, even after cooldown", () => {
  assert.equal(selectReminder({ ...base, campaigns: [announcement], history: [{ campaignId: "old", sessionHash: "session-a", shownAt: "2026-01-01" }] }), null);
});
test("announcements need explicit availability dates and matching roles/plans", () => {
  assert.equal(selectReminder({ ...base, campaigns: [announcement], role: "viewer" }), null);
  assert.equal(selectReminder({ ...base, campaigns: [announcement], plan: "free" }), null);
  assert.equal(selectReminder({ ...base, campaigns: [{ ...announcement, startsAt: undefined }] }), null);
  assert.equal(selectReminder({ ...base, campaigns: [{ ...announcement, endsAt: "2026-10-02" }] }), null);
});
test("onboarding gates: active/paused/unreviewed work blocks; reviewed completion allows", () => {
  for (const status of ["in_progress", "waiting_user", "paused", "ready_to_review"]) assert.equal(reminderSetupReady(true, "owner", { status, reviewedAt: now }, true), false);
  assert.equal(reminderSetupReady(true, "owner", { status: "completed", reviewedAt: null }, true), false);
  assert.equal(reminderSetupReady(true, "owner", { status: "completed", reviewedAt: now }, false), true);
  assert.equal(reminderSetupReady(false, "owner", null, false), false);
  assert.equal(selectReminder({ ...base, setupReady: false }), null);
});
test("legacy activated customers and invited viewers can receive introduction", () => {
  assert.equal(reminderSetupReady(false, "owner", null, true), true);
  assert.equal(reminderSetupReady(false, "viewer", null, false), true);
});
test("malformed persisted state fails closed instead of resetting seen history", () => {
  assert.deepEqual(reminderHistory(null), []);
  assert.throws(() => reminderHistory({}));
  assert.throws(() => reminderHistory([{ campaignId: "old", sessionHash: "a", shownAt: "invalid" }]));
});
