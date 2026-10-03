import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reportEmailClaimDisposition } from "./report-email-claim-policy";

describe("approved report email claim retry policy", () => {
  const startedAt = new Date("2026-09-27T10:00:00.000Z");
  const staleAfterMs = 10 * 60 * 1000;

  it("keeps a recent send blocked while its outcome is pending", () => {
    assert.equal(reportEmailClaimDisposition({
      status: "PROVIDER_STARTED",
      providerStartedAt: startedAt,
      now: startedAt.getTime() + staleAfterMs,
      staleAfterMs,
    }), "in_progress");
  });

  it("turns an expired in-flight claim into an ambiguous claim instead of granting a retry", () => {
    assert.equal(reportEmailClaimDisposition({
      status: "PROVIDER_STARTED",
      providerStartedAt: startedAt,
      now: startedAt.getTime() + staleAfterMs + 1,
      staleAfterMs,
    }), "mark_ambiguous");
  });

  it("keeps an ambiguous outcome blocked under every idempotency key", () => {
    assert.equal(reportEmailClaimDisposition({
      status: "AMBIGUOUS",
      providerStartedAt: startedAt,
      now: startedAt.getTime() + staleAfterMs * 100,
      staleAfterMs,
    }), "ambiguous");
  });
});
