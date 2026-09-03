import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  displayConnectionName,
  formatLastSyncLabel,
  humanizeSourceError,
  isGenericConnectionName,
  isHumanAccountLabel,
  isInFlightProviderSync,
  shopeeShopIdFrom,
  sourceStateFor,
  summarizeAccountScope,
} from "./source-list-display";

describe("displayConnectionName", () => {
  it("replaces Shopee sandbox dump names with Shopee", () => {
    assert.equal(
      displayConnectionName("shopee", "OpenSANDBOX105040a5ca7cb0941b4 (227420569)"),
      "Shopee",
    );
    assert.equal(isGenericConnectionName("shopee", "OpenSANDBOX105040a5ca7cb0941b4 (227420569)"), true);
  });

  it("keeps a user nickname", () => {
    assert.equal(displayConnectionName("google_ads", "US Brand MCC"), "US Brand MCC");
    assert.equal(displayConnectionName("shopee", "VN flagship"), "VN flagship");
  });

  it("normalizes default platform titles", () => {
    assert.equal(displayConnectionName("google_ads", "Google Ads (8 accounts)"), "Google Ads");
    assert.equal(displayConnectionName("google_ads", "Google Ads — MCC 120-847-3618"), "Google Ads");
    assert.equal(displayConnectionName("meta_ads", "Meta (2 accounts)"), "Meta Ads");
    assert.equal(displayConnectionName("tiktok_business", ""), "TikTok Ads");
  });
});

describe("shopeeShopIdFrom", () => {
  it("prefers snake_case shop_id from stored credentials", () => {
    assert.equal(shopeeShopIdFrom({ shop_id: 227420569 }, "OpenSANDBOX"), "227420569");
  });

  it("falls back to camelCase and then the name suffix", () => {
    assert.equal(shopeeShopIdFrom({ shopId: "227420569" }), "227420569");
    assert.equal(
      shopeeShopIdFrom({}, "OpenSANDBOX105040a5ca7cb0941b4 (227420569)"),
      "227420569",
    );
  });
});

describe("summarizeAccountScope", () => {
  it("shows named Meta chips and a count when labels are raw ids", () => {
    const named = summarizeAccountScope("meta_ads", [
      { id: "1", label: "Linh Lmour" },
      { id: "2", label: "Monstera Cloud" },
    ]);
    assert.deepEqual(named.chips.map((c) => c.label), ["Linh Lmour", "Monstera Cloud"]);
    assert.equal(named.moreCount, 0);

    const idsOnly = summarizeAccountScope("tiktok_business", [
      { id: "767749592262978656", label: "767749592262978656" },
    ]);
    assert.equal(idsOnly.chips.length, 0);
    assert.equal(idsOnly.countLabel, "1 advertiser");
  });

  it("uses 0-count copy instead of All manager accounts", () => {
    assert.equal(summarizeAccountScope("google_ads", []).countLabel, "0 customer accounts");
    assert.equal(summarizeAccountScope("shopee", []).countLabel, "0 shops");
  });

  it("prefers the discovered Google Ads MCC child count over a single root tag", () => {
    const summary = summarizeAccountScope(
      "google_ads",
      [{ id: "1208473618", label: "120-847-3618" }],
      8,
    );
    assert.equal(summary.chips.length, 0);
    assert.equal(summary.countLabel, "8 customer accounts");
  });

  it("does not treat Shop ID labels as human names", () => {
    assert.equal(isHumanAccountLabel("Shop ID: 227420569", "227420569"), false);
    assert.equal(isHumanAccountLabel("Linh Lmour", "903"), true);
  });
});

describe("in-flight TikTok diagnostics", () => {
  it("does not present a processing report task as a failed sync", () => {
    const msg =
      "[failed] 767749592262978656: TikTok report task 7681095738138296340 is still PROCESSING; Monstera will resume this task automatically";
    assert.equal(isInFlightProviderSync(msg), true);
    const state = sourceStateFor(
      {
        id: "c1",
        provider: "tiktok_business",
        name: "TikTok Ads",
        status: "error",
        healthState: "error",
        errorMsg: msg,
        lastSync: "2026-08-31T08:17:28.000Z",
      },
      false,
    );
    assert.equal(state.kind, "syncing");
    assert.equal(state.canSync, false);
    assert.equal(state.label, "Syncing");
    assert.match(humanizeSourceError(msg), /still building this report/i);
  });

  it("still flags a real auth expiry as Needs re-auth", () => {
    const state = sourceStateFor(
      {
        id: "c2",
        provider: "google_ads",
        name: "Google Ads",
        status: "error",
        healthState: "error",
        errorMsg: "OAuth expired",
        lastSync: "2026-08-25T15:44:25.000Z",
      },
      false,
    );
    assert.equal(state.kind, "auth-required");
    assert.equal(state.label, "Needs re-auth");
  });
});

describe("formatLastSyncLabel", () => {
  it("returns Never for a missing sync", () => {
    assert.equal(formatLastSyncLabel("Never").text, "Never");
    assert.equal(formatLastSyncLabel(null).text, "Never");
  });

  it("uses relative copy for a recent ISO timestamp", () => {
    const iso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    assert.equal(formatLastSyncLabel(iso).text, "3h ago");
  });
});
