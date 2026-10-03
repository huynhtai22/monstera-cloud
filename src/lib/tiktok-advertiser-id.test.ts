import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeTikTokAdvertiserIds,
  TIKTOK_ADVERTISER_RECONNECT_MESSAGE,
} from "./tiktok-advertiser-id";

describe("TikTok advertiser ID validation", () => {
  it("keeps only unique numeric advertiser IDs", () => {
    assert.deepEqual(
      normalizeTikTokAdvertiserIds([" 712345678901234 ", 712345678901235, "712345678901234"]),
      ["712345678901234", "712345678901235"],
    );
  });

  it("rejects legacy labels and opaque values before a TikTok request", () => {
    assert.deepEqual(normalizeTikTokAdvertiserIds(["#un1v", "advertiser-a", "", null, {}]), []);
    assert.match(TIKTOK_ADVERTISER_RECONNECT_MESSAGE, /reconnect required/i);
  });
});
