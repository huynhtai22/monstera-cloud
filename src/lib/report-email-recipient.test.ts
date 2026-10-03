import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalizeReportEmailRecipient, hashReportEmailRecipientWithKey } from "./report-email-recipient";

const testKey = Buffer.alloc(32, 1).toString("hex");

describe("approved report email recipient identity", () => {
  it("canonicalizes harmless casing and surrounding whitespace", () => {
    assert.equal(canonicalizeReportEmailRecipient(" Alice@Example.com "), "alice@example.com");
    assert.equal(
      hashReportEmailRecipientWithKey(" Alice@Example.com ", testKey),
      hashReportEmailRecipientWithKey("alice@example.com", testKey),
    );
  });

  it("distinguishes different addresses that have the same display mask", () => {
    const displayMask = (email: string) => {
      const [local, domain] = email.split("@");
      return `${local![0]}***@${domain![0]}***.com`;
    };
    assert.equal(displayMask("alice@example.com"), displayMask("adam@example.com"));
    assert.notEqual(
      hashReportEmailRecipientWithKey("alice@example.com", testKey),
      hashReportEmailRecipientWithKey("adam@example.com", testKey),
    );
  });

  it("stores a keyed digest rather than the address", () => {
    const digest = hashReportEmailRecipientWithKey("alice@example.com", testKey);
    assert.match(digest, /^[\da-f]{64}$/);
    assert.equal(digest.includes("alice"), false);
    assert.equal(digest.includes("@"), false);
  });

  it("fails closed if the hashing key is missing or malformed", () => {
    assert.throws(() => hashReportEmailRecipientWithKey("alice@example.com", undefined), /ENCRYPTION_KEY must be set/);
    assert.throws(() => hashReportEmailRecipientWithKey("alice@example.com", "not-a-key"), /ENCRYPTION_KEY must be set/);
  });
});
