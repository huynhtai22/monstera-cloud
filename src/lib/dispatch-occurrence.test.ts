import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DISPATCH_LEASE_TTL_MS,
  DISPATCH_OVERALL_DEADLINE_MS,
  DISPATCH_PER_REQUEST_TIMEOUT_MS,
  dispatchIdempotencyKey,
  dispatchOccurrenceDate,
} from "./report-dispatch";
import { isScheduleDue } from "./report-dispatch";

// The occurrence identity is the durable anchor for ambiguous-delivery
// suppression: every sweep evaluating the same due slot must derive the same
// key, the next slot must derive a different one, and the derivation must be
// pure (no request/claim/random/insertion time).
describe("dispatch occurrence identity", () => {
  it("keeps the production budget strictly inside the lease TTL", () => {
    assert.ok(DISPATCH_PER_REQUEST_TIMEOUT_MS < DISPATCH_OVERALL_DEADLINE_MS);
    assert.ok(DISPATCH_OVERALL_DEADLINE_MS < DISPATCH_LEASE_TTL_MS);
    assert.equal(DISPATCH_LEASE_TTL_MS - DISPATCH_OVERALL_DEADLINE_MS, 210_000);
  });

  it("derives the same key for every sweep time within one UTC day", () => {
    const morning = dispatchOccurrenceDate(new Date("2026-09-12T00:30:00.000Z"));
    const noon = dispatchOccurrenceDate(new Date("2026-09-12T12:00:00.000Z"));
    const lateEvening = dispatchOccurrenceDate(new Date("2026-09-12T23:59:59.999Z"));
    assert.equal(morning, "2026-09-12");
    assert.equal(noon, morning);
    assert.equal(lateEvening, morning);
  });

  it("derives a different key for the next day's slot", () => {
    const day1 = dispatchOccurrenceDate(new Date("2026-09-12T09:00:00.000Z"));
    const day2 = dispatchOccurrenceDate(new Date("2026-09-13T09:00:00.000Z"));
    assert.notEqual(day1, day2);
  });

  it("keeps daily schedules due-and-keyed consistently with isScheduleDue", () => {
    // A daily 09:00 schedule is due from 09:00 UTC onward; both sweep times on
    // the same date share the occurrence key.
    const cron = "0 9 * * *";
    const sweepAt10 = new Date("2026-09-12T10:00:00.000Z");
    const sweepAt23 = new Date("2026-09-12T23:00:00.000Z");
    assert.equal(isScheduleDue(cron, null, sweepAt10), true);
    assert.equal(isScheduleDue(cron, null, sweepAt23), true);
    assert.equal(dispatchOccurrenceDate(sweepAt10), dispatchOccurrenceDate(sweepAt23));
    // The next day's slot is a different occurrence.
    const nextDay = new Date("2026-09-13T10:00:00.000Z");
    assert.equal(isScheduleDue(cron, null, nextDay), true);
    assert.notEqual(dispatchOccurrenceDate(sweepAt10), dispatchOccurrenceDate(nextDay));
  });

  it("keys weekly schedules by their due calendar day", () => {
    const cron = "0 9 * * 1"; // Mondays 09:00 UTC
    const monday = new Date("2026-09-14T10:00:00.000Z"); // Monday
    const tuesday = new Date("2026-09-15T10:00:00.000Z"); // Tuesday
    assert.equal(isScheduleDue(cron, null, monday), true);
    assert.equal(isScheduleDue(cron, null, tuesday), false, "a weekly schedule is not due on other days");
    assert.equal(dispatchOccurrenceDate(monday), "2026-09-14");
    // The next legitimate occurrence is the following Monday.
    const nextMonday = new Date("2026-09-21T10:00:00.000Z");
    assert.notEqual(dispatchOccurrenceDate(monday), dispatchOccurrenceDate(nextMonday));
  });

  it("is deterministic across DST-style clock shifts because the model is UTC-based", () => {
    // The shipped scheduling model is UTC-based and ReportSchedule carries no
    // timezone, so there is no DST boundary to traverse: identical UTC instants
    // map to identical keys regardless of local-clock shifts.
    const a = dispatchOccurrenceDate(new Date("2026-09-12T01:00:00.000Z"));
    const b = dispatchOccurrenceDate(new Date("2026-09-12T01:00:00.000Z"));
    assert.equal(a, b);
    assert.equal(a.length, 10);
  });

  it("derives deterministic opaque idempotency keys per occurrence and destination", () => {
    const key1 = dispatchIdempotencyKey("ws-1", "sched-1", "2026-09-12", "email", "a@example.test");
    const key2 = dispatchIdempotencyKey("ws-1", "sched-1", "2026-09-12", "email", "a@example.test");
    const nextOccurrence = dispatchIdempotencyKey("ws-1", "sched-1", "2026-09-13", "email", "a@example.test");
    const otherDestination = dispatchIdempotencyKey("ws-1", "sched-1", "2026-09-12", "email", "b@example.test");
    assert.equal(key1, key2, "identical across retries of the same occurrence");
    assert.notEqual(key1, nextOccurrence, "changes for the next occurrence");
    assert.notEqual(key1, otherDestination, "distinct per destination");
    assert.match(key1, /^[0-9a-f]{64}$/, "opaque hex hash; no email address or customer identifier");
  });
});
