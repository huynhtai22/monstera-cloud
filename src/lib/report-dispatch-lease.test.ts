import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import prisma from "@/lib/prisma";
import {
  DISPATCH_LEASE_TTL_MS,
  claimScheduleDispatch,
  completeScheduleDispatch,
  releaseScheduleDispatch,
} from "./report-dispatch";

// Unit coverage of the durable dispatch-lease contract: the atomic predicates,
// the injected clock/token/TTL seams, and ownership-checked completion/release.
describe("report dispatch lease helpers", () => {
  let originalUpdateMany: any;
  let captured: any[] = [];
  let nextCount = 1;

  beforeEach(() => {
    captured = [];
    nextCount = 1;
    originalUpdateMany = prisma.reportSchedule.updateMany;
    (prisma.reportSchedule as any).updateMany = async (args: any) => {
      captured.push(args);
      return { count: nextCount };
    };
  });

  afterEach(() => {
    prisma.reportSchedule.updateMany = originalUpdateMany;
  });

  it("claims with the full atomic predicate and injectable clock/token/TTL", async () => {
    nextCount = 1;
    const token = await claimScheduleDispatch(
      { id: "sched-1", workspaceId: "ws-1", lastSentAt: null },
      { now: new Date("2026-09-12T09:00:00.000Z"), tokenGenerator: () => "token-abc", ttlMs: 1000 },
    );
    assert.equal(token, "token-abc");
    assert.equal(captured.length, 1);
    const args = captured[0];
    assert.deepEqual(args.where, {
      id: "sched-1",
      workspaceId: "ws-1",
      enabled: true,
      lastSentAt: null,
      OR: [{ dispatchLeaseToken: null }, { dispatchLeaseExpiresAt: { lte: new Date("2026-09-12T09:00:00.000Z") } }],
    });
    assert.deepEqual(args.data, {
      dispatchLeaseToken: "token-abc",
      dispatchLeaseExpiresAt: new Date("2026-09-12T09:00:01.000Z"),
    });
  });

  it("defaults the TTL to five minutes and refuses zero-row claims", async () => {
    nextCount = 0;
    const token = await claimScheduleDispatch({ id: "sched-2", workspaceId: "ws-2", lastSentAt: null });
    assert.equal(token, null);
    const before = captured[0].data.dispatchLeaseExpiresAt.getTime();
    const after = Date.now();
    assert.ok(before - after >= DISPATCH_LEASE_TTL_MS - 1000, "default TTL is ~5 minutes");
  });

  it("completes only under the exact ownership token and clears the lease with lastSentAt", async () => {
    nextCount = 1;
    const owned = await completeScheduleDispatch("sched-3", "ws-3", "token-owner", {
      now: new Date("2026-09-12T09:30:00.000Z"),
    });
    assert.equal(owned, true);
    assert.deepEqual(captured[0].where, { id: "sched-3", workspaceId: "ws-3", dispatchLeaseToken: "token-owner" });
    assert.deepEqual(captured[0].data, {
      lastSentAt: new Date("2026-09-12T09:30:00.000Z"),
      dispatchLeaseToken: null,
      dispatchLeaseExpiresAt: null,
    });

    nextCount = 0;
    assert.equal(await completeScheduleDispatch("sched-3", "ws-3", "token-stale"), false);
  });

  it("releases only the owned lease and never touches lastSentAt", async () => {
    nextCount = 1;
    assert.equal(await releaseScheduleDispatch("sched-4", "ws-4", "token-x"), true);
    assert.deepEqual(captured[0].where, { id: "sched-4", workspaceId: "ws-4", dispatchLeaseToken: "token-x" });
    assert.deepEqual(captured[0].data, { dispatchLeaseToken: null, dispatchLeaseExpiresAt: null });
    assert.equal("lastSentAt" in captured[0].data, false);

    nextCount = 0;
    assert.equal(await releaseScheduleDispatch("sched-4", "ws-4", "token-x"), false);
  });
});
