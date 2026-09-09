import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acknowledgePendingUrlState,
  applyUrlPatch,
  createPendingUrlTracker,
  mergePendingUrlState,
  selectPendingBase,
  switchPendingClient,
} from "./pending-query";

const OBSERVED = "?startDate=2026-09-01&endDate=2026-09-07&platform=google_ads";

describe("pending query merge contract", () => {
  it("applies two rapid approved edits before acknowledgement without dropping either", () => {
    const first = mergePendingUrlState({
      observedSearch: OBSERVED,
      pendingSearch: null,
      patch: { startDate: "2026-09-04" },
    });
    assert.equal(first.appliedOn, "observed");
    const second = mergePendingUrlState({
      observedSearch: OBSERVED,
      pendingSearch: first.search,
      patch: { endDate: "2026-09-04" },
    });
    assert.equal(second.appliedOn, "pending");
    const params = new URLSearchParams(second.search);
    assert.equal(params.get("startDate"), "2026-09-04");
    assert.equal(params.get("endDate"), "2026-09-04");
    assert.equal(params.get("platform"), "google_ads");
  });

  it("merges three rapid edits to different keys", () => {
    let pending: string | null = null;
    for (const patch of [{ dateFrom: "2026-09-04" }, { dateTo: "2026-09-04" }, { status: "error" }]) {
      pending = mergePendingUrlState({ observedSearch: "?view=sync", pendingSearch: pending, patch }).search;
    }
    assert.ok(pending !== null);
    const params = new URLSearchParams(pending);
    assert.equal(params.get("dateFrom"), "2026-09-04");
    assert.equal(params.get("dateTo"), "2026-09-04");
    assert.equal(params.get("status"), "error");
    assert.equal(params.get("view"), "sync");
  });

  it("re-editing the same key keeps exactly one last value", () => {
    const first = mergePendingUrlState({
      observedSearch: OBSERVED,
      pendingSearch: null,
      patch: { platform: "meta_ads" },
    });
    const second = mergePendingUrlState({
      observedSearch: OBSERVED,
      pendingSearch: first.search,
      patch: { platform: "google_ads" },
    });
    const params = new URLSearchParams(second.search);
    assert.deepEqual(params.getAll("platform"), ["google_ads"]);
  });

  it("clearing a key removes it via null, undefined or empty patch values", () => {
    for (const removal of [null, undefined, ""] as const) {
      const merged = mergePendingUrlState({
        observedSearch: OBSERVED,
        pendingSearch: null,
        patch: { platform: removal },
      });
      assert.equal(new URLSearchParams(merged.search).has("platform"), false);
      assert.equal(new URLSearchParams(merged.search).get("startDate"), "2026-09-01");
    }
  });

  it("sequences view-mode changes after date edits and vice versa", () => {
    const dated = mergePendingUrlState({
      observedSearch: "?view=sync",
      pendingSearch: null,
      patch: { dateFrom: "2026-09-04" },
    });
    const withView = mergePendingUrlState({
      observedSearch: "?view=sync",
      pendingSearch: dated.search,
      patch: { view: "table" },
    });
    assert.equal(new URLSearchParams(withView.search).get("dateFrom"), "2026-09-04");
    assert.equal(new URLSearchParams(withView.search).get("view"), "table");

    const viewed = mergePendingUrlState({
      observedSearch: "?dateFrom=2026-09-04",
      pendingSearch: null,
      patch: { view: "sync" },
    });
    const withDate = mergePendingUrlState({
      observedSearch: "?dateFrom=2026-09-04",
      pendingSearch: viewed.search,
      patch: { dateTo: "2026-09-04" },
    });
    const params = new URLSearchParams(withDate.search);
    assert.equal(params.get("view"), "sync");
    assert.equal(params.get("dateTo"), "2026-09-04");
  });

  it("filter edit immediately followed by client switch retains the approved edit", () => {
    const edited = mergePendingUrlState({
      observedSearch: "?clientId=cl_a&platform=google_ads",
      pendingSearch: null,
      patch: { startDate: "2026-09-04" },
    });
    const switched = switchPendingClient({
      observedSearch: "?clientId=cl_a&platform=google_ads",
      pendingSearch: edited.search,
      nextClientId: "cl_b",
    });
    assert.equal(switched.appliedOn, "pending");
    const params = new URLSearchParams(switched.search);
    assert.equal(params.get("clientId"), "cl_b");
    assert.equal(params.get("startDate"), "2026-09-04");
    assert.equal(params.get("platform"), "google_ads");
  });

  it("safe filter edit after a client switch builds on the switched URL", () => {
    const switched = switchPendingClient({
      observedSearch: "?clientId=cl_a&platform=google_ads",
      pendingSearch: null,
      nextClientId: "cl_b",
    });
    const edited = mergePendingUrlState({
      observedSearch: "?clientId=cl_a&platform=google_ads",
      pendingSearch: switched.search,
      patch: { status: "error" },
    });
    const params = new URLSearchParams(edited.search);
    assert.equal(params.get("clientId"), "cl_b");
    assert.equal(params.get("status"), "error");
    assert.equal(params.get("platform"), "google_ads");
  });

  it("removes unknown, OAuth, account, cursor and pagination values on client switch", () => {
    const dirty = "?clientId=cl_a&platform=google_ads&accountId=act_9&accountIds=a%2Cb"
      + "&cursor=c&page=2&offset=5&code=oauth&state=xyz&error=denied&redirect=%2Fexports"
      + "&filename=a.csv&unknown=drop&clientId=cl_a";
    for (const pending of [null, dirty]) {
      const switched = switchPendingClient({
        observedSearch: dirty,
        pendingSearch: pending,
        nextClientId: "cl_b",
      });
      const params = new URLSearchParams(switched.search);
      assert.equal(params.get("platform"), "google_ads");
      assert.deepEqual(params.getAll("clientId"), ["cl_b"]);
      for (const key of ["accountId", "accountIds", "cursor", "page", "offset", "code", "state", "error", "redirect", "filename", "unknown"]) {
        assert.equal(params.has(key), false, `${key} (pending=${pending !== null})`);
      }
    }
  });

  it("canonicalizes duplicate clientId values to exactly one", () => {
    const switched = switchPendingClient({
      observedSearch: "?clientId=cl_a&clientId=cl_b",
      pendingSearch: null,
      nextClientId: "cl_c",
    });
    assert.deepEqual(new URLSearchParams(switched.search).getAll("clientId"), ["cl_c"]);
  });

  it("does not mutate its inputs and returns fresh instances", () => {
    const observed = "?platform=google_ads";
    const pending = "?platform=meta_ads";
    const patch = { startDate: "2026-09-04" };
    const merged = mergePendingUrlState({ observedSearch: observed, pendingSearch: pending, patch });
    assert.equal(observed, "?platform=google_ads");
    assert.equal(pending, "?platform=meta_ads");
    assert.deepEqual(patch, { startDate: "2026-09-04" });
    assert.notEqual(merged.search, observed);

    const base = new URLSearchParams("platform=google_ads&platform=meta_ads");
    const snapshot = base.toString();
    const patched = applyUrlPatch(base, { platform: "tiktok" });
    assert.equal(base.toString(), snapshot);
    assert.deepEqual(patched.getAll("platform"), ["tiktok"]);

    const selected = selectPendingBase({ observedSearch: observed, pendingSearch: pending });
    assert.equal(selected.appliedOn, "pending");
    assert.equal(selectPendingBase({ observedSearch: observed, pendingSearch: null }).appliedOn, "observed");
  });
});

describe("pending acknowledgement contract", () => {
  it("keeps pending while observed is still the prior URL", () => {
    let tracker = createPendingUrlTracker("?platform=google_ads");
    tracker = { ...tracker, pendingSearch: "?platform=google_ads&startDate=2026-09-04" };
    const next = acknowledgePendingUrlState(tracker, "?platform=google_ads");
    assert.equal(next.pendingSearch, "?platform=google_ads&startDate=2026-09-04");
    assert.equal(next.acknowledgedSearch, "?platform=google_ads");
  });

  it("clears pending when observed matches the pending URL", () => {
    const tracker = {
      acknowledgedSearch: "?platform=google_ads",
      pendingSearch: "?platform=google_ads&startDate=2026-09-04",
    };
    const next = acknowledgePendingUrlState(tracker, "?platform=google_ads&startDate=2026-09-04");
    assert.equal(next.pendingSearch, null);
    assert.equal(next.acknowledgedSearch, "?platform=google_ads&startDate=2026-09-04");
  });

  it("discards stale pending on genuine external history navigation", () => {
    const tracker = {
      acknowledgedSearch: "?platform=google_ads",
      pendingSearch: "?platform=google_ads&startDate=2026-09-04",
    };
    const next = acknowledgePendingUrlState(tracker, "?platform=meta_ads");
    assert.equal(next.pendingSearch, null);
    assert.equal(next.acknowledgedSearch, "?platform=meta_ads");
  });

  it("treats reordered identical content as the same URL", () => {
    const tracker = {
      acknowledgedSearch: "?platform=google_ads",
      pendingSearch: "?platform=google_ads&startDate=2026-09-04",
    };
    const reordered = acknowledgePendingUrlState(tracker, "?platform=google_ads");
    assert.equal(reordered.pendingSearch, "?platform=google_ads&startDate=2026-09-04");
    const acknowledged = acknowledgePendingUrlState(tracker, "?startDate=2026-09-04&platform=google_ads");
    assert.equal(acknowledged.pendingSearch, null);
  });

  it("does not mutate the tracker it is given", () => {
    const tracker = createPendingUrlTracker("?platform=google_ads");
    const snapshot = { ...tracker };
    acknowledgePendingUrlState(tracker, "?platform=meta_ads");
    assert.deepEqual(tracker, snapshot);
  });
});
