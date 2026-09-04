import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRecipients } from "./report-dispatch";

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
});
