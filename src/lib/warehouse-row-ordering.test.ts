import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    orderRowsByExplicitAccounts,
    compareRowsDeterministic,
    type OrderableWarehouseRow,
} from "./warehouse-row-ordering";

const row = (over: Partial<OrderableWarehouseRow>): OrderableWarehouseRow => ({
    platform: "meta_ads",
    accountId: "act_1",
    accountName: "Account One",
    date: new Date("2026-08-10T00:00:00Z"),
    campaignName: "Camp A",
    entityId: "e1",
    ...over,
});

describe("warehouse row ordering — explicit account order", () => {
    it("orders rows by the supplied account sequence, not name or ID order", () => {
        const rows = [
            row({ accountId: "act_7", accountName: "AAA First Alphabetically" }),
            row({ accountId: "act_1", accountName: "ZZZ Last Alphabetically" }),
            row({ accountId: "act_3", accountName: "MMM Middle" }),
        ];
        const ordered = orderRowsByExplicitAccounts(rows, ["act_1", "act_3", "act_7"]);
        assert.deepEqual(ordered.map((r) => r.accountId), ["act_1", "act_3", "act_7"]);
    });

    it("matches Meta act_-prefixed rows against bare explicit ids and vice versa", () => {
        const rows = [row({ accountId: "123" }), row({ accountId: "act_456" })];
        const ordered = orderRowsByExplicitAccounts(rows, ["456", "123"]);
        assert.deepEqual(ordered.map((r) => r.accountId), ["act_456", "123"]);
    });

    it("duplicate accounts in the explicit list do not produce duplicate ranks", () => {
        const rows = [row({ accountId: "a" }), row({ accountId: "b" })];
        const ordered = orderRowsByExplicitAccounts(rows, ["b", "b", "a", "b"]);
        assert.deepEqual(ordered.map((r) => r.accountId), ["b", "a"]);
    });

    it("accounts missing from the explicit list sort last, deterministically", () => {
        const rows = [
            row({ accountId: "unknown", accountName: "Unknown Account" }),
            row({ accountId: "listed" }),
        ];
        const ordered = orderRowsByExplicitAccounts(rows, ["listed"]);
        assert.deepEqual(ordered.map((r) => r.accountId), ["listed", "unknown"]);
    });
});

describe("warehouse row ordering — deterministic fallback", () => {
    it("sorts by platform, then account name, then date desc", () => {
        const rows = [
            row({ platform: "google_ads", accountId: "g1", accountName: "G Account", date: new Date("2026-08-01T00:00:00Z") }),
            row({ platform: "meta_ads", accountId: "m1", accountName: "A Account", date: new Date("2026-08-02T00:00:00Z") }),
            row({ platform: "meta_ads", accountId: "m2", accountName: "B Account", date: new Date("2026-08-05T00:00:00Z") }),
            row({ platform: "meta_ads", accountId: "m3", accountName: "A Account", date: new Date("2026-08-09T00:00:00Z") }),
        ];
        const ordered = orderRowsByExplicitAccounts(rows, []);
        assert.deepEqual(
            ordered.map((r) => `${r.platform}:${r.accountName}:${r.date.toISOString().slice(0, 10)}`),
            [
                "google_ads:G Account:2026-08-01",
                "meta_ads:A Account:2026-08-09",
                "meta_ads:A Account:2026-08-02",
                "meta_ads:B Account:2026-08-05",
            ],
        );
    });

    it("falls back to accountId when accountName is empty", () => {
        const a = row({ accountId: "zzz", accountName: "" });
        const b = row({ accountId: "aaa", accountName: "" });
        assert.ok(compareRowsDeterministic(a, b) > 0, "zzz sorts after aaa by id");
    });

    it("is stable for identical keys across repeated invocations", () => {
        const rows = [
            row({ entityId: "x", date: new Date("2026-08-01T00:00:00Z") }),
            row({ entityId: "a", date: new Date("2026-08-01T00:00:00Z") }),
            row({ entityId: "m", date: new Date("2026-08-01T00:00:00Z") }),
        ];
        const first = orderRowsByExplicitAccounts(rows, []).map((r) => r.entityId);
        const second = orderRowsByExplicitAccounts(rows, []).map((r) => r.entityId);
        assert.deepEqual(first, second);
        assert.deepEqual(first, ["a", "m", "x"]);
    });

    it("does not mutate the input array", () => {
        const rows = [row({ accountId: "b" }), row({ accountId: "a" })];
        orderRowsByExplicitAccounts(rows, []);
        assert.deepEqual(rows.map((r) => r.accountId), ["b", "a"], "input order unchanged");
    });
});
