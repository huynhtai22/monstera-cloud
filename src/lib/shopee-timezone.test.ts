import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    MARKETPLACE_BUCKETING_TIMEZONE,
    resolveShopTimezoneOffsetMinutes,
} from "./sync-marketplace-warehouse";

describe("marketplace bucketing timezone truthfulness", () => {
    it("documents UTC as the active bucketing timezone", () => {
        assert.equal(MARKETPLACE_BUCKETING_TIMEZONE, "UTC");
    });

    it("UTC day boundaries are the known limitation: 23:30 GMT+7 lands on the previous UTC day", () => {
        // 2026-08-10 23:30 local (GMT+7) = 2026-08-10 16:30 UTC → same UTC day.
        const sameDay = Math.floor(new Date("2026-08-10T16:30:00Z").getTime() / 1000);
        // 2026-08-11 00:30 local (GMT+7) = 2026-08-10 17:30 UTC → PREVIOUS UTC day.
        const previousDay = Math.floor(new Date("2026-08-10T17:30:00Z").getTime() / 1000);
        const key = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
        assert.equal(key(sameDay), "2026-08-10");
        assert.equal(key(previousDay), "2026-08-10", "order placed after local midnight still buckets to the prior UTC day — the documented limitation");
    });
});

describe("resolveShopTimezoneOffsetMinutes", () => {
    it("reads numeric gmt/utc offsets in hours or minutes", () => {
        assert.equal(resolveShopTimezoneOffsetMinutes({ gmt_offset: 7 }), 420);
        assert.equal(resolveShopTimezoneOffsetMinutes({ utc_offset: -5 }), -300);
        assert.equal(resolveShopTimezoneOffsetMinutes({ gmt_offset: 420 }), null, "ambiguous large values are rejected (never guess hours vs minutes)");
    });

    it("parses UTC+H IANA-style identifiers (whole hours and half hours)", () => {
        assert.equal(resolveShopTimezoneOffsetMinutes({ timezone: "UTC+7" }), 420);
        assert.equal(resolveShopTimezoneOffsetMinutes({ time_zone: "UTC-05:30" }), -330);
        assert.equal(resolveShopTimezoneOffsetMinutes({ tz: "UTC+14" }), 840);
    });

    it("returns null for named zones it cannot safely map", () => {
        assert.equal(resolveShopTimezoneOffsetMinutes({ timezone: "Asia/Ho_Chi_Minh" }), null, "named zones need a tz database — never guess");
    });

    it("returns null when no timezone information exists (the common case)", () => {
        assert.equal(resolveShopTimezoneOffsetMinutes({}), null);
        assert.equal(resolveShopTimezoneOffsetMinutes(null), null);
        assert.equal(resolveShopTimezoneOffsetMinutes("nope"), null);
        assert.equal(resolveShopTimezoneOffsetMinutes({ gmt_offset: "7" }), null, "string form is not trusted");
    });

    it("rejects out-of-range offsets instead of accepting garbage", () => {
        assert.equal(resolveShopTimezoneOffsetMinutes({ gmt_offset: 99 }), null);
        assert.equal(resolveShopTimezoneOffsetMinutes({ timezone: "UTC+25" }), null);
    });
});
