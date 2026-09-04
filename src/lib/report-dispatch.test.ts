import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRecipients, isScheduleDue } from "./report-dispatch";

describe("report-dispatch helpers", () => {
  describe("parseRecipients", () => {
    it("correctly separates emails, Slack webhooks, and Telegram chat IDs", () => {
      const input = `
        lead@agency.com,
        https://hooks.slack.com/services/T00/B00/XXXX,
        -100198273645,
        tg:987654321,
        manager@client.vn;
        https://discord.com/api/webhooks/123/abc
      `;

      const parsed = parseRecipients(input);

      assert.deepEqual(parsed.emails, ["lead@agency.com", "manager@client.vn"]);
      assert.deepEqual(parsed.slackWebhooks, [
        "https://hooks.slack.com/services/T00/B00/XXXX",
        "https://discord.com/api/webhooks/123/abc",
      ]);
      assert.deepEqual(parsed.telegramChatIds, ["-100198273645", "987654321"]);
    });

    it("handles empty or malformed strings gracefully without throwing", () => {
      assert.deepEqual(parseRecipients(""), { emails: [], slackWebhooks: [], telegramChatIds: [] });
      assert.deepEqual(parseRecipients("   \n  "), { emails: [], slackWebhooks: [], telegramChatIds: [] });
      assert.deepEqual(parseRecipients(null as any), { emails: [], slackWebhooks: [], telegramChatIds: [] });
    });

    it("deduplicates redundant recipient entries", () => {
      const input = "user@test.com, user@test.com, -100111, tg:-100111";
      const parsed = parseRecipients(input);
      assert.equal(parsed.emails.length, 1);
      assert.equal(parsed.telegramChatIds.length, 1);
    });
  });

  describe("isScheduleDue", () => {
    it("identifies weekly Monday schedule as due on Monday after target hour", () => {
      // 2026-09-07 is Monday
      const mondayAt10 = new Date("2026-09-07T10:00:00.000Z");
      const mondayAt8 = new Date("2026-09-07T08:00:00.000Z");
      const tuesdayAt10 = new Date("2026-09-08T10:00:00.000Z");

      assert.equal(isScheduleDue("0 9 * * 1", null, mondayAt10), true);
      assert.equal(isScheduleDue("0 9 * * 1", null, mondayAt8), false);
      assert.equal(isScheduleDue("0 9 * * 1", null, tuesdayAt10), false);
    });

    it("prevents repeat sends within 5 days for weekly schedule", () => {
      const mondayAt10 = new Date("2026-09-07T10:00:00.000Z");
      const mondayAt11 = new Date("2026-09-07T11:00:00.000Z");
      const previousMonday = new Date("2026-08-31T09:00:00.000Z");

      // Already sent 1 hour ago on the same Monday
      assert.equal(isScheduleDue("0 9 * * 1", mondayAt10, mondayAt11), false);
      // Sent 7 days ago on the previous Monday
      assert.equal(isScheduleDue("0 9 * * 1", previousMonday, mondayAt10), true);
    });

    it("identifies daily schedule and enforces 20-hour window between dispatches", () => {
      const todayAt9 = new Date("2026-09-07T09:00:00.000Z");
      const todayAt10 = new Date("2026-09-07T10:00:00.000Z");
      const yesterdayAt8 = new Date("2026-09-06T08:00:00.000Z");

      // First send
      assert.equal(isScheduleDue("0 8 * * *", null, todayAt9), true);
      // Attempt 1 hour later
      assert.equal(isScheduleDue("0 8 * * *", todayAt9, todayAt10), false);
      // Sent yesterday morning (25 hours ago)
      assert.equal(isScheduleDue("0 8 * * *", yesterdayAt8, todayAt9), true);
    });
  });
});
