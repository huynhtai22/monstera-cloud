import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ticketFingerprint } from "./support-ticket";

describe("support ticket fingerprint", () => {
  it("dedupes by reason, connection, and tag", () => {
    assert.equal(
      ticketFingerprint({ reason: "auth", connectionId: "c1", tag: "[auth]" }),
      "auth:c1:[auth]",
    );
    assert.notEqual(
      ticketFingerprint({ reason: "stale", connectionId: null, tag: "[stale]" }),
      ticketFingerprint({ reason: "auth", connectionId: null, tag: "[auth]" }),
    );
  });
});
