import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPendingNavigationStore } from "./pending-navigation-store";

const A = "/explorer";
const B = "/reports";
const OBSERVED_A = "?clientId=cl_a&platform=google_ads";
const STAGED_A = "?clientId=cl_a&platform=google_ads&startDate=2026-09-04";

describe("pending navigation store", () => {
  it("stages a pending query readable synchronously by a global consumer", () => {
    const store = createPendingNavigationStore();
    store.stage(A, OBSERVED_A, STAGED_A);
    assert.equal(store.pendingFor(A), STAGED_A);
    assert.equal(store.getBase(A, OBSERVED_A), STAGED_A);
  });

  it("falls back to observed state with no pending entry", () => {
    const store = createPendingNavigationStore();
    assert.equal(store.pendingFor(A), null);
    assert.equal(store.getBase(A, OBSERVED_A), OBSERVED_A);
  });

  it("notifies subscribers on change but not on no-op writes", () => {
    const store = createPendingNavigationStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.stage(A, OBSERVED_A, STAGED_A);
    assert.equal(calls, 1);
    store.stage(A, OBSERVED_A, STAGED_A);
    assert.equal(calls, 1);
    store.acknowledge(A, STAGED_A);
    assert.equal(calls, 2);
    store.acknowledge(A, STAGED_A);
    assert.equal(calls, 2);
    unsubscribe();
    store.stage(A, OBSERVED_A, STAGED_A);
    assert.equal(calls, 2);
  });

  it("acknowledges an exact serialized match", () => {
    const store = createPendingNavigationStore();
    store.stage(A, OBSERVED_A, STAGED_A);
    store.acknowledge(A, STAGED_A);
    assert.equal(store.pendingFor(A), null);
    assert.equal(store.getBase(A, STAGED_A), STAGED_A);
  });

  it("acknowledges reordered-equivalent observed queries", () => {
    const store = createPendingNavigationStore();
    store.stage(A, OBSERVED_A, STAGED_A);
    store.acknowledge(A, "?startDate=2026-09-04&clientId=cl_a&platform=google_ads");
    assert.equal(store.pendingFor(A), null);
  });

  it("keeps pending while the old observed URL is still reported", () => {
    const store = createPendingNavigationStore();
    store.stage(A, OBSERVED_A, STAGED_A);
    store.acknowledge(A, OBSERVED_A);
    assert.equal(store.pendingFor(A), STAGED_A);
  });

  it("external navigation clears stale pending and records the new URL", () => {
    const store = createPendingNavigationStore();
    store.stage(A, OBSERVED_A, STAGED_A);
    store.acknowledge(A, "?clientId=cl_a&platform=meta_ads");
    assert.equal(store.pendingFor(A), null);
    assert.equal(store.getBase(A, "?clientId=cl_a&platform=meta_ads"), "?clientId=cl_a&platform=meta_ads");
  });

  it("isolates state by pathname", () => {
    const store = createPendingNavigationStore();
    store.stage(A, OBSERVED_A, STAGED_A);
    assert.equal(store.pendingFor(B), null);
    assert.equal(store.getBase(B, "?view=sync"), "?view=sync");
    store.acknowledge(B, "?view=sync&status=error");
    assert.equal(store.pendingFor(A), STAGED_A);
  });

  it("route transition cleans the previous surface", () => {
    const store = createPendingNavigationStore();
    store.stage(A, OBSERVED_A, STAGED_A);
    store.stage(B, "?view=sync", "?view=sync&status=error");
    store.pruneExcept(B);
    assert.equal(store.pendingFor(A), null);
    assert.equal(store.pendingFor(B), "?view=sync&status=error");
    const sizeBefore = store.snapshot().size;
    store.pruneExcept(B);
    assert.equal(store.snapshot().size, sizeBefore);
  });

  it("unmount unregistering drops the surface", () => {
    const store = createPendingNavigationStore();
    store.stage(A, OBSERVED_A, STAGED_A);
    store.clear(A);
    assert.equal(store.pendingFor(A), null);
    assert.equal(store.getBase(A, OBSERVED_A), OBSERVED_A);
    store.clear(A);
  });

  it("scope reset starts empty", () => {
    const store = createPendingNavigationStore();
    store.stage(A, OBSERVED_A, STAGED_A);
    store.reset();
    assert.equal(store.pendingFor(A), null);
    assert.equal(store.snapshot().size, 0);
    store.reset();
  });

  it("two store instances do not share state", () => {
    const first = createPendingNavigationStore();
    const second = createPendingNavigationStore();
    first.stage(A, OBSERVED_A, STAGED_A);
    assert.equal(second.pendingFor(A), null);
    second.stage(A, OBSERVED_A, "?clientId=cl_a");
    assert.equal(first.pendingFor(A), STAGED_A);
  });

  it("repeated mount cycles converge deterministically", () => {
    const store = createPendingNavigationStore();
    for (let cycle = 0; cycle < 3; cycle += 1) {
      store.acknowledge(A, OBSERVED_A);
      store.stage(A, OBSERVED_A, STAGED_A);
      store.acknowledge(A, OBSERVED_A);
      store.acknowledge(A, STAGED_A);
      assert.equal(store.pendingFor(A), null);
    }
    assert.equal(store.snapshot().size, 1);
  });

  it("snapshot returns a fresh map that cannot mutate the store", () => {
    const store = createPendingNavigationStore();
    store.stage(A, OBSERVED_A, STAGED_A);
    const snapshot = store.snapshot();
    assert.equal(snapshot.size, 1);
    (snapshot as Map<string, unknown>).delete(A);
    assert.equal(store.pendingFor(A), STAGED_A);
    assert.equal(store.snapshot().size, 1);
  });

  it("switch base built from staged pending keeps approved edits", () => {
    const store = createPendingNavigationStore();
    store.stage(A, "?clientId=cl_a", "?clientId=cl_a&startDate=2026-09-04&accountId=act_9");
    const base = store.getBase(A, "?clientId=cl_a");
    assert.ok(base.includes("startDate=2026-09-04"));
    assert.ok(base.includes("accountId=act_9"));
  });
});
